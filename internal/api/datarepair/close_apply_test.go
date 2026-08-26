package datarepair

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// Explicit-apply tests.
//
// The apply path is the ONLY way a suggestion becomes a write, and it is
// reached only through an operator's confirmed click behind RequireSudo. These
// tests pin the whole safety chain: bounds → idempotency → concurrency →
// evidence re-validation → overlap → audit.

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// applyFixture wires a drive + charging repo, a fake evidence source and an
// audit spy into one handler.
type applyFixture struct {
	handler  *DataRepairHandler
	drives   *fakeDriveRepo
	charging *fakeChargingRepo
	source   *fakeDiagnosis
	audits   []auditEntry
}

// newDriveApplyFixture builds the reported scenario as durable rows:
// an open drive at -6h, last seen driving at -5h, charging starting at -4h.
func newDriveApplyFixture(storedEnd *time.Time) *applyFixture {
	start := testNow.Add(-6 * time.Hour)

	f := &applyFixture{}
	f.drives = &fakeDriveRepo{
		getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
			return &drivemodel.Drive{ID: id, VehicleID: 7, StartTs: start, EndTs: storedEnd}, nil
		},
	}
	f.charging = &fakeChargingRepo{}
	f.source = &fakeDiagnosis{
		drivesByID: map[int64]datarepairCandidate{
			1: candidate(1, 7, start, storedEnd),
		},
		drivingObs:   []datarepairObs{driveTelemetryObs(testNow.Add(-5*time.Hour), "Gear", enums.GearDrive)},
		chargeStarts: []sessionStart{{ts: testNow.Add(-4 * time.Hour), id: 900}},
	}
	f.handler = &DataRepairHandler{
		chargingRepo: f.charging,
		driveRepo:    f.drives,
		caseRepo:     newFakeCaseRepository(),
		clock:        func() time.Time { return testNow },
		diagnosis:    f.source,
		audit: func(_ context.Context, _ database.DBTX, e auditEntry) error {
			f.audits = append(f.audits, e)
			return nil
		},
	}
	return f
}

func TestCloseDrive_AppliesReviewedBoundary(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	proposed := testNow.Add(-5 * time.Hour)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	var out closeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Status != string(closeStatusClosed) {
		t.Errorf("status = %q, want closed", out.Status)
	}
	if out.EndedAt != rfc(proposed) {
		t.Errorf("ended_at = %q, want %q", out.EndedAt, rfc(proposed))
	}
	if out.DurationS == nil || *out.DurationS != 3600 {
		t.Errorf("duration_s = %v, want 3600", out.DurationS)
	}

	// Only the intended session is written, and only the two derived columns.
	if f.drives.partialCalls != 1 || f.drives.partialID != 1 {
		t.Fatalf("PartialUpdate calls=%d id=%d, want 1/1", f.drives.partialCalls, f.drives.partialID)
	}
	if got := f.drives.partialFields["ended_at"]; got != rfc(proposed) {
		t.Errorf("patch ended_at = %v, want %s", got, rfc(proposed))
	}
	if got, ok := f.drives.partialFields["duration_s"].(int64); !ok || got != 3600 {
		t.Errorf("patch duration_s = %v, want int64 3600", f.drives.partialFields["duration_s"])
	}
	if len(f.drives.partialFields) != 2 {
		t.Errorf("patch touched %d fields (%v), want exactly ended_at + duration_s",
			len(f.drives.partialFields), f.drives.partialFields)
	}
	if f.charging.partialCalls != 0 {
		t.Error("closing a drive must not touch charging sessions")
	}

	// Auditable.
	if len(f.audits) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(f.audits))
	}
	a := f.audits[0]
	if a.Action != AuditActionCloseDrive {
		t.Errorf("audit action = %q, want %q", a.Action, AuditActionCloseDrive)
	}
	if a.EntityType != auditEntityDrive || a.EntityID == nil || *a.EntityID != 1 {
		t.Errorf("audit entity = %s/%v, want drive/1", a.EntityType, a.EntityID)
	}
	for _, want := range []string{
		"rule=" + string(systemmodel.SessionRepairRuleDriveOpenChargingStarted),
		"source=suggestion",
		"previous_ended_at=open",
		"ended_at=" + rfc(proposed),
		"duration_s=3600",
	} {
		if !strings.Contains(a.Detail, want) {
			t.Errorf("audit detail %q missing %q", a.Detail, want)
		}
	}
}

