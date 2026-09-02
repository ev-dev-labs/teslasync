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
	"github.com/ev-dev-labs/teslasync/internal/enums"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

func floatPtr(v float64) *float64 { return &v }
func stringPtr(v string) *string  { return &v }
func int64Ptr(v int64) *int64     { return &v }
func int16Ptr(v int16) *int16     { return &v }

func previewBody(endedAt time.Time, rule systemmodel.SessionRepairRule, expected string) string {
	return fmt.Sprintf(
		`{"ended_at":%q,"rule":%q,"expected_stored_ended_at":%q}`,
		rfc(endedAt), rule, expected,
	)
}

func decodePreview(t *testing.T, recBody string) closePreviewResponse {
	t.Helper()
	var out closePreviewResponse
	if err := json.Unmarshal([]byte(recBody), &out); err != nil {
		t.Fatalf("decode preview response: %v (raw=%s)", err, recBody)
	}
	return out
}

func hasChangedField(out closePreviewResponse, field string) bool {
	for _, ch := range out.FieldsChanged {
		if ch.Field == field {
			return true
		}
	}
	return false
}

func hasPreservedField(out closePreviewResponse, field string) bool {
	for _, p := range out.FieldsPreserved {
		if p.Field == field {
			return true
		}
	}
	return false
}

func assertNoPreviewSideEffects(t *testing.T, f *applyFixture) {
	t.Helper()
	if f.drives != nil && (f.drives.partialCalls != 0 || f.drives.deleteCalls != 0) {
		t.Fatalf("drive mutations: partial=%d delete=%d, want none", f.drives.partialCalls, f.drives.deleteCalls)
	}
	if f.charging != nil && (f.charging.partialCalls != 0 || f.charging.deleteCalls != 0) {
		t.Fatalf("charging mutations: partial=%d delete=%d, want none", f.charging.partialCalls, f.charging.deleteCalls)
	}
	if len(f.audits) != 0 {
		t.Fatalf("audit rows = %d, want 0 for preview", len(f.audits))
	}
}

func newDrivePreviewFixture(storedEnd *time.Time) *applyFixture {
	start := testNow.Add(-6 * time.Hour)

	f := &applyFixture{}
	f.drives = &fakeDriveRepo{
		getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
			return &drivemodel.Drive{
				ID:              id,
				VehicleID:       7,
				StartTs:         start,
				EndTs:           storedEnd,
				DurationS:       3600,
				DistanceM:       3210.5,
				EnergyUsedWh:    floatPtr(8900),
				RegenEnergyWh:   floatPtr(450),
				AvgSpeedMps:     floatPtr(18),
				MaxSpeedMps:     floatPtr(31),
				AvgPowerW:       floatPtr(12000),
				StartBatteryPct: int16Ptr(80),
				EndBatteryPct:   int16Ptr(72),
			}, nil
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
		clock:        func() time.Time { return testNow },
		diagnosis:    f.source,
		audit: func(_ context.Context, _ database.DBTX, e auditEntry) error {
			f.audits = append(f.audits, e)
			return nil
		},
	}
	return f
}

func newChargingPreviewFixture(storedEnd *time.Time) *applyFixture {
	start := testNow.Add(-8 * time.Hour)
	stopped := testNow.Add(-6 * time.Hour)

	f := &applyFixture{}
	f.charging = &fakeChargingRepo{
		getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
			return &chargingmodel.ChargingSession{
				ID:                 id,
				VehicleID:          7,
				StartedAt:          start,
				EndedAt:            storedEnd,
				StartSocPct:        floatPtr(20),
				EndSocPct:          floatPtr(75),
				DeltaSocPct:        floatPtr(55),
				TotalEnergyAddedWh: floatPtr(41000),
				PeakPowerW:         floatPtr(11000),
				AvgPowerW:          floatPtr(7200),
				CostDecimal:        floatPtr(12.34),
				CostCurrency:       stringPtr("USD"),
				CostSource:         stringPtr(systemmodel.CostSourceManual),
				RateID:             int64Ptr(22),
				GeofenceID:         int64Ptr(33),
			}, nil
		},
	}
	f.drives = &fakeDriveRepo{}
	f.source = &fakeDiagnosis{
		chargesByID: map[int64]datarepairCandidate{3: candidate(3, 7, start, storedEnd)},
		powerObs:    []datarepairObs{chargingPowerObs(testNow.Add(-6*time.Hour-5*time.Minute), 11000)},
		chargeStates: []datarepairObs{
			chargeStateObs(testNow.Add(-7*time.Hour), enums.ChargeStateCharging),
			chargeStateObs(stopped, enums.ChargeStateDisconnected),
		},
	}
	f.handler = &DataRepairHandler{
		chargingRepo: f.charging,
		driveRepo:    f.drives,
		clock:        func() time.Time { return testNow },
		diagnosis:    f.source,
		audit: func(_ context.Context, _ database.DBTX, e auditEntry) error {
			f.audits = append(f.audits, e)
			return nil
		},
	}
	return f
}

