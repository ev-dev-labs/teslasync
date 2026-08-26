package datarepair

import (
	"testing"
	"time"
)

// Every function under test here is pure (no I/O, no *Repo receiver), which
// is what lets these anomaly-detection rules be pinned without a live
// PostgreSQL instance — consistent with the rest of this package's test
// suite (see repo_test.go / case_repo_test.go doc comments).

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return ts
}

// ---------------------------------------------------------------------------
// clampAnomalyLimit
// ---------------------------------------------------------------------------

func TestClampAnomalyLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{"zero uses default", 0, defaultAnomalyLimit},
		{"negative uses default", -5, defaultAnomalyLimit},
		{"within range is unchanged", 42, 42},
		{"exactly the hard max is unchanged", maxAnomalyLimit, maxAnomalyLimit},
		{"above the hard max is clamped down", maxAnomalyLimit + 1000, maxAnomalyLimit},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := clampAnomalyLimit(tt.limit); got != tt.want {
				t.Errorf("clampAnomalyLimit(%d) = %d, want %d", tt.limit, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// classifyDriveRow
// ---------------------------------------------------------------------------

func TestClassifyDriveRow_Clean(t *testing.T) {
	t.Parallel()

	start := mustTime(t, "2026-01-01T10:00:00Z")
	end := mustTime(t, "2026-01-01T10:30:00Z")
	duration := int64(1800)
	distance := 12000.0

	row := driveAnomalyRow{
		ID: 1, VehicleID: 7, StartedAt: start, EndedAt: &end,
		DurationS: &duration, DistanceM: &distance,
	}
	got := classifyDriveRow(row)
	if len(got) != 0 {
		t.Errorf("classifyDriveRow(clean row) = %+v, want no anomalies", got)
	}
}

func TestClassifyDriveRow_EndedBeforeStarted(t *testing.T) {
	t.Parallel()

	start := mustTime(t, "2026-01-01T10:00:00Z")
	end := start.Add(-1 * time.Minute)
	row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, EndedAt: &end}

	got := findRule(t, classifyDriveRow(row), RuleEndedBeforeStarted)
	if got.Kind != AnomalyKindDrive || got.SessionID != 1 || got.VehicleID != 7 {
		t.Errorf("unexpected identity fields: %+v", got)
	}
	if got.Severity != AnomalySeverityHigh || got.Confidence != AnomalyConfidenceHigh {
		t.Errorf("unexpected severity/confidence: %+v", got)
	}
	if got.Applicable {
		t.Error("Applicable must always be false from this detector")
	}

	// ended_at exactly equal to started_at is also "not after" -> flagged.
	equal := start
	rowEqual := driveAnomalyRow{ID: 2, VehicleID: 7, StartedAt: start, EndedAt: &equal}
	findRule(t, classifyDriveRow(rowEqual), RuleEndedBeforeStarted)
}

func TestClassifyDriveRow_DurationMismatch(t *testing.T) {
	t.Parallel()

	start := mustTime(t, "2026-01-01T10:00:00Z")
	end := mustTime(t, "2026-01-01T10:30:00Z") // wall clock = 1800s

	t.Run("within tolerance is not flagged", func(t *testing.T) {
		t.Parallel()
		stored := int64(1800 + durationMismatchToleranceS) // exactly at tolerance boundary
		row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, EndedAt: &end, DurationS: &stored}
		if got := classifyDriveRow(row); anyRule(got, RuleDurationMismatch) {
			t.Errorf("expected no duration_mismatch at exact tolerance boundary, got %+v", got)
		}
	})

	t.Run("beyond tolerance is flagged with facts", func(t *testing.T) {
		t.Parallel()
		stored := int64(1800 + durationMismatchToleranceS + 1)
		row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, EndedAt: &end, DurationS: &stored}
		a := findRule(t, classifyDriveRow(row), RuleDurationMismatch)
		if a.Facts.StoredDurationS == nil || *a.Facts.StoredDurationS != stored {
			t.Errorf("StoredDurationS fact = %v, want %d", a.Facts.StoredDurationS, stored)
		}
		if a.Facts.ComputedDurationS == nil || *a.Facts.ComputedDurationS != 1800 {
			t.Errorf("ComputedDurationS fact = %v, want 1800", a.Facts.ComputedDurationS)
		}
		if a.Facts.ToleranceS == nil || *a.Facts.ToleranceS != durationMismatchToleranceS {
			t.Errorf("ToleranceS fact = %v, want %d", a.Facts.ToleranceS, durationMismatchToleranceS)
		}
	})

	t.Run("no stored duration never flags", func(t *testing.T) {
		t.Parallel()
		row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, EndedAt: &end, DurationS: nil}
		if got := classifyDriveRow(row); anyRule(got, RuleDurationMismatch) {
			t.Errorf("expected no duration_mismatch without a stored duration, got %+v", got)
		}
	})
}