func TestCloseDrive_ApplyIsIdempotent(t *testing.T) {
	t.Parallel()

	proposed := testNow.Add(-5 * time.Hour)
	f := newDriveApplyFixture(&proposed)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var out closeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Status != string(closeStatusAlreadyApplied) {
		t.Errorf("status = %q, want already_applied", out.Status)
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("PartialUpdate calls = %d, want 0 for an already-applied boundary", f.drives.partialCalls)
	}
	if len(f.audits) != 0 {
		t.Errorf("audit rows = %d, want 0 — nothing changed", len(f.audits))
	}
}

func TestCloseDrive_ApplyRejectsStaleSuggestion(t *testing.T) {
	t.Parallel()

	// The operator reviewed an OPEN drive, but by the time they clicked Apply
	// the background completion had already closed it at a different instant.
	alreadyClosedAt := testNow.Add(-3 * time.Hour)
	f := newDriveApplyFixture(&alreadyClosedAt)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("PartialUpdate calls = %d, want 0", f.drives.partialCalls)
	}
	if got := bodyError(t, rec); !strings.Contains(got, "no longer open") {
		t.Errorf("error = %q, want the 'no longer open' conflict", got)
	}
}

func TestCloseDrive_ApplyRejectsMismatchedPin(t *testing.T) {
	t.Parallel()

	stored := testNow.Add(-2 * time.Hour)
	f := newDriveApplyFixture(&stored)
	// Operator pinned an ended_at that no longer matches the row.
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":%q}`,
		rfc(testNow.Add(-5*time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
		rfc(testNow.Add(-90*time.Minute)),
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	if got := bodyError(t, rec); !strings.Contains(got, "changed since the suggestion") {
		t.Errorf("error = %q, want the concurrency conflict", got)
	}
}

func TestCloseDrive_ApplyRequiresConcurrencyPin(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q}`,
		rfc(testNow.Add(-5*time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400. body=%s", rec.Code, rec.Body.String())
	}
	if got := bodyError(t, rec); !strings.Contains(got, "expected_stored_ended_at is required") {
		t.Errorf("error = %q, want missing concurrency-pin error", got)
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("conditional update calls = %d, want 0", f.drives.partialCalls)
	}
}

func TestCloseDrive_ApplyRejectsClientRuleMismatch(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)),
		systemmodel.SessionRepairRuleDriveOpenParkObserved,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	if got := bodyError(t, rec); !strings.Contains(got, "rule no longer matches") {
		t.Errorf("error = %q, want server-rule mismatch", got)
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("conditional update calls = %d, want 0", f.drives.partialCalls)
	}
	if len(f.audits) != 0 {
		t.Errorf("audit rows = %d, want 0 for rejected client rule", len(f.audits))
	}
}

func TestCloseDrive_ApplyRejectsAtomicWriteConflict(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	f.drives.conditionalFn = func(
		context.Context,
		int64,
		*time.Time,
		time.Time,
		int64,
	) (bool, error) {
		return false, nil
	}
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	if f.drives.partialCalls != 1 {
		t.Errorf("conditional update calls = %d, want 1", f.drives.partialCalls)
	}
	if len(f.audits) != 0 {
		t.Errorf("audit rows = %d, want 0 when compare-and-swap fails", len(f.audits))
	}
}

func TestCloseDrive_AuditFailureAbortsTransaction(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	committed := false
	f.handler.transaction = func(ctx context.Context, fn func(database.DBTX) error) error {
		err := fn(nil)
		if err == nil {
			committed = true
		}
		return err
	}
	f.handler.audit = func(context.Context, database.DBTX, auditEntry) error {
		return errBoom
	}
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500. body=%s", rec.Code, rec.Body.String())
	}
	if committed {
		t.Fatal("transaction committed after audit persistence failed")
	}
	if f.drives.partialCalls != 1 {
		t.Errorf("conditional update calls = %d, want 1 inside the rolled-back transaction", f.drives.partialCalls)
	}
}

func TestCloseDrive_ApplyBoundsAndEvidenceGuards(t *testing.T) {
	t.Parallel()

	contradiction := testNow.Add(-4 * time.Hour)

	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantErr    string
	}{
		{
			name:       "malformed timestamp",
			body:       `{"ended_at":"not-a-time","rule":"manual","expected_stored_ended_at":""}`,
			wantStatus: http.StatusBadRequest,
			wantErr:    "RFC3339",
		},
		{
			name:       "unknown field",
			body:       `{"ended_at":"2026-06-01T07:00:00Z","endedAt":"typo"}`,
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid JSON body",
		},
		{
			name:       "before the session start",
			body:       fmt.Sprintf(`{"ended_at":%q,"rule":"manual","expected_stored_ended_at":""}`, rfc(testNow.Add(-7*time.Hour))),
			wantStatus: http.StatusBadRequest,
			wantErr:    "must be after the drive start",
		},
		{
			name:       "in the future",
			body:       fmt.Sprintf(`{"ended_at":%q,"rule":"manual","expected_stored_ended_at":""}`, rfc(testNow.Add(2*time.Hour))),
			wantStatus: http.StatusBadRequest,
			wantErr:    "must not be in the future",
		},
		{
			name: "later than the contradicting evidence",
			body: fmt.Sprintf(
				`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
				rfc(contradiction.Add(time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
			),
			wantStatus: http.StatusConflict,
			wantErr:    "boundary no longer matches",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newDriveApplyFixture(nil)
			rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(tc.body))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); !strings.Contains(got, tc.wantErr) {
				t.Errorf("error = %q, want it to contain %q", got, tc.wantErr)
			}
			if f.drives.partialCalls != 0 {
				t.Errorf("PartialUpdate calls = %d, want 0 for a rejected apply", f.drives.partialCalls)
			}
			if len(f.audits) != 0 {
				t.Errorf("audit rows = %d, want 0 for a rejected apply", len(f.audits))
			}
		})
	}
}