func TestPreviewDrive_HappyPathNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	f := newDrivePreviewFixture(nil)
	proposed := testNow.Add(-5 * time.Hour)
	body := previewBody(proposed, systemmodel.SessionRepairRuleDriveOpenChargingStarted, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/preview", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)

	out := decodePreview(t, rec.Body.String())
	if out.Kind != systemmodel.SessionRepairKindDrive || out.SessionID != 1 {
		t.Fatalf("kind/id = %s/%d, want drive/1", out.Kind, out.SessionID)
	}
	if out.Status != previewStatusReady {
		t.Errorf("status = %q, want ready", out.Status)
	}
	if out.Rule != string(systemmodel.SessionRepairRuleDriveOpenChargingStarted) || out.Source != "suggestion" {
		t.Errorf("rule/source = %q/%q", out.Rule, out.Source)
	}
	if out.CurrentEndedAt != nil {
		t.Errorf("current_ended_at = %s, want nil", out.CurrentEndedAt)
	}
	if !out.ProposedEndedAt.Equal(proposed) {
		t.Errorf("proposed_ended_at = %s, want %s", out.ProposedEndedAt, proposed)
	}
	if out.CurrentDurationS != nil {
		t.Errorf("current_duration_s = %v, want nil for open drive", *out.CurrentDurationS)
	}
	if out.ProposedDurationS != 3600 {
		t.Errorf("proposed_duration_s = %d, want 3600", out.ProposedDurationS)
	}
	for _, field := range []string{"ended_at", "duration_s"} {
		if !hasChangedField(out, field) {
			t.Errorf("fields_changed missing %s: %+v", field, out.FieldsChanged)
		}
	}
	for _, field := range []string{"distance_m", "energy_used_wh", "avg_speed_mps", "avg_power_w", "start_battery_pct"} {
		if !hasPreservedField(out, field) {
			t.Errorf("fields_preserved missing %s: %+v", field, out.FieldsPreserved)
		}
	}
}

func TestPreviewDrive_RejectsStaleSuggestionNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	f := newDrivePreviewFixture(nil)
	body := previewBody(testNow.Add(-4*time.Hour), systemmodel.SessionRepairRuleDriveOpenChargingStarted, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/preview", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	if got := bodyError(t, rec); !strings.Contains(got, "boundary no longer matches") {
		t.Errorf("error = %q, want stale suggestion conflict", got)
	}
}

func TestPreviewDrive_RejectsConcurrencyConflictNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	alreadyClosedAt := testNow.Add(-3 * time.Hour)
	f := newDrivePreviewFixture(&alreadyClosedAt)
	body := previewBody(testNow.Add(-5*time.Hour), systemmodel.SessionRepairRuleDriveOpenChargingStarted, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/preview", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	if got := bodyError(t, rec); !strings.Contains(got, "no longer open") {
		t.Errorf("error = %q, want stale-open conflict", got)
	}
}