func TestClassifyDriveRow_OdometerRollback(t *testing.T) {
	t.Parallel()

	start := mustTime(t, "2026-01-01T10:00:00Z")

	t.Run("material rollback flagged", func(t *testing.T) {
		t.Parallel()
		startOdo, endOdo := 10000.0, 9000.0
		row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, StartOdometerM: &startOdo, EndOdometerM: &endOdo}
		a := findRule(t, classifyDriveRow(row), RuleOdometerRollback)
		if a.Severity != AnomalySeverityHigh {
			t.Errorf("Severity = %v, want high", a.Severity)
		}
		if *a.Facts.StartOdometerM != startOdo || *a.Facts.EndOdometerM != endOdo {
			t.Errorf("odometer facts = %+v", a.Facts)
		}
	})

	t.Run("within tolerance not flagged", func(t *testing.T) {
		t.Parallel()
		startOdo := 10000.0
		endOdo := 10000.0 - odometerRollbackToleranceM // exactly at boundary
		row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, StartOdometerM: &startOdo, EndOdometerM: &endOdo}
		if got := classifyDriveRow(row); anyRule(got, RuleOdometerRollback) {
			t.Errorf("expected no rollback at tolerance boundary, got %+v", got)
		}
	})

	t.Run("missing either side never flags", func(t *testing.T) {
		t.Parallel()
		endOdo := 100.0
		row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, StartOdometerM: nil, EndOdometerM: &endOdo}
		if got := classifyDriveRow(row); anyRule(got, RuleOdometerRollback) {
			t.Errorf("expected no rollback when start is nil, got %+v", got)
		}
	})
}

func TestClassifyDriveRow_SocInconsistent(t *testing.T) {
	t.Parallel()
	start := mustTime(t, "2026-01-01T10:00:00Z")

	// Drives should not GAIN materially more SoC than they started with.
	startSoc, endSoc := 50.0, 50.0+socToleranceDrivePct+1
	row := driveAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, StartSocPct: &startSoc, EndSocPct: &endSoc}
	a := findRule(t, classifyDriveRow(row), RuleSocInconsistent)
	if a.Confidence != AnomalyConfidenceMedium {
		t.Errorf("Confidence = %v, want medium for a directional SoC inference", a.Confidence)
	}
	if *a.Facts.StartSocPct != startSoc || *a.Facts.EndSocPct != endSoc {
		t.Errorf("soc facts = %+v", a.Facts)
	}

	// A small decrease (normal driving) must never flag.
	endSocNormal := 40.0
	rowNormal := driveAnomalyRow{ID: 2, VehicleID: 7, StartedAt: start, StartSocPct: &startSoc, EndSocPct: &endSocNormal}
	if got := classifyDriveRow(rowNormal); anyRule(got, RuleSocInconsistent) {
		t.Errorf("expected no soc_inconsistent for normal depletion, got %+v", got)
	}
}