func TestCloseDrive_ApplyRefusedWithoutSupportingEvidence(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	// Remove every contradiction: the drive is merely old, which is NOT a
	// reason to close it.
	f.source.chargeStarts = nil
	f.source.gearObs = nil
	f.source.chargeStates = nil

	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	if got := bodyError(t, rec); !strings.Contains(got, "no durable evidence") {
		t.Errorf("error = %q", got)
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("PartialUpdate calls = %d, want 0", f.drives.partialCalls)
	}
}

func TestCloseDrive_ApplyRefusedWhenEvidenceBelongsToNextDrive(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	// The next drive starts before the old fixture's contradiction. The
	// analyzer must not borrow evidence from that newer session.
	f.source.driveStarts = []sessionStart{{ts: testNow.Add(-5*time.Hour - 30*time.Minute), id: 55}}

	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	if got := bodyError(t, rec); !strings.Contains(got, "no durable evidence") {
		t.Errorf("error = %q", got)
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("PartialUpdate calls = %d, want 0", f.drives.partialCalls)
	}
}

func TestCloseDrive_ApplyWithoutDiagnosisSourceIs503(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	f.handler.diagnosis = nil

	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(testNow.Add(-5*time.Hour)), systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503. body=%s", rec.Code, rec.Body.String())
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("PartialUpdate calls = %d, want 0", f.drives.partialCalls)
	}
}

func TestCloseDrive_EmptyBodyIsRejected(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", nil)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400. body=%s", rec.Code, rec.Body.String())
	}
	if got := bodyError(t, rec); !strings.Contains(got, "request body is required") {
		t.Errorf("error = %q, want required-body error", got)
	}
	if f.drives.partialCalls != 0 || len(f.audits) != 0 {
		t.Fatalf("empty close mutated state: calls=%d audits=%d", f.drives.partialCalls, len(f.audits))
	}
}

