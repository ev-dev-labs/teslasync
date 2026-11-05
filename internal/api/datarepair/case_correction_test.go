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
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type fakeCorrectionSource struct {
	source  *datarepairdb.CorrectionSource
	related *datarepairdb.CorrectionSource
	err     error
	locks   int
	overlap bool
}

func (f *fakeCorrectionSource) GetSource(
	_ context.Context,
	_ database.DBTX,
	kind datarepairdb.AnomalyKind,
	id int64,
	lock bool,
) (*datarepairdb.CorrectionSource, error) {
	if lock {
		f.locks++
	}
	if f.err != nil {
		return nil, f.err
	}
	source := f.source
	if f.related != nil && f.related.Kind == kind && f.related.ID == id {
		source = f.related
	}
	if source == nil || source.Kind != kind || source.ID != id {
		return nil, nil
	}
	copySource := *source
	return &copySource, nil
}

func (f *fakeCorrectionSource) HasBoundaryOverlap(
	_ context.Context, _ database.DBTX, _ datarepairdb.CorrectionSource, _ time.Time,
) (bool, error) {
	return f.overlap, f.err
}

func newDurationCorrectionFixture() (*caseHandlerFixture, *fakeCorrectionSource, *fakeDriveRepo) {
	start := testNow.Add(-2 * time.Hour)
	end := start.Add(time.Hour)
	duration := int64(900)
	repairCase := sampleRepairCase(17, systemmodel.RepairCaseStatusOpen)
	repairCase.SessionID = 50
	repairCase.Rule = datarepairdb.RuleDurationMismatch
	repairCase.Applicable = false
	repairCase.EvidenceStartedAt = start
	repairCase.EvidenceStoredEndedAt = &end
	f := newCaseHandlerFixture(repairCase)
	source := &fakeCorrectionSource{source: &datarepairdb.CorrectionSource{
		Kind: datarepairdb.AnomalyKindDrive, ID: 50, VehicleID: 7,
		StartedAt: start, EndedAt: &end, DurationS: &duration,
	}}
	f.handler.correctionRepo = source
	drive := &fakeDriveRepo{partialFn: func(_ context.Context, _ int64, fields map[string]interface{}) error {
		if value, ok := fields["duration_s"].(int64); ok {
			source.source.DurationS = &value
		}
		if value, ok := fields["distance_m"].(float64); ok {
			source.source.DistanceM = &value
		}
		return nil
	}}
	f.handler.driveRepo = drive
	originalTransaction := f.handler.transaction
	f.handler.transaction = func(ctx context.Context, fn func(database.DBTX) error) error {
		snapshot := *source.source
		err := originalTransaction(ctx, fn)
		if err != nil {
			source.source = &snapshot
		}
		return err
	}
	return f, source, drive
}