func TestClassifyDriveRow_NegativeAggregates(t *testing.T) {
	t.Parallel()
	start := mustTime(t, "2026-01-01T10:00:00Z")

	negDistance := -1.0
	negDuration := int64(-1)
	negEnergyUsed := -1.0
	negRegen := -1.0
	row := driveAnomalyRow{
		ID: 1, VehicleID: 7, StartedAt: start,
		DistanceM: &negDistance, DurationS: &negDuration,
		EnergyUsedWh: &negEnergyUsed, RegenEnergyWh: &negRegen,
	}
	got := classifyDriveRow(row)

	wantFields := map[string]string{
		"distance_m":      RuleNegativeDistanceM,
		"duration_s":      RuleNegativeDurationS,
		"energy_used_wh":  RuleNegativeEnergyUsedWh,
		"regen_energy_wh": RuleNegativeRegenEnergyWh,
	}
	seenFields := make(map[string]bool, len(wantFields))
	for _, a := range got {
		wantRule, ok := wantFields[a.Facts.NegativeField]
		if !ok {
			t.Errorf("unexpected negative field %q", a.Facts.NegativeField)
			continue
		}
		if a.Rule != wantRule {
			t.Errorf("Rule for %s = %q, want %q", a.Facts.NegativeField, a.Rule, wantRule)
		}
		seenFields[a.Facts.NegativeField] = true
		if a.Facts.NegativeValue == nil || *a.Facts.NegativeValue != -1.0 {
			t.Errorf("NegativeValue for %s = %v, want -1.0", a.Facts.NegativeField, a.Facts.NegativeValue)
		}
	}
	for field := range wantFields {
		if !seenFields[field] {
			t.Errorf("expected a negative_aggregate anomaly for %s", field)
		}
	}
	if len(got) != len(wantFields) {
		t.Errorf("classifyDriveRow returned %d anomalies, want exactly %d", len(got), len(wantFields))
	}
}

// ---------------------------------------------------------------------------
// classifyChargingRow
// ---------------------------------------------------------------------------

func TestClassifyChargingRow_Clean(t *testing.T) {
	t.Parallel()
	start := mustTime(t, "2026-01-01T10:00:00Z")
	end := mustTime(t, "2026-01-01T11:00:00Z")
	energy := 5000.0
	row := chargingAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, EndedAt: &end, TotalEnergyAddedWh: &energy}
	if got := classifyChargingRow(row); len(got) != 0 {
		t.Errorf("classifyChargingRow(clean row) = %+v, want none", got)
	}
}

func TestClassifyChargingRow_SocInconsistent(t *testing.T) {
	t.Parallel()
	start := mustTime(t, "2026-01-01T10:00:00Z")

	// Charging should not materially LOSE SoC.
	startSoc, endSoc := 50.0, 50.0-socToleranceChargingPct-1
	row := chargingAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, StartSocPct: &startSoc, EndSocPct: &endSoc}
	a := findRule(t, classifyChargingRow(row), RuleSocInconsistent)
	if a.Confidence != AnomalyConfidenceMedium {
		t.Errorf("Confidence = %v, want medium for a directional SoC inference", a.Confidence)
	}

	// Normal charging increase must never flag.
	endSocNormal := 80.0
	rowNormal := chargingAnomalyRow{ID: 2, VehicleID: 7, StartedAt: start, StartSocPct: &startSoc, EndSocPct: &endSocNormal}
	if got := classifyChargingRow(rowNormal); anyRule(got, RuleSocInconsistent) {
		t.Errorf("expected no soc_inconsistent for normal charging gain, got %+v", got)
	}
}

func TestClassifyChargingRow_NegativeEnergyAdded(t *testing.T) {
	t.Parallel()
	start := mustTime(t, "2026-01-01T10:00:00Z")
	neg := -5.0
	row := chargingAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, TotalEnergyAddedWh: &neg}
	a := findRule(t, classifyChargingRow(row), RuleNegativeEnergyAddedWh)
	if a.Facts.NegativeField != "total_energy_added_wh" {
		t.Errorf("NegativeField = %q, want total_energy_added_wh", a.Facts.NegativeField)
	}
}

func TestClassifyChargingRow_OdometerRollback(t *testing.T) {
	t.Parallel()
	start := mustTime(t, "2026-01-01T10:00:00Z")
	startOdo, endOdo := 5000.0, 100.0
	row := chargingAnomalyRow{ID: 1, VehicleID: 7, StartedAt: start, StartOdometerM: &startOdo, EndOdometerM: &endOdo}
	findRule(t, classifyChargingRow(row), RuleOdometerRollback)
}

// ---------------------------------------------------------------------------
// classifyOverlap / overlapSeconds
// ---------------------------------------------------------------------------