func TestCloseDrive_ExplicitManualBoundaryIsAudited(t *testing.T) {
	t.Parallel()

	f := newDriveApplyFixture(nil)
	manualBoundary := testNow.Add(-30 * time.Minute)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":"manual","expected_stored_ended_at":""}`,
		rfc(manualBoundary),
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if f.drives.partialCalls != 1 {
		t.Fatalf("PartialUpdate calls = %d, want 1", f.drives.partialCalls)
	}
	if got := f.drives.partialFields["ended_at"]; got != rfc(manualBoundary) {
		t.Errorf("ended_at = %v, want %s", got, rfc(manualBoundary))
	}
	if len(f.audits) != 1 || !strings.Contains(f.audits[0].Detail, "source=manual") {
		t.Errorf("audit = %+v, want one row with source=manual", f.audits)
	}
}

func TestCloseDrive_ManualBoundaryIsIdempotent(t *testing.T) {
	t.Parallel()

	stored := testNow.Add(-2 * time.Hour)
	f := newDriveApplyFixture(&stored)
	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":"manual","expected_stored_ended_at":""}`,
		rfc(stored),
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var out closeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Status != string(closeStatusAlreadyApplied) {
		t.Errorf("status = %q, want already_applied", out.Status)
	}
	if out.EndedAt != rfc(stored) {
		t.Errorf("ended_at = %q, want stored boundary %q", out.EndedAt, rfc(stored))
	}
	if f.drives.partialCalls != 0 {
		t.Errorf("conditional update calls = %d, want 0", f.drives.partialCalls)
	}
	if len(f.audits) != 0 {
		t.Errorf("audit rows = %d, want 0 because no mutation occurred", len(f.audits))
	}
}

func newChargingApplyRepo(start time.Time) *fakeChargingRepo {
	return &fakeChargingRepo{
		getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
			return &chargingmodel.ChargingSession{ID: id, VehicleID: 7, StartedAt: start}, nil
		},
	}
}

func matchingDriveApplyCase(
	caseID int64,
	startedAt, proposed time.Time,
) *systemmodel.RepairCase {
	repairCase := sampleRepairCase(caseID, systemmodel.RepairCaseStatusOpen)
	repairCase.Fingerprint = systemmodel.RepairCaseFingerprint(
		systemmodel.RepairCaseKindDrive,
		1,
		string(systemmodel.SessionRepairRuleDriveOpenChargingStarted),
	)
	repairCase.Kind = systemmodel.RepairCaseKindDrive
	repairCase.SessionID = 1
	repairCase.VehicleID = 7
	repairCase.Rule = string(systemmodel.SessionRepairRuleDriveOpenChargingStarted)
	repairCase.SuggestedEndedAt = &proposed
	repairCase.EvidenceStartedAt = startedAt
	repairCase.EvidenceStoredEndedAt = nil
	repairCase.Applicable = true
	return repairCase
}

func installApplyRollbackFixture(
	f *applyFixture,
	repo *fakeCaseRepository,
	sourceEndedAt **time.Time,
) {
	f.handler.transaction = func(
		ctx context.Context,
		fn func(database.DBTX) error,
	) error {
		caseSnapshot := cloneCaseMap(repo.cases)
		auditCount := len(f.audits)
		previousEnd := *sourceEndedAt
		err := fn(nil)
		if err != nil {
			repo.cases = caseSnapshot
			f.audits = f.audits[:auditCount]
			*sourceEndedAt = previousEnd
		}
		return err
	}
}