func correctionRequestBody(updatedAt time.Time, field, mode string, value *float64, hash string) string {
	body := map[string]interface{}{
		"expected_updated_at": updatedAt.Format(time.RFC3339Nano),
		"field":               field, "mode": mode, "value": value,
	}
	if hash != "" {
		body["expected_source_hash"] = hash
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func previewCaseCorrection(t *testing.T, f *caseHandlerFixture, field, mode string, value *float64) caseCorrectionPreview {
	t.Helper()
	body := correctionRequestBody(f.repo.cases[17].UpdatedAt, field, mode, value, "")
	rec := doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction-preview", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var result caseCorrectionPreview
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCaseCorrectionPreviewAndApplyAreAtomic(t *testing.T) {
	f, source, drive := newDurationCorrectionFixture()
	preview := previewCaseCorrection(t, f, "duration_s", "derive", nil)
	if drive.partialCalls != 0 || f.auditCalls != 0 || f.repo.cases[17].Status != systemmodel.RepairCaseStatusOpen {
		t.Fatal("preview must not mutate the source or case")
	}
	if len(preview.Changes) != 1 || *preview.Changes[0].Before != 900 || *preview.Changes[0].After != 3600 {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	body := correctionRequestBody(preview.CaseUpdatedAt, "duration_s", "derive", nil, preview.SourceHash)
	rec := doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("apply status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if source.locks != 1 || drive.partialCalls != 1 || *source.source.DurationS != 3600 {
		t.Fatalf("source not locked and corrected: locks=%d writes=%d", source.locks, drive.partialCalls)
	}
	if f.repo.cases[17].Status != systemmodel.RepairCaseStatusApplied || len(f.audits) != 2 {
		t.Fatalf("case and source audit must commit together: case=%s audit=%d", f.repo.cases[17].Status, len(f.audits))
	}
	if f.audits[0].Action != AuditActionUpdateDrive || f.audits[1].Action != AuditActionCaseApply ||
		!strings.Contains(f.audits[0].Detail, `"before":900`) ||
		!strings.Contains(f.audits[0].Detail, `"after":3600`) {
		t.Fatalf("audit lacks the reviewed change: %+v", f.audits)
	}
}

func TestCaseCorrectionRejectsChangedSourceCaseOrReviewedChoice(t *testing.T) {
	for _, changed := range []string{"source", "case", "choice"} {
		t.Run(changed, func(t *testing.T) {
			f, source, drive := newDurationCorrectionFixture()
			if changed == "choice" {
				negative := -100.0
				source.source.DistanceM = &negative
				f.repo.cases[17].Rule = datarepairdb.RuleNegativeDistanceM
			}
			field, mode := "duration_s", "derive"
			var value *float64
			if changed == "choice" {
				field, mode = "distance_m", "replace"
				number := 100.0
				value = &number
			}
			preview := previewCaseCorrection(t, f, field, mode, value)
			switch changed {
			case "source":
				newDuration := int64(600)
				source.source.DurationS = &newDuration
			case "case":
				f.repo.cases[17].UpdatedAt = f.repo.cases[17].UpdatedAt.Add(time.Second)
			case "choice":
				other := 200.0
				value = &other
			}
			body := correctionRequestBody(preview.CaseUpdatedAt, field, mode, value, preview.SourceHash)
			rec := doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction", strings.NewReader(body))
			if rec.Code != http.StatusConflict || drive.partialCalls != 0 || len(f.audits) != 0 {
				t.Fatalf("changed %s must conflict without mutation: status=%d body=%s", changed, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestCaseCorrectionRollsBackWhenAuditFails(t *testing.T) {
	f, source, _ := newDurationCorrectionFixture()
	preview := previewCaseCorrection(t, f, "duration_s", "derive", nil)
	f.auditFailAt = 2
	body := correctionRequestBody(preview.CaseUpdatedAt, "duration_s", "derive", nil, preview.SourceHash)
	rec := doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction", strings.NewReader(body))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if *source.source.DurationS != 900 || f.repo.cases[17].Status != systemmodel.RepairCaseStatusOpen || len(f.audits) != 0 {
		t.Fatalf("failed audit must roll back source and case: duration=%d case=%s audits=%d",
			*source.source.DurationS, f.repo.cases[17].Status, len(f.audits))
	}
}

func TestCaseCorrectionRejectsInvalidOrStaleEvidence(t *testing.T) {
	for _, tt := range []struct {
		name   string
		change func(*caseHandlerFixture, *fakeCorrectionSource)
		body   string
		status int
	}{
		{
			name: "stale anomaly",
			change: func(_ *caseHandlerFixture, source *fakeCorrectionSource) {
				duration := int64(3600)
				source.source.DurationS = &duration
			},
			status: http.StatusConflict,
		},
		{
			name: "changed boundary",
			change: func(_ *caseHandlerFixture, source *fakeCorrectionSource) {
				end := source.source.EndedAt.Add(time.Minute)
				source.source.EndedAt = &end
			},
			status: http.StatusConflict,
		},
		{
			name: "invalid field",
			body: fmt.Sprintf(`{"expected_updated_at":%q,"field":"distance_m","mode":"derive","value":null}`,
				sampleRepairCase(17, systemmodel.RepairCaseStatusOpen).UpdatedAt.Format(time.RFC3339Nano)),
			status: http.StatusBadRequest,
		},
		{
			name:   "source error",
			change: func(_ *caseHandlerFixture, source *fakeCorrectionSource) { source.err = errBoom },
			status: http.StatusInternalServerError,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f, source, drive := newDurationCorrectionFixture()
			if tt.change != nil {
				tt.change(f, source)
			}
			body := tt.body
			if body == "" {
				body = correctionRequestBody(f.repo.cases[17].UpdatedAt, "duration_s", "derive", nil, "")
			}
			rec := doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction-preview", strings.NewReader(body))
			if rec.Code != tt.status || drive.partialCalls != 0 || f.auditCalls != 0 {
				t.Fatalf("status=%d, want=%d, body=%s", rec.Code, tt.status, rec.Body.String())
			}
			if tt.name == "source error" && strings.Contains(rec.Body.String(), "boom") {
				t.Fatal("internal database errors must not be exposed in the response")
			}
		})
	}
}

func TestCaseBoundaryCorrectionRechecksBothSessionsAndOverlaps(t *testing.T) {
	for _, changed := range []string{"none", "related", "new overlap"} {
		t.Run(changed, func(t *testing.T) {
			f, source, drive := newDurationCorrectionFixture()
			primary := source.source
			relatedStart := primary.StartedAt.Add(30 * time.Minute)
			relatedEnd := primary.StartedAt.Add(90 * time.Minute)
			source.related = &datarepairdb.CorrectionSource{
				Kind: datarepairdb.AnomalyKindCharging, ID: 51, VehicleID: primary.VehicleID,
				StartedAt: relatedStart, EndedAt: &relatedEnd,
			}
			repairCase := f.repo.cases[17]
			repairCase.Rule = datarepairdb.RuleCrossKindOverlap
			relatedID := source.related.ID
			repairCase.RelatedSessionID = &relatedID
			body := func(hash string) string {
				value := map[string]interface{}{
					"expected_updated_at": repairCase.UpdatedAt.Format(time.RFC3339Nano),
					"field":               "ended_at", "mode": "boundary", "target": "primary",
					"ended_at": relatedStart.Format(time.RFC3339Nano),
				}
				if hash != "" {
					value["expected_source_hash"] = hash
				}
				encoded, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				return string(encoded)
			}
			rec := doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction-preview", strings.NewReader(body("")))
			if rec.Code != http.StatusOK {
				t.Fatalf("preview = %d: %s", rec.Code, rec.Body.String())
			}
			var preview caseCorrectionPreview
			if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
				t.Fatal(err)
			}
			if preview.Other == nil || preview.Other.ID != 51 || len(preview.Changes) != 2 {
				t.Fatalf("preview must include both windows and duration: %+v", preview)
			}
			switch changed {
			case "related":
				source.related.StartedAt = source.related.StartedAt.Add(time.Minute)
			case "new overlap":
				source.overlap = true
			}
			drive.conditionalFn = func(_ context.Context, _ int64, expected *time.Time, end time.Time, seconds int64) (bool, error) {
				if !sameOptionalTime(expected, primary.EndedAt) || !end.Equal(relatedStart) || seconds != 1800 {
					t.Errorf("unexpected boundary write: expected=%v end=%v duration=%d", expected, end, seconds)
				}
				return true, nil
			}
			rec = doCaseRequest(t, f.handler, http.MethodPost, "/data-repair/cases/17/correction", strings.NewReader(body(preview.SourceHash)))
			if changed != "none" {
				if rec.Code != http.StatusConflict || drive.partialCalls != 0 || len(f.audits) != 0 {
					t.Fatalf("changed evidence must conflict: %d %s", rec.Code, rec.Body.String())
				}
				return
			}
			if rec.Code != http.StatusOK || source.locks != 2 || drive.partialCalls != 1 ||
				f.repo.cases[17].Status != systemmodel.RepairCaseStatusApplied || len(f.audits) != 2 {
				t.Fatalf("boundary and case not committed together: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}
