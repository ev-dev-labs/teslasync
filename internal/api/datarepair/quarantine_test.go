package datarepair

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/database/repairsnapshot"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

func newDriveQuarantineFixture(
	t *testing.T,
	status systemmodel.RepairCaseStatus,
) (*caseHandlerFixture, *fakeDriveRepo, *systemmodel.RepairCase) {
	t.Helper()
	repairCase := sampleRepairCase(1, status)
	repairCase.Kind = systemmodel.RepairCaseKindDrive
	repairCase.SessionID = 41
	repairCase.VehicleID = 7
	fixture := newCaseHandlerFixture(repairCase)
	drive := &fakeDriveRepo{
		snapshotFn: func(_ context.Context, id int64) (json.RawMessage, error) {
			return fakeQuarantineSnapshot(
				t,
				"drive",
				id,
				repairCase.VehicleID,
				repairCase.EvidenceStartedAt,
				repairCase.EvidenceStoredEndedAt,
			), nil
		},
	}
	fixture.handler.driveRepo = drive
	fixture.handler.chargingRepo = &fakeChargingRepo{}
	return fixture, drive, repairCase
}

func TestQuarantineCase_AtomicSuccessAndOpaqueResponse(t *testing.T) {
	fixture, drive, repairCase := newDriveQuarantineFixture(
		t,
		systemmodel.RepairCaseStatusOpen,
	)
	sourcePresent := true
	drive.snapshotFn = func(_ context.Context, id int64) (json.RawMessage, error) {
		payload, err := json.Marshal(map[string]interface{}{
			"schema_version": 1,
			"drive": map[string]interface{}{
				"id":         id,
				"vehicle_id": repairCase.VehicleID,
				"started_at": repairCase.EvidenceStartedAt,
				"ended_at":   nil,
				"secret":     "opaque-location",
			},
		})
		return payload, err
	}
	drive.deleteFn = func(context.Context, int64) error {
		sourcePresent = false
		return nil
	}

	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodPost,
		"/data-repair/cases/1/quarantine",
		strings.NewReader(`{"reason":"  duplicate trip import  "}`),
	)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if sourcePresent {
		t.Fatal("source remained present after committed quarantine")
	}
	if strings.Contains(rec.Body.String(), "original_row") ||
		strings.Contains(rec.Body.String(), "opaque-location") {
		t.Fatalf("opaque recovery payload leaked in response: %s", rec.Body.String())
	}

	var record systemmodel.RepairQuarantine
	if err := json.Unmarshal(rec.Body.Bytes(), &record); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if record.CaseID != repairCase.ID ||
		record.SessionID != repairCase.SessionID ||
		record.Reason != "duplicate trip import" ||
		record.QuarantinedBy != "operator@example.test" {
		t.Fatalf("unexpected quarantine response: %+v", record)
	}
	if got := fixture.repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusQuarantined {
		t.Fatalf("case status = %q, want quarantined", got)
	}
	if len(fixture.audits) != 2 ||
		fixture.audits[0].Action != AuditActionQuarantineDrive ||
		fixture.audits[1].Action != AuditActionCaseQuarantine {
		t.Fatalf("audit rows = %+v", fixture.audits)
	}
	for _, audit := range fixture.audits {
		if strings.Contains(audit.Detail, "duplicate trip import") {
			t.Errorf("audit detail contains free-text reason: %q", audit.Detail)
		}
	}
}