func TestCloseDrive_CaseAwareApplyTransitionsAndAuditsAtomically(t *testing.T) {
	startedAt := testNow.Add(-6 * time.Hour)
	proposed := testNow.Add(-5 * time.Hour)
	f := newDriveApplyFixture(nil)
	var sourceEndedAt *time.Time
	f.drives.getByIDFn = func(_ context.Context, id int64) (*drivemodel.Drive, error) {
		return &drivemodel.Drive{
			ID:        id,
			VehicleID: 7,
			StartTs:   startedAt,
			EndTs:     sourceEndedAt,
		}, nil
	}
	f.drives.conditionalFn = func(
		_ context.Context,
		_ int64,
		_ *time.Time,
		endedAt time.Time,
		_ int64,
	) (bool, error) {
		value := endedAt
		sourceEndedAt = &value
		return true, nil
	}
	repairCase := matchingDriveApplyCase(77, startedAt, proposed)
	repo := newFakeCaseRepository(repairCase)
	f.handler.caseRepo = repo
	installApplyRollbackFixture(f, repo, &sourceEndedAt)

	body := fmt.Sprintf(
		`{"case_id":77,"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if sourceEndedAt == nil || !sourceEndedAt.Equal(proposed) {
		t.Fatalf("source boundary = %v, want %s", sourceEndedAt, proposed)
	}
	if got := repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusApplied {
		t.Fatalf("case status = %q, want applied", got)
	}
	if len(repo.transitionCalls) != 1 {
		t.Fatalf("case transitions = %d, want exactly 1", len(repo.transitionCalls))
	}
	if len(f.audits) != 2 ||
		f.audits[0].Action != AuditActionCloseDrive ||
		f.audits[1].Action != AuditActionCaseApply {
		t.Fatalf("audit rows = %+v", f.audits)
	}
}

func TestCloseDrive_LegacySuggestionFindsMatchingActiveCase(t *testing.T) {
	startedAt := testNow.Add(-6 * time.Hour)
	proposed := testNow.Add(-5 * time.Hour)
	f := newDriveApplyFixture(nil)
	var sourceEndedAt *time.Time
	f.drives.getByIDFn = func(_ context.Context, id int64) (*drivemodel.Drive, error) {
		return &drivemodel.Drive{
			ID: id, VehicleID: 7, StartTs: startedAt, EndTs: sourceEndedAt,
		}, nil
	}
	f.drives.conditionalFn = func(
		_ context.Context,
		_ int64,
		_ *time.Time,
		endedAt time.Time,
		_ int64,
	) (bool, error) {
		value := endedAt
		sourceEndedAt = &value
		return true, nil
	}
	repairCase := matchingDriveApplyCase(78, startedAt, proposed)
	repo := newFakeCaseRepository(repairCase)
	f.handler.caseRepo = repo
	installApplyRollbackFixture(f, repo, &sourceEndedAt)

	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusApplied {
		t.Fatalf("auto-matched case status = %q, want applied", got)
	}
	if len(f.audits) != 2 || f.audits[1].Action != AuditActionCaseApply {
		t.Fatalf("audit rows = %+v", f.audits)
	}
}

func TestCloseDrive_CaseTransitionConflictRollsBackBoundary(t *testing.T) {
	startedAt := testNow.Add(-6 * time.Hour)
	proposed := testNow.Add(-5 * time.Hour)
	f := newDriveApplyFixture(nil)
	var sourceEndedAt *time.Time
	f.drives.getByIDFn = func(_ context.Context, id int64) (*drivemodel.Drive, error) {
		return &drivemodel.Drive{
			ID: id, VehicleID: 7, StartTs: startedAt, EndTs: sourceEndedAt,
		}, nil
	}
	f.drives.conditionalFn = func(
		_ context.Context,
		_ int64,
		_ *time.Time,
		endedAt time.Time,
		_ int64,
	) (bool, error) {
		value := endedAt
		sourceEndedAt = &value
		return true, nil
	}
	repairCase := matchingDriveApplyCase(79, startedAt, proposed)
	repo := newFakeCaseRepository(repairCase)
	repo.transitionErr = datarepairdb.ErrConcurrentModification
	f.handler.caseRepo = repo
	installApplyRollbackFixture(f, repo, &sourceEndedAt)

	body := fmt.Sprintf(
		`{"case_id":79,"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if sourceEndedAt != nil {
		t.Fatalf("source boundary survived rolled-back case conflict: %s", sourceEndedAt)
	}
	if got := repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusOpen {
		t.Fatalf("case status = %q, want open", got)
	}
	if len(f.audits) != 0 {
		t.Fatalf("audit rows survived rolled-back conflict: %+v", f.audits)
	}
}

func TestCloseDrive_CaseAuditFailureRollsBackBoundaryAndCase(t *testing.T) {
	startedAt := testNow.Add(-6 * time.Hour)
	proposed := testNow.Add(-5 * time.Hour)
	f := newDriveApplyFixture(nil)
	var sourceEndedAt *time.Time
	f.drives.getByIDFn = func(_ context.Context, id int64) (*drivemodel.Drive, error) {
		return &drivemodel.Drive{
			ID: id, VehicleID: 7, StartTs: startedAt, EndTs: sourceEndedAt,
		}, nil
	}
	f.drives.conditionalFn = func(
		_ context.Context,
		_ int64,
		_ *time.Time,
		endedAt time.Time,
		_ int64,
	) (bool, error) {
		value := endedAt
		sourceEndedAt = &value
		return true, nil
	}
	repairCase := matchingDriveApplyCase(80, startedAt, proposed)
	repo := newFakeCaseRepository(repairCase)
	f.handler.caseRepo = repo
	auditCalls := 0
	f.handler.audit = func(_ context.Context, _ database.DBTX, entry auditEntry) error {
		auditCalls++
		if auditCalls == 2 {
			return errBoom
		}
		f.audits = append(f.audits, entry)
		return nil
	}
	installApplyRollbackFixture(f, repo, &sourceEndedAt)

	body := fmt.Sprintf(
		`{"case_id":80,"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if sourceEndedAt != nil {
		t.Fatalf("source boundary survived rolled-back case audit: %s", sourceEndedAt)
	}
	if got := repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusOpen {
		t.Fatalf("case status = %q, want open", got)
	}
	if len(f.audits) != 0 {
		t.Fatalf("audit rows survived rollback: %+v", f.audits)
	}
}

func TestCloseDrive_AlreadyAppliedBoundaryStillClosesActiveCase(t *testing.T) {
	startedAt := testNow.Add(-6 * time.Hour)
	proposed := testNow.Add(-5 * time.Hour)
	f := newDriveApplyFixture(&proposed)
	repairCase := matchingDriveApplyCase(81, startedAt, proposed)
	repo := newFakeCaseRepository(repairCase)
	f.handler.caseRepo = repo
	sourceEndedAt := &proposed
	installApplyRollbackFixture(f, repo, &sourceEndedAt)

	body := fmt.Sprintf(
		`{"case_id":81,"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(proposed),
		systemmodel.SessionRepairRuleDriveOpenChargingStarted,
	)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/close", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if f.drives.partialCalls != 0 {
		t.Fatalf("already-applied source mutation calls = %d, want 0", f.drives.partialCalls)
	}
	if got := repo.cases[repairCase.ID].Status; got != systemmodel.RepairCaseStatusApplied {
		t.Fatalf("case status = %q, want applied", got)
	}
	if len(f.audits) != 1 || f.audits[0].Action != AuditActionCaseApply {
		t.Fatalf("audit rows = %+v, want only case apply", f.audits)
	}
}

func TestCloseDrive_RejectsMismatchedOrInapplicableCase(t *testing.T) {
	startedAt := testNow.Add(-6 * time.Hour)
	proposed := testNow.Add(-5 * time.Hour)
	tests := []struct {
		name   string
		mutate func(*systemmodel.RepairCase)
	}{
		{
			name: "wrong session",
			mutate: func(repairCase *systemmodel.RepairCase) {
				repairCase.SessionID = 2
			},
		},
		{
			name: "inapplicable",
			mutate: func(repairCase *systemmodel.RepairCase) {
				repairCase.Applicable = false
			},
		},
		{
			name: "terminal lifecycle",
			mutate: func(repairCase *systemmodel.RepairCase) {
				repairCase.Status = systemmodel.RepairCaseStatusDismissed
			},
		},
		{
			name: "stale evidence pin",
			mutate: func(repairCase *systemmodel.RepairCase) {
				stale := testNow.Add(-2 * time.Hour)
				repairCase.EvidenceStoredEndedAt = &stale
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := newDriveApplyFixture(nil)
			repairCase := matchingDriveApplyCase(82, startedAt, proposed)
			test.mutate(repairCase)
			f.handler.caseRepo = newFakeCaseRepository(repairCase)
			body := fmt.Sprintf(
				`{"case_id":82,"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
				rfc(proposed),
				systemmodel.SessionRepairRuleDriveOpenChargingStarted,
			)
			rec := doReq(
				t,
				f.handler,
				http.MethodPost,
				"/data-repair/drive/1/close",
				strings.NewReader(body),
			)
			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
			}
			if f.drives.partialCalls != 0 {
				t.Fatalf("rejected case mutated source %d times", f.drives.partialCalls)
			}
		})
	}
}

func TestDecodeCloseRequestRejectsTrailingJSONAndManualCaseID(t *testing.T) {
	f := newDriveApplyFixture(nil)
	tests := []string{
		`{"ended_at":"2026-06-01T07:00:00Z","rule":"manual","expected_stored_ended_at":""} {}`,
		`{"case_id":3,"ended_at":"2026-06-01T07:00:00Z","rule":"manual","expected_stored_ended_at":""}`,
		`{"case_id":0,"ended_at":"2026-06-01T07:00:00Z","rule":"manual","expected_stored_ended_at":""}`,
	}
	for _, body := range tests {
		rec := doReq(
			t,
			f.handler,
			http.MethodPost,
			"/data-repair/drive/1/close",
			strings.NewReader(body),
		)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
	if f.drives.getByIDCalls != 0 || f.drives.partialCalls != 0 {
		t.Fatalf(
			"invalid close bodies touched source: get/update=%d/%d",
			f.drives.getByIDCalls,
			f.drives.partialCalls,
		)
	}
}

func TestCloseCharging_AppliesReviewedBoundary(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	stopped := testNow.Add(-6 * time.Hour)
	charging := newChargingApplyRepo(start)
	src := &fakeDiagnosis{
		chargesByID: map[int64]datarepairCandidate{3: candidate(3, 7, start, nil)},
		powerObs:    []datarepairObs{chargingPowerObs(testNow.Add(-6*time.Hour-5*time.Minute), 11000)},
		chargeStates: []datarepairObs{
			chargeStateObs(testNow.Add(-7*time.Hour), enums.ChargeStateCharging),
			chargeStateObs(stopped, enums.ChargeStateComplete),
		},
	}
	var audits []auditEntry
	h := &DataRepairHandler{
		chargingRepo: charging,
		driveRepo:    &fakeDriveRepo{},
		caseRepo:     newFakeCaseRepository(),
		clock:        func() time.Time { return testNow },
		diagnosis:    src,
		audit: func(_ context.Context, _ database.DBTX, e auditEntry) error {
			audits = append(audits, e)
			return nil
		},
	}

	body := fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":""}`,
		rfc(stopped), systemmodel.SessionRepairRuleChargingOpenChargeEnded,
	)
	rec := doReq(t, h, http.MethodPost, "/data-repair/charging/3/close", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	if charging.partialCalls != 1 || charging.partialID != 3 {
		t.Fatalf("PartialUpdate calls=%d id=%d, want 1/3", charging.partialCalls, charging.partialID)
	}
	if got := charging.partialFields["ended_at"]; got != rfc(stopped) {
		t.Errorf("patch ended_at = %v, want %s", got, rfc(stopped))
	}
	// charging_sessions has no stored duration column.
	if _, ok := charging.partialFields["duration_s"]; ok {
		t.Errorf("charging patch must not write duration_s: %v", charging.partialFields)
	}
	if len(audits) != 1 || audits[0].Action != AuditActionCloseCharging {
		t.Fatalf("audit = %+v, want one data_repair.close_charging row", audits)
	}
	if audits[0].EntityType != auditEntityChargingSession {
		t.Errorf("audit entity_type = %q, want %q", audits[0].EntityType, auditEntityChargingSession)
	}
}
