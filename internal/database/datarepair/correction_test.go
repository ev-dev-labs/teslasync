package datarepair

import (
	"math"
	"testing"
	"time"
)

func TestPlanCorrectionRecalculatesDurationOnlyFromValidBoundaries(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	end := start.Add(20*time.Minute + 600*time.Millisecond)
	stored := int64(900)
	source := CorrectionSource{
		Kind:      AnomalyKindDrive,
		ID:        17,
		VehicleID: 2,
		StartedAt: start,
		EndedAt:   &end,
		DurationS: &stored,
	}

	plan, err := PlanCorrection(source, RuleDurationMismatch, CorrectionChoice{
		Field: "duration_s",
		Mode:  CorrectionDerive,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := plan.Fields["duration_s"]; got != int64(1201) {
		t.Fatalf("duration = %v, want 1201 seconds", got)
	}
	if len(plan.Fields) != 1 || len(plan.Changes) != 1 ||
		*plan.Changes[0].Before != 900 || *plan.Changes[0].After != 1201 {
		t.Fatalf("unexpected duration impact: %+v", plan)
	}

	invalidEnd := start.Add(-time.Minute)
	source.EndedAt = &invalidEnd
	if _, err := PlanCorrection(source, RuleDurationMismatch, CorrectionChoice{
		Field: "duration_s", Mode: CorrectionDerive,
	}); err == nil {
		t.Fatal("cannot derive a duration from an invalid session window")
	}

	source.EndedAt = &end
	stored = 1201
	if _, err := PlanCorrection(source, RuleDurationMismatch, CorrectionChoice{
		Field: "duration_s", Mode: CorrectionDerive,
	}); err == nil {
		t.Fatal("a stale finding must not be applied after its anomaly is gone")
	}
}

func TestPlanCorrectionRequiresAValidReviewedMeasurement(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	negative := -100.0
	source := CorrectionSource{
		Kind: AnomalyKindDrive, ID: 17, VehicleID: 2,
		StartedAt: start, EndedAt: &end, DistanceM: &negative,
	}

	plan, err := PlanCorrection(source, RuleNegativeDistanceM, CorrectionChoice{
		Field: "distance_m", Mode: CorrectionReplace, Value: floatPtr(1200),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := plan.Fields["distance_m"]; got != float64(1200) {
		t.Fatalf("distance = %v, want 1200", got)
	}
	if len(plan.Fields) != 1 || *plan.Changes[0].Before != negative {
		t.Fatalf("unexpected correction impact: %+v", plan)
	}

	for _, tt := range []struct {
		name   string
		choice CorrectionChoice
	}{
		{"wrong field", CorrectionChoice{Field: "energy_used_wh", Mode: CorrectionReplace, Value: floatPtr(1)}},
		{"negative", CorrectionChoice{Field: "distance_m", Mode: CorrectionReplace, Value: floatPtr(-1)}},
		{"not finite", CorrectionChoice{Field: "distance_m", Mode: CorrectionReplace, Value: floatPtr(math.Inf(1))}},
		{"missing replacement", CorrectionChoice{Field: "distance_m", Mode: CorrectionReplace}},
		{"value with clear", CorrectionChoice{Field: "distance_m", Mode: CorrectionClear, Value: floatPtr(0)}},
		{"unknown distance would read as zero", CorrectionChoice{Field: "distance_m", Mode: CorrectionClear}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := PlanCorrection(source, RuleNegativeDistanceM, tt.choice); err == nil {
				t.Fatal("invalid correction must be rejected")
			}
		})
	}

	source.RegenEnergyWh = &negative
	plan, err = PlanCorrection(source, RuleNegativeRegenEnergyWh, CorrectionChoice{
		Field: "regen_energy_wh", Mode: CorrectionClear,
	})
	if err != nil || len(plan.Fields) != 1 || plan.Fields["regen_energy_wh"] != nil {
		t.Fatalf("nullable regenerated energy can be marked unknown: plan=%+v err=%v", plan, err)
	}
}

func TestPlanCorrectionRejectsClearingValuesThatSomeViewsTreatAsKnown(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	negative, driveStartSoc, driveEndSoc := -100.0, 30.0, 50.0
	chargeStartSoc, chargeEndSoc := 80.0, 60.0
	drive := CorrectionSource{
		Kind: AnomalyKindDrive, StartedAt: start, EndedAt: &end,
		EnergyUsedWh: &negative, StartSocPct: &driveStartSoc, EndSocPct: &driveEndSoc,
	}
	charge := CorrectionSource{
		Kind: AnomalyKindCharging, StartedAt: start, EndedAt: &end,
		TotalEnergyAddedWh: &negative, StartSocPct: &chargeStartSoc, EndSocPct: &chargeEndSoc,
	}
	for _, tt := range []struct {
		name   string
		source CorrectionSource
		rule   string
		field  string
	}{
		{"drive energy", drive, RuleNegativeEnergyUsedWh, "energy_used_wh"},
		{"charging energy", charge, RuleNegativeEnergyAddedWh, "total_energy_added_wh"},
		{"drive starting battery", drive, RuleSocInconsistent, "start_soc_pct"},
		{"drive ending battery", drive, RuleSocInconsistent, "end_soc_pct"},
		{"charging starting battery", charge, RuleSocInconsistent, "start_soc_pct"},
		{"charging ending battery", charge, RuleSocInconsistent, "end_soc_pct"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := PlanCorrection(tt.source, tt.rule, CorrectionChoice{Field: tt.field, Mode: CorrectionClear})
			if err == nil {
				t.Fatal("clearing this measurement would make existing views display an invented value")
			}
		})
	}
}

func TestPlanCorrectionChecksBothReadingsAndKeepsChargingDeltaConsistent(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	startSoc, endSoc, oldDelta := 80.0, 60.0, -20.0
	source := CorrectionSource{
		Kind: AnomalyKindCharging, ID: 17, VehicleID: 2,
		StartedAt: start, EndedAt: &end,
		StartSocPct: &startSoc, EndSocPct: &endSoc, DeltaSocPct: &oldDelta,
	}

	plan, err := PlanCorrection(source, RuleSocInconsistent, CorrectionChoice{
		Field: "end_soc_pct", Mode: CorrectionReplace, Value: floatPtr(90),
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Fields["end_soc_pct"] != float64(90) || plan.Fields["delta_soc_pct"] != float64(10) {
		t.Fatalf("charging values not reconciled: %+v", plan.Fields)
	}

	for _, value := range []float64{70, 101} {
		if _, err := PlanCorrection(source, RuleSocInconsistent, CorrectionChoice{
			Field: "end_soc_pct", Mode: CorrectionReplace, Value: &value,
		}); err == nil {
			t.Fatalf("invalid or still-inconsistent end SOC %v must be rejected", value)
		}
	}

	startOdometer, endOdometer := 10000.0, 9000.0
	source.StartOdometerM, source.EndOdometerM = &startOdometer, &endOdometer
	if _, err := PlanCorrection(source, RuleOdometerRollback, CorrectionChoice{
		Field: "end_odometer_m", Mode: CorrectionReplace, Value: floatPtr(9500),
	}); err == nil {
		t.Fatal("a replacement that still rolls back the odometer must be rejected")
	}
}

func TestPlanCorrectionInvalidatesOnlyEnergyDerivedCosts(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	negative, corrected := -100.0, 1200.0
	cost, currency := "4.1250", "USD"
	for _, tt := range []struct {
		source     string
		invalidate bool
	}{
		{"default_estimate", true},
		{"geofence_tariff", true},
		{"manual", false},
		{"tesla_actual", false},
		{"unknown", false},
	} {
		t.Run(tt.source, func(t *testing.T) {
			source := CorrectionSource{
				Kind: AnomalyKindCharging, ID: 17, VehicleID: 2,
				StartedAt: start, EndedAt: &end, TotalEnergyAddedWh: &negative,
				CostDecimal: &cost, CostCurrency: &currency, CostSource: &tt.source,
			}
			plan, err := PlanCorrection(source, RuleNegativeEnergyAddedWh, CorrectionChoice{
				Field: "total_energy_added_wh", Mode: CorrectionReplace, Value: &corrected,
			})
			if err != nil {
				t.Fatal(err)
			}
			costValue, changed := plan.Fields["cost_decimal"]
			if changed != tt.invalidate {
				t.Fatalf("cost changed = %t, want %t", changed, tt.invalidate)
			}
			if tt.invalidate {
				if costValue != nil || plan.Fields["cost_source"] != "unknown" {
					t.Fatalf("stale estimate must become unknown: %+v", plan.Fields)
				}
				if len(plan.Changes) != 3 || *plan.Changes[1].BeforeText != cost ||
					*plan.Changes[1].Unit != currency || *plan.Changes[2].AfterText != "unknown" {
					t.Fatalf("cost changes must be visible in the preview: %+v", plan.Changes)
				}
			} else if len(plan.Changes) != 1 {
				t.Fatalf("independent actual/unknown cost must be preserved: %+v", plan.Changes)
			}
		})
	}
}

func TestPlanBoundaryCorrectionRequiresReviewedEndAndResolvesTheFinding(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	invalidEnd := start.Add(-time.Minute)
	duration := int64(-60)
	primary := CorrectionSource{
		Kind: AnomalyKindDrive, ID: 17, VehicleID: 2,
		StartedAt: start, EndedAt: &invalidEnd, DurationS: &duration,
	}
	end := start.Add(30 * time.Minute)
	plan, err := PlanBoundaryCorrection(primary, nil, RuleEndedBeforeStarted, "primary", end, start.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if plan.Boundary == nil || plan.Boundary.ID != 17 || plan.Boundary.DurationS != 1800 ||
		len(plan.Changes) != 2 || *plan.Changes[1].After != 1800 {
		t.Fatalf("unexpected boundary plan: %+v", plan)
	}
	for _, invalid := range []time.Time{start, start.Add(2 * time.Hour)} {
		if _, err := PlanBoundaryCorrection(primary, nil, RuleEndedBeforeStarted, "primary", invalid, start.Add(time.Hour)); err == nil {
			t.Fatalf("invalid boundary %s accepted", invalid)
		}
	}

	originalEnd := start.Add(time.Hour)
	primary.EndedAt = &originalEnd
	relatedStart := start.Add(30 * time.Minute)
	relatedEnd := start.Add(90 * time.Minute)
	related := CorrectionSource{
		Kind: AnomalyKindCharging, ID: 18, VehicleID: 2,
		StartedAt: relatedStart, EndedAt: &relatedEnd,
	}
	plan, err = PlanBoundaryCorrection(primary, &related, RuleCrossKindOverlap, "primary", relatedStart, relatedEnd)
	if err != nil || plan.Boundary.ID != primary.ID || plan.Other.ID != related.ID {
		t.Fatalf("overlap correction = %+v, error %v", plan, err)
	}
	for _, tt := range []struct {
		name   string
		target string
		end    time.Time
	}{
		{"later session cannot fix its start", "related", relatedStart.Add(10 * time.Minute)},
		{"still overlaps", "primary", relatedStart.Add(time.Second)},
		{"invalid selection", "other", relatedStart},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := PlanBoundaryCorrection(primary, &related, RuleCrossKindOverlap, tt.target, tt.end, relatedEnd); err == nil {
				t.Fatal("unsafe overlap correction accepted")
			}
		})
	}
	primary.StartedAt = relatedStart
	if _, err := PlanBoundaryCorrection(primary, &related, RuleCrossKindOverlap, "primary", relatedStart.Add(time.Minute), relatedEnd); err == nil {
		t.Fatal("equal starts cannot be fixed by moving only an end")
	}
}

func floatPtr(value float64) *float64 { return &value }