func TestClassifyOverlap_SameKindPartialOverlap(t *testing.T) {
	t.Parallel()
	s1 := mustTime(t, "2026-01-01T10:00:00Z")
	e1 := mustTime(t, "2026-01-01T10:30:00Z")
	s2 := mustTime(t, "2026-01-01T10:20:00Z")
	e2 := mustTime(t, "2026-01-01T10:50:00Z")

	c := overlapCandidate{
		Kind: AnomalyKindDrive, VehicleID: 7, SameKind: true,
		SessionID: 1, SessionStartedAt: s1, SessionEndedAt: e1,
		RelatedSessionID: 2, RelatedStartedAt: s2, RelatedEndedAt: e2,
	}
	a := classifyOverlap(c)
	if a.Rule != RuleSameKindOverlapDrive {
		t.Errorf("Rule = %s, want %s", a.Rule, RuleSameKindOverlapDrive)
	}
	if a.RelatedSessionID == nil || *a.RelatedSessionID != 2 {
		t.Errorf("RelatedSessionID = %v, want 2", a.RelatedSessionID)
	}
	if a.Facts.OverlapSeconds == nil || *a.Facts.OverlapSeconds != 600 {
		t.Errorf("OverlapSeconds = %v, want 600", a.Facts.OverlapSeconds)
	}
	if a.Applicable {
		t.Error("Applicable must always be false")
	}
}

func TestClassifyOverlap_IdenticalWindowIsDuplicate(t *testing.T) {
	t.Parallel()
	s := mustTime(t, "2026-01-01T10:00:00Z")
	e := mustTime(t, "2026-01-01T10:30:00Z")

	c := overlapCandidate{
		Kind: AnomalyKindCharging, VehicleID: 7, SameKind: true,
		SessionID: 1, SessionStartedAt: s, SessionEndedAt: e,
		RelatedSessionID: 2, RelatedStartedAt: s, RelatedEndedAt: e,
	}
	a := classifyOverlap(c)
	if a.Rule != RuleDuplicateSessionWindow {
		t.Errorf("Rule = %s, want %s", a.Rule, RuleDuplicateSessionWindow)
	}
	if a.Severity != AnomalySeverityHigh {
		t.Errorf("Severity = %v, want high for a duplicate window", a.Severity)
	}
}

func TestClassifyOverlap_CrossKindAlwaysDriveIsPrimary(t *testing.T) {
	t.Parallel()
	s1 := mustTime(t, "2026-01-01T10:00:00Z")
	e1 := mustTime(t, "2026-01-01T10:30:00Z")
	s2 := mustTime(t, "2026-01-01T10:10:00Z")
	e2 := mustTime(t, "2026-01-01T10:20:00Z")

	c := overlapCandidate{
		Kind: AnomalyKindDrive, VehicleID: 7, SameKind: false,
		SessionID: 10, SessionStartedAt: s1, SessionEndedAt: e1,
		RelatedSessionID: 20, RelatedStartedAt: s2, RelatedEndedAt: e2,
	}
	a := classifyOverlap(c)
	if a.Rule != RuleCrossKindOverlap {
		t.Errorf("Rule = %s, want %s", a.Rule, RuleCrossKindOverlap)
	}
	if a.Kind != AnomalyKindDrive {
		t.Errorf("Kind = %v, want AnomalyKindDrive for a cross-kind pair", a.Kind)
	}
	if a.SessionID != 10 || a.RelatedSessionID == nil || *a.RelatedSessionID != 20 {
		t.Errorf("SessionID/RelatedSessionID = %d/%v, want drive=10 primary, charging=20 related", a.SessionID, a.RelatedSessionID)
	}
	// An identical window on a cross-kind pair must NOT be reclassified as a
	// duplicate — a drive and a charging session are never "the same row
	// re-ingested".
	identical := overlapCandidate{
		Kind: AnomalyKindDrive, VehicleID: 7, SameKind: false,
		SessionID: 10, SessionStartedAt: s1, SessionEndedAt: e1,
		RelatedSessionID: 20, RelatedStartedAt: s1, RelatedEndedAt: e1,
	}
	if got := classifyOverlap(identical).Rule; got != RuleCrossKindOverlap {
		t.Errorf("identical cross-kind window Rule = %s, want %s (never duplicate_session_window)", got, RuleCrossKindOverlap)
	}
}