func TestPreviewDrive_RejectsInvalidTimestampNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	f := newDrivePreviewFixture(nil)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/preview",
		strings.NewReader(`{"ended_at":"not-a-time","rule":"manual","expected_stored_ended_at":""}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	if got := bodyError(t, rec); !strings.Contains(got, "RFC3339") {
		t.Errorf("error = %q, want RFC3339 validation", got)
	}
}

func TestPreviewDrive_AlreadyAppliedNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	proposed := testNow.Add(-5 * time.Hour)
	f := newDrivePreviewFixture(&proposed)
	body := previewBody(proposed, systemmodel.SessionRepairRuleDriveOpenChargingStarted, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/drive/1/preview", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	out := decodePreview(t, rec.Body.String())
	if out.Status != previewStatusAlreadyApplied {
		t.Errorf("status = %q, want already_applied", out.Status)
	}
	if len(out.FieldsChanged) != 0 {
		t.Errorf("fields_changed = %+v, want empty for already_applied", out.FieldsChanged)
	}
	if out.CurrentEndedAt == nil || !out.CurrentEndedAt.Equal(proposed) {
		t.Errorf("current_ended_at = %v, want %s", out.CurrentEndedAt, proposed)
	}
}

func TestPreviewCharging_HappyPathNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	f := newChargingPreviewFixture(nil)
	proposed := testNow.Add(-6 * time.Hour)
	body := previewBody(proposed, systemmodel.SessionRepairRuleChargingOpenChargeEnded, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/charging/3/preview", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)

	out := decodePreview(t, rec.Body.String())
	if out.Kind != systemmodel.SessionRepairKindCharging || out.SessionID != 3 {
		t.Fatalf("kind/id = %s/%d, want charging/3", out.Kind, out.SessionID)
	}
	if out.Status != previewStatusReady {
		t.Errorf("status = %q, want ready", out.Status)
	}
	if out.CurrentDurationS != nil {
		t.Errorf("current_duration_s = %v, want nil for open charging session", *out.CurrentDurationS)
	}
	if out.ProposedDurationS != 7200 {
		t.Errorf("proposed_duration_s = %d, want 7200", out.ProposedDurationS)
	}
	if !hasChangedField(out, "ended_at") {
		t.Errorf("fields_changed missing ended_at: %+v", out.FieldsChanged)
	}
	if hasChangedField(out, "duration_s") {
		t.Errorf("charging fields_changed must not include stored duration_s: %+v", out.FieldsChanged)
	}
	for _, field := range []string{"total_energy_added_wh", "peak_power_w", "cost_decimal", "start_soc_pct", "end_soc_pct"} {
		if !hasPreservedField(out, field) {
			t.Errorf("fields_preserved missing %s: %+v", field, out.FieldsPreserved)
		}
	}
}

func TestPreviewCharging_RejectsStaleSuggestionNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	f := newChargingPreviewFixture(nil)
	body := previewBody(testNow.Add(-5*time.Hour), systemmodel.SessionRepairRuleChargingOpenChargeEnded, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/charging/3/preview", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	if got := bodyError(t, rec); !strings.Contains(got, "boundary no longer matches") {
		t.Errorf("error = %q, want stale suggestion conflict", got)
	}
}

func TestPreviewCharging_RejectsConcurrencyConflictNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	alreadyClosedAt := testNow.Add(-3 * time.Hour)
	f := newChargingPreviewFixture(&alreadyClosedAt)
	body := previewBody(testNow.Add(-6*time.Hour), systemmodel.SessionRepairRuleChargingOpenChargeEnded, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/charging/3/preview", strings.NewReader(body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	if got := bodyError(t, rec); !strings.Contains(got, "no longer open") {
		t.Errorf("error = %q, want stale-open conflict", got)
	}
}

func TestPreviewCharging_RejectsInvalidTimestampNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	f := newChargingPreviewFixture(nil)
	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/charging/3/preview",
		strings.NewReader(`{"ended_at":"not-a-time","rule":"manual","expected_stored_ended_at":""}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	if got := bodyError(t, rec); !strings.Contains(got, "RFC3339") {
		t.Errorf("error = %q, want RFC3339 validation", got)
	}
}

func TestPreviewCharging_AlreadyAppliedNoMutationOrAudit(t *testing.T) {
	t.Parallel()

	proposed := testNow.Add(-6 * time.Hour)
	f := newChargingPreviewFixture(&proposed)
	body := previewBody(proposed, systemmodel.SessionRepairRuleChargingOpenChargeEnded, "")

	rec := doReq(t, f.handler, http.MethodPost, "/data-repair/charging/3/preview", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	assertNoPreviewSideEffects(t, f)
	out := decodePreview(t, rec.Body.String())
	if out.Status != previewStatusAlreadyApplied {
		t.Errorf("status = %q, want already_applied", out.Status)
	}
	if len(out.FieldsChanged) != 0 {
		t.Errorf("fields_changed = %+v, want empty for already_applied", out.FieldsChanged)
	}
	if out.CurrentDurationS == nil || *out.CurrentDurationS != 7200 {
		t.Errorf("current_duration_s = %v, want 7200", out.CurrentDurationS)
	}
}