func TestQuarantineCase_RejectsInvalidReasonsWithoutMutation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"missing", `{}`},
		{"blank", `{"reason":"   "}`},
		{"too long", fmt.Sprintf(`{"reason":%q}`, strings.Repeat("x", maxQuarantineReasonChars+1))},
		{"unknown field", `{"reason":"valid","unexpected":true}`},
		{"trailing JSON", `{"reason":"valid"} {"reason":"second"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture, drive, _ := newDriveQuarantineFixture(
				t,
				systemmodel.RepairCaseStatusOpen,
			)
			rec := doCaseRequest(
				t,
				fixture.handler,
				http.MethodPost,
				"/data-repair/cases/1/quarantine",
				strings.NewReader(test.body),
			)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if drive.snapshotCalls != 0 ||
				fixture.repo.createQuarantineCalls != 0 ||
				drive.deleteCalls != 0 {
				t.Fatalf(
					"invalid request mutated: snapshot/create/delete=%d/%d/%d",
					drive.snapshotCalls,
					fixture.repo.createQuarantineCalls,
					drive.deleteCalls,
				)
			}
		})
	}
}

func TestQuarantineCase_RejectsIncompatibleLifecycle(t *testing.T) {
	fixture, drive, _ := newDriveQuarantineFixture(
		t,
		systemmodel.RepairCaseStatusResolved,
	)
	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodPost,
		"/data-repair/cases/1/quarantine",
		strings.NewReader(`{"reason":"operator review"}`),
	)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if drive.snapshotCalls != 0 || drive.deleteCalls != 0 {
		t.Fatalf(
			"lifecycle rejection touched source: snapshot/delete=%d/%d",
			drive.snapshotCalls,
			drive.deleteCalls,
		)
	}
}

func TestQuarantineCase_RollsBackEveryFailureStage(t *testing.T) {
	tests := []struct {
		name         string
		configure    func(*caseHandlerFixture, *fakeDriveRepo)
		wantStatus   int
		wantSnapshot int
	}{
		{
			name: "snapshot",
			configure: func(_ *caseHandlerFixture, drive *fakeDriveRepo) {
				drive.snapshotFn = func(context.Context, int64) (json.RawMessage, error) {
					return nil, errBoom
				}
			},
			wantStatus:   http.StatusInternalServerError,
			wantSnapshot: 1,
		},
		{
			name: "quarantine insert",
			configure: func(fixture *caseHandlerFixture, _ *fakeDriveRepo) {
				fixture.repo.createQuarantineErr = errBoom
			},
			wantStatus:   http.StatusInternalServerError,
			wantSnapshot: 1,
		},
		{
			name: "source delete",
			configure: func(_ *caseHandlerFixture, drive *fakeDriveRepo) {
				drive.deleteFn = func(context.Context, int64) error { return errBoom }
			},
			wantStatus:   http.StatusInternalServerError,
			wantSnapshot: 1,
		},
		{
			name: "case transition",
			configure: func(fixture *caseHandlerFixture, _ *fakeDriveRepo) {
				fixture.repo.transitionErr = errBoom
			},
			wantStatus:   http.StatusInternalServerError,
			wantSnapshot: 1,
		},
		{
			name: "source audit",
			configure: func(fixture *caseHandlerFixture, _ *fakeDriveRepo) {
				fixture.auditFailAt = 1
			},
			wantStatus:   http.StatusInternalServerError,
			wantSnapshot: 1,
		},
		{
			name: "case audit",
			configure: func(fixture *caseHandlerFixture, _ *fakeDriveRepo) {
				fixture.auditFailAt = 2
			},
			wantStatus:   http.StatusInternalServerError,
			wantSnapshot: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture, drive, repairCase := newDriveQuarantineFixture(
				t,
				systemmodel.RepairCaseStatusOpen,
			)
			sourcePresent := true
			drive.deleteFn = func(context.Context, int64) error {
				sourcePresent = false
				return nil
			}
			test.configure(fixture, drive)

			baseTransaction := fixture.handler.transaction
			fixture.handler.transaction = func(
				ctx context.Context,
				fn func(database.DBTX) error,
			) error {
				wasPresent := sourcePresent
				err := baseTransaction(ctx, fn)
				if err != nil {
					sourcePresent = wasPresent
				}
				return err
			}

			rec := doCaseRequest(
				t,
				fixture.handler,
				http.MethodPost,
				"/data-repair/cases/1/quarantine",
				strings.NewReader(`{"reason":"operator review"}`),
			)
			if rec.Code != test.wantStatus {
				t.Fatalf(
					"status = %d, want %d; body=%s",
					rec.Code,
					test.wantStatus,
					rec.Body.String(),
				)
			}
			if drive.snapshotCalls != test.wantSnapshot {
				t.Errorf("snapshot calls = %d, want %d", drive.snapshotCalls, test.wantSnapshot)
			}
			if !sourcePresent {
				t.Error("source deletion survived failed transaction")
			}
			if got := fixture.repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusOpen {
				t.Errorf("case status after rollback = %q, want open", got)
			}
			if len(fixture.repo.quarantine) != 0 {
				t.Errorf("quarantine rows survived rollback: %+v", fixture.repo.quarantine)
			}
			if len(fixture.audits) != 0 {
				t.Errorf("audit rows survived rollback: %+v", fixture.audits)
			}
		})
	}
}

func TestListQuarantines_ValidationPaginationAndNoPayload(t *testing.T) {
	fixture := newCaseHandlerFixture()
	records := make([]systemmodel.RepairQuarantine, 0, 3)
	for id := int64(3); id >= 1; id-- {
		records = append(records, systemmodel.RepairQuarantine{
			ID:            id,
			CaseID:        id + 10,
			Kind:          systemmodel.RepairCaseKindDrive,
			SessionID:     id + 20,
			VehicleID:     7,
			OriginalRow:   json.RawMessage(`{"secret":"must-not-leak"}`),
			SchemaVersion: 1,
			Checksum:      strings.Repeat("a", 64),
			Reason:        "reviewed",
			QuarantinedBy: "operator",
			QuarantinedAt: testNow.Add(-time.Duration(3-id) * time.Minute),
		})
	}
	fixture.repo.quarantineList = records

	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodGet,
		"/data-repair/quarantine?vehicle_id=7&kind=drive&restored=false&limit=2",
		nil,
	)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "original_row") ||
		strings.Contains(rec.Body.String(), "must-not-leak") {
		t.Fatalf("opaque payload leaked in list response: %s", rec.Body.String())
	}
	var response quarantineListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Quarantines) != 2 || !response.HasMore ||
		response.NextCursor == nil || response.NextCursor.ID != 2 {
		t.Fatalf("unexpected pagination response: %+v", response)
	}
	filter := fixture.repo.quarantineListCalls[0]
	if filter.VehicleID == nil || *filter.VehicleID != 7 ||
		filter.Kind == nil || *filter.Kind != systemmodel.RepairCaseKindDrive ||
		filter.Restored == nil || *filter.Restored ||
		filter.Limit != 3 {
		t.Fatalf("unexpected repository filter: %+v", filter)
	}

	for _, query := range []string{
		"?vehicle_id=0",
		"?kind=trip",
		"?restored=yes",
		"?cursor_id=1",
		"?cursor_quarantined_at=2026-06-01T00:00:00Z",
		"?cursor_quarantined_at=bad&cursor_id=1",
		"?cursor_quarantined_at=2026-06-01T00:00:00Z&cursor_id=0",
		"?limit=0",
	} {
		rec := doCaseRequest(
			t,
			fixture.handler,
			http.MethodGet,
			"/data-repair/quarantine"+query,
			nil,
		)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("query %q: status = %d, want 400", query, rec.Code)
		}
	}
}

func activeDriveQuarantineFixture(
	t *testing.T,
	checksumOverride string,
) (*caseHandlerFixture, *fakeDriveRepo, *systemmodel.RepairQuarantine) {
	t.Helper()
	repairCase := sampleRepairCase(8, systemmodel.RepairCaseStatusQuarantined)
	repairCase.Kind = systemmodel.RepairCaseKindDrive
	repairCase.SessionID = 81
	repairCase.VehicleID = 7
	fixture := newCaseHandlerFixture(repairCase)
	payload := fakeQuarantineSnapshot(
		t,
		"drive",
		repairCase.SessionID,
		repairCase.VehicleID,
		repairCase.EvidenceStartedAt,
		nil,
	)
	checksum, err := repairsnapshot.Checksum(payload)
	if err != nil {
		t.Fatalf("checksum fixture payload: %v", err)
	}
	if checksumOverride != "" {
		checksum = checksumOverride
	}
	record := &systemmodel.RepairQuarantine{
		ID:            55,
		CaseID:        repairCase.ID,
		Kind:          repairCase.Kind,
		SessionID:     repairCase.SessionID,
		VehicleID:     repairCase.VehicleID,
		OriginalRow:   payload,
		SchemaVersion: 1,
		Checksum:      checksum,
		Reason:        "original quarantine reason",
		QuarantinedBy: "operator",
		QuarantinedAt: testNow.Add(-time.Hour),
	}
	fixture.repo.quarantine[repairCase.ID] = record
	drive := &fakeDriveRepo{
		restoreFn: func(
			_ context.Context,
			payload json.RawMessage,
			expected string,
		) error {
			return repairsnapshot.RequireChecksum(payload, expected)
		},
	}
	fixture.handler.driveRepo = drive
	fixture.handler.chargingRepo = &fakeChargingRepo{}
	return fixture, drive, record
}

func TestRestoreQuarantine_VerifiesAndRestoresAtomically(t *testing.T) {
	fixture, drive, record := activeDriveQuarantineFixture(t, "")
	sourcePresent := false
	drive.restoreFn = func(
		_ context.Context,
		payload json.RawMessage,
		expected string,
	) error {
		if err := repairsnapshot.RequireChecksum(payload, expected); err != nil {
			return err
		}
		sourcePresent = true
		return nil
	}

	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodPost,
		"/data-repair/quarantine/55/restore",
		strings.NewReader(`{"reason":"false-positive quarantine"}`),
	)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !sourcePresent {
		t.Fatal("source was not restored")
	}
	if strings.Contains(rec.Body.String(), "original_row") {
		t.Fatalf("opaque payload leaked in restore response: %s", rec.Body.String())
	}
	if got := fixture.repo.cases[record.CaseID].Status; got != systemmodel.RepairCaseStatusRestored {
		t.Fatalf("case status = %q, want restored", got)
	}
	stored := fixture.repo.quarantine[record.CaseID]
	if stored.RestoredAt == nil || stored.RestoredBy == nil ||
		*stored.RestoredBy != "operator@example.test" {
		t.Fatalf("quarantine was not marked restored: %+v", stored)
	}
	if len(fixture.audits) != 2 ||
		fixture.audits[0].Action != AuditActionRestoreDrive ||
		fixture.audits[1].Action != AuditActionCaseRestore {
		t.Fatalf("restore audit rows = %+v", fixture.audits)
	}
}

func TestRestoreQuarantine_ChecksumMismatchIsConflictAndRollsBack(t *testing.T) {
	fixture, drive, record := activeDriveQuarantineFixture(t, strings.Repeat("0", 64))
	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodPost,
		"/data-repair/quarantine/55/restore",
		strings.NewReader(`{"reason":"restore reviewed"}`),
	)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if drive.restoreCalls != 1 {
		t.Fatalf("restore calls = %d, want 1", drive.restoreCalls)
	}
	if fixture.repo.markQuarantineCalls != 0 {
		t.Fatalf("mark restored calls = %d, want 0", fixture.repo.markQuarantineCalls)
	}
	if got := fixture.repo.cases[record.CaseID].Status; got != systemmodel.RepairCaseStatusQuarantined {
		t.Fatalf("case status = %q, want quarantined", got)
	}
	if fixture.repo.quarantine[record.CaseID].RestoredAt != nil {
		t.Fatal("quarantine marked restored despite checksum conflict")
	}
	if len(fixture.audits) != 0 {
		t.Fatalf("audits written on checksum conflict: %+v", fixture.audits)
	}
}

func TestRestoreQuarantine_MapsLifecycleAndSnapshotConflicts(t *testing.T) {
	tests := []struct {
		name      string
		configure func(*caseHandlerFixture, *fakeDriveRepo, *systemmodel.RepairQuarantine)
	}{
		{
			name: "already restored",
			configure: func(
				_ *caseHandlerFixture,
				_ *fakeDriveRepo,
				record *systemmodel.RepairQuarantine,
			) {
				restoredAt := testNow.Add(-time.Minute)
				record.RestoredAt = &restoredAt
			},
		},
		{
			name: "source collision",
			configure: func(
				_ *caseHandlerFixture,
				drive *fakeDriveRepo,
				_ *systemmodel.RepairQuarantine,
			) {
				drive.restoreFn = func(context.Context, json.RawMessage, string) error {
					return repairsnapshot.ErrAlreadyExists
				}
			},
		},
		{
			name: "malformed snapshot",
			configure: func(
				_ *caseHandlerFixture,
				drive *fakeDriveRepo,
				_ *systemmodel.RepairQuarantine,
			) {
				drive.restoreFn = func(context.Context, json.RawMessage, string) error {
					return repairsnapshot.ErrMalformedPayload
				}
			},
		},
		{
			name: "relationship conflict",
			configure: func(
				_ *caseHandlerFixture,
				drive *fakeDriveRepo,
				_ *systemmodel.RepairQuarantine,
			) {
				drive.restoreFn = func(context.Context, json.RawMessage, string) error {
					return repairsnapshot.ErrConflict
				}
			},
		},
		{
			name: "unsupported schema",
			configure: func(
				_ *caseHandlerFixture,
				_ *fakeDriveRepo,
				record *systemmodel.RepairQuarantine,
			) {
				record.SchemaVersion = 2
			},
		},
		{
			name: "snapshot identity mismatch",
			configure: func(
				_ *caseHandlerFixture,
				_ *fakeDriveRepo,
				record *systemmodel.RepairQuarantine,
			) {
				record.OriginalRow = fakeQuarantineSnapshot(
					t,
					"drive",
					record.SessionID+1,
					record.VehicleID,
					testNow.Add(-time.Hour),
					nil,
				)
				checksum, err := repairsnapshot.Checksum(record.OriginalRow)
				if err != nil {
					t.Fatalf("checksum mismatched identity fixture: %v", err)
				}
				record.Checksum = checksum
			},
		},
		{
			name: "case lifecycle mismatch",
			configure: func(
				fixture *caseHandlerFixture,
				_ *fakeDriveRepo,
				record *systemmodel.RepairQuarantine,
			) {
				fixture.repo.cases[record.CaseID].Status = systemmodel.RepairCaseStatusResolved
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture, drive, record := activeDriveQuarantineFixture(t, "")
			test.configure(fixture, drive, record)
			rec := doCaseRequest(
				t,
				fixture.handler,
				http.MethodPost,
				"/data-repair/quarantine/55/restore",
				strings.NewReader(`{"reason":"restore reviewed"}`),
			)
			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
			}
			if fixture.repo.markQuarantineCalls != 0 {
				t.Errorf("mark calls = %d, want 0", fixture.repo.markQuarantineCalls)
			}
			if len(fixture.audits) != 0 {
				t.Errorf("audit rows = %+v, want none", fixture.audits)
			}
		})
	}
}

func TestRestoreQuarantine_NotFound(t *testing.T) {
	fixture := newCaseHandlerFixture()
	fixture.handler.driveRepo = &fakeDriveRepo{}
	fixture.handler.chargingRepo = &fakeChargingRepo{}
	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodPost,
		"/data-repair/quarantine/999/restore",
		strings.NewReader(`{"reason":"restore reviewed"}`),
	)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRestoreAndLegacyQuarantine_RequireReason(t *testing.T) {
	fixture, drive, _ := newDriveQuarantineFixture(
		t,
		systemmodel.RepairCaseStatusOpen,
	)
	activeFixture, restoringDrive, _ := activeDriveQuarantineFixture(t, "")
	tests := []struct {
		name    string
		handler *DataRepairHandler
		method  string
		path    string
		calls   func() int
	}{
		{
			name:    "legacy delete",
			handler: fixture.handler,
			method:  http.MethodDelete,
			path:    "/data-repair/drive/41",
			calls:   func() int { return drive.snapshotCalls },
		},
		{
			name:    "restore",
			handler: activeFixture.handler,
			method:  http.MethodPost,
			path:    "/data-repair/quarantine/55/restore",
			calls:   func() int { return restoringDrive.restoreCalls },
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var rec *httptest.ResponseRecorder
			if test.method == http.MethodDelete {
				rec = doReq(t, test.handler, test.method, test.path, strings.NewReader(`{}`))
			} else {
				rec = doCaseRequest(t, test.handler, test.method, test.path, strings.NewReader(`{}`))
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if test.calls() != 0 {
				t.Fatalf("source operation calls = %d, want 0", test.calls())
			}
		})
	}
}

func TestRestoreQuarantine_AuditFailureRollsBackSourceAndMetadata(t *testing.T) {
	fixture, drive, record := activeDriveQuarantineFixture(t, "")
	sourcePresent := false
	drive.restoreFn = func(
		_ context.Context,
		_ json.RawMessage,
		_ string,
	) error {
		sourcePresent = true
		return nil
	}
	fixture.auditFailAt = 2
	baseTransaction := fixture.handler.transaction
	fixture.handler.transaction = func(
		ctx context.Context,
		fn func(database.DBTX) error,
	) error {
		wasPresent := sourcePresent
		err := baseTransaction(ctx, fn)
		if err != nil {
			sourcePresent = wasPresent
		}
		return err
	}

	rec := doCaseRequest(
		t,
		fixture.handler,
		http.MethodPost,
		"/data-repair/quarantine/55/restore",
		strings.NewReader(`{"reason":"restore reviewed"}`),
	)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if sourcePresent {
		t.Fatal("restored source survived failed audit transaction")
	}
	if fixture.repo.quarantine[record.CaseID].RestoredAt != nil {
		t.Fatal("restore marker survived failed audit transaction")
	}
	if got := fixture.repo.cases[record.CaseID].Status; got != systemmodel.RepairCaseStatusQuarantined {
		t.Fatalf("case status after rollback = %q, want quarantined", got)
	}
	if len(fixture.audits) != 0 {
		t.Fatalf("audit rows survived rollback: %+v", fixture.audits)
	}
}

func TestLegacyQuarantineCreatesTransparentlyManualCase(t *testing.T) {
	drive := &fakeDriveRepo{
		snapshotFn: func(_ context.Context, id int64) (json.RawMessage, error) {
			return fakeQuarantineSnapshot(
				t,
				"drive",
				id,
				7,
				testNow.Add(-time.Hour),
				nil,
			), nil
		},
	}
	handler := newTestHandler(&fakeChargingRepo{}, drive)
	repo := newFakeCaseRepository()
	handler.caseRepo = repo

	rec := doReq(
		t,
		handler,
		http.MethodDelete,
		"/data-repair/drive/71",
		strings.NewReader(`{"reason":"manual operator cleanup"}`),
	)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
	if repo.upsertCalls != 1 || len(repo.cases) != 1 {
		t.Fatalf("operator case creation calls/cases = %d/%d, want 1/1", repo.upsertCalls, len(repo.cases))
	}
	for _, repairCase := range repo.cases {
		if repairCase.Rule != operatorQuarantineRule ||
			repairCase.EvidenceContradictionSrc != operatorQuarantineEvidenceSrc ||
			repairCase.EvidenceContradictionField != operatorQuarantineEvidenceField ||
			repairCase.Status != systemmodel.RepairCaseStatusQuarantined {
			t.Fatalf("operator case is not transparently manual: %+v", repairCase)
		}
	}
	for _, record := range repo.quarantine {
		if record.QuarantinedBy != "anonymous" {
			t.Fatalf("open-mode actor = %q, want anonymous", record.QuarantinedBy)
		}
	}
}

func TestQuarantineEndpoints_NilRepositoryIsUnavailable(t *testing.T) {
	handler := newTestHandler(&fakeChargingRepo{}, &fakeDriveRepo{})
	tests := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/data-repair/quarantine", ""},
		{http.MethodPost, "/data-repair/cases/1/quarantine", `{"reason":"reviewed"}`},
		{http.MethodPost, "/data-repair/quarantine/1/restore", `{"reason":"reviewed"}`},
		{http.MethodDelete, "/data-repair/drive/1", `{"reason":"reviewed"}`},
	}
	for _, test := range tests {
		body := strings.NewReader(test.body)
		var rec *httptest.ResponseRecorder
		if test.method == http.MethodDelete {
			rec = doReq(t, handler, test.method, test.path, body)
		} else {
			rec = doCaseRequest(t, handler, test.method, test.path, body)
		}
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s: status = %d, want 503", test.method, test.path, rec.Code)
		}
	}
}

func TestActorFromRequest_OpenModeAndBounds(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "/", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := actorFromRequest(request, ""); got != "anonymous" {
		t.Fatalf("open-mode actor = %q, want anonymous", got)
	}
	request.Header.Set("X-Operator", strings.Repeat("é", maxHTTPActorChars+20))
	if got := actorFromRequest(request, "X-Operator"); utf8.RuneCountInString(got) != maxHTTPActorChars {
		t.Fatalf("bounded actor rune count = %d, want %d", utf8.RuneCountInString(got), maxHTTPActorChars)
	}
	request.Header.Set("X-Operator", string([]byte{0xff}))
	if got := actorFromRequest(request, "X-Operator"); got != "anonymous" {
		t.Fatalf("invalid UTF-8 actor = %q, want anonymous", got)
	}
}