func TestOverlapSeconds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		aStart, aEnd string
		bStart, bEnd string
		want         int64
	}{
		{"fully nested", "10:00:00", "11:00:00", "10:15:00", "10:45:00", 1800},
		{"partial overlap", "10:00:00", "10:30:00", "10:20:00", "10:50:00", 600},
		{"identical windows", "10:00:00", "10:30:00", "10:00:00", "10:30:00", 1800},
	}
	const day = "2026-01-01T"
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			aStart := mustTime(t, day+tt.aStart+"Z")
			aEnd := mustTime(t, day+tt.aEnd+"Z")
			bStart := mustTime(t, day+tt.bStart+"Z")
			bEnd := mustTime(t, day+tt.bEnd+"Z")
			if got := overlapSeconds(aStart, aEnd, bStart, bEnd); got != tt.want {
				t.Errorf("overlapSeconds() = %d, want %d", got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// sortAnomalies / truncateAnomalies
// ---------------------------------------------------------------------------

func TestSortAnomalies_Deterministic(t *testing.T) {
	t.Parallel()
	t1 := mustTime(t, "2026-01-01T10:00:00Z")
	t2 := mustTime(t, "2026-01-02T10:00:00Z")

	in := []Anomaly{
		{StartedAt: t2, VehicleID: 1, Kind: AnomalyKindDrive, SessionID: 5, Rule: RuleOdometerRollback},
		{StartedAt: t1, VehicleID: 2, Kind: AnomalyKindDrive, SessionID: 1, Rule: RuleEndedBeforeStarted},
		{StartedAt: t1, VehicleID: 1, Kind: AnomalyKindCharging, SessionID: 3, Rule: RuleSocInconsistent},
		{StartedAt: t1, VehicleID: 1, Kind: AnomalyKindDrive, SessionID: 2, Rule: RuleDurationMismatch},
	}
	sortAnomalies(in)

	want := []struct {
		vehicleID int64
		sessionID int64
	}{
		{1, 3}, // t1, vehicle 1, kind "charging" (sorts before "drive" lexicographically)
		{1, 2}, // t1, vehicle 1, kind "drive"
		{2, 1}, // t1, vehicle 2
		{1, 5}, // t2
	}
	if len(in) != len(want) {
		t.Fatalf("len(in) = %d, want %d", len(in), len(want))
	}
	for i, w := range want {
		if in[i].VehicleID != w.vehicleID || in[i].SessionID != w.sessionID {
			t.Errorf("position %d = vehicle %d session %d, want vehicle %d session %d",
				i, in[i].VehicleID, in[i].SessionID, w.vehicleID, w.sessionID)
		}
	}

	// Re-running on an already-sorted slice must be a no-op (idempotent /
	// stable), proving the ordering is fully deterministic.
	again := make([]Anomaly, len(in))
	copy(again, in)
	sortAnomalies(again)
	for i := range again {
		if again[i].SessionID != in[i].SessionID || again[i].VehicleID != in[i].VehicleID {
			t.Errorf("sortAnomalies is not idempotent at position %d", i)
		}
	}
}

func TestTruncateAnomalies(t *testing.T) {
	t.Parallel()

	in := []Anomaly{{SessionID: 1}, {SessionID: 2}, {SessionID: 3}}

	out, truncated := truncateAnomalies(in, 10)
	if truncated || len(out) != 3 {
		t.Errorf("under-limit: got len=%d truncated=%v, want len=3 truncated=false", len(out), truncated)
	}

	out, truncated = truncateAnomalies(in, 2)
	if !truncated || len(out) != 2 {
		t.Errorf("over-limit: got len=%d truncated=%v, want len=2 truncated=true", len(out), truncated)
	}

	out, truncated = truncateAnomalies(in, 3)
	if truncated || len(out) != 3 {
		t.Errorf("exact-limit: got len=%d truncated=%v, want len=3 truncated=false", len(out), truncated)
	}
}

// ---------------------------------------------------------------------------
// test helpers
// ---------------------------------------------------------------------------

func findRule(t *testing.T, anomalies []Anomaly, rule string) Anomaly {
	t.Helper()
	for _, a := range anomalies {
		if a.Rule == rule {
			return a
		}
	}
	t.Fatalf("expected rule %q among %+v", rule, anomalies)
	return Anomaly{}
}

func anyRule(anomalies []Anomaly, rule string) bool {
	for _, a := range anomalies {
		if a.Rule == rule {
			return true
		}
	}
	return false
}
