package polling

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestDriveEvaluator_Driving(t *testing.T) {
	speed := 65
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			DriveState: tesla.DriveState{Speed: &speed, Power: 30},
		},
	}
	result := (&DriveEvaluator{}).Evaluate(ctx)
	if result.Activity != Active {
		t.Errorf("expected Active, got %s", result.Activity)
	}
}

func TestDriveEvaluator_Stationary(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			DriveState: tesla.DriveState{Power: 0},
		},
	}
	result := (&DriveEvaluator{}).Evaluate(ctx)
	if result.Activity != Idle {
		t.Errorf("expected Idle, got %s", result.Activity)
	}
}

func TestDriveEvaluator_RecentlyDriving(t *testing.T) {
	prevSpeed := 50
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			DriveState: tesla.DriveState{Power: 0},
		},
		Previous: &tesla.VehicleDataResponse{
			DriveState: tesla.DriveState{Speed: &prevSpeed},
		},
	}
	result := (&DriveEvaluator{}).Evaluate(ctx)
	if result.Activity != Moderate {
		t.Errorf("expected Moderate (recently driving), got %s", result.Activity)
	}
}

func TestChargeEvaluator_Charging(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			ChargeState: tesla.ChargeState{ChargingState: "Charging", ChargeRate: 32},
		},
	}
	result := (&ChargeEvaluator{}).Evaluate(ctx)
	if result.Activity != Active {
		t.Errorf("expected Active, got %s", result.Activity)
	}
}

func TestChargeEvaluator_CompletePluggedIn(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			ChargeState: tesla.ChargeState{
				ChargingState:      "Complete",
				ChargePortLatch:    "Engaged",
				ChargePortDoorOpen: true,
			},
		},
	}
	result := (&ChargeEvaluator{}).Evaluate(ctx)
	if result.Activity != Low {
		t.Errorf("expected Low (complete + plugged), got %s", result.Activity)
	}
}

func TestChargeEvaluator_Disconnected(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			ChargeState: tesla.ChargeState{ChargingState: "Disconnected"},
		},
	}
	result := (&ChargeEvaluator{}).Evaluate(ctx)
	if result.Activity != Idle {
		t.Errorf("expected Idle (disconnected), got %s", result.Activity)
	}
}

func TestClimateEvaluator_Preconditioning(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			ClimateState: tesla.ClimateState{IsPreconditioning: true},
		},
	}
	result := (&ClimateEvaluator{}).Evaluate(ctx)
	if result.Activity != Moderate {
		t.Errorf("expected Moderate (preconditioning), got %s", result.Activity)
	}
}

func TestClimateEvaluator_Off(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			ClimateState: tesla.ClimateState{},
		},
	}
	result := (&ClimateEvaluator{}).Evaluate(ctx)
	if result.Activity != Idle {
		t.Errorf("expected Idle, got %s", result.Activity)
	}
}

func TestBatteryEvaluator_LevelChanged(t *testing.T) {
	ctx := &EvalContext{
		Current:  &tesla.VehicleDataResponse{ChargeState: tesla.ChargeState{BatteryLevel: 80}},
		Previous: &tesla.VehicleDataResponse{ChargeState: tesla.ChargeState{BatteryLevel: 75}},
	}
	result := (&BatteryEvaluator{}).Evaluate(ctx)
	if result.Activity != Active {
		t.Errorf("expected Active (battery changed 5%%), got %s", result.Activity)
	}
}

func TestBatteryEvaluator_Unchanged(t *testing.T) {
	ctx := &EvalContext{
		Current:  &tesla.VehicleDataResponse{ChargeState: tesla.ChargeState{BatteryLevel: 80}},
		Previous: &tesla.VehicleDataResponse{ChargeState: tesla.ChargeState{BatteryLevel: 80}},
	}
	result := (&BatteryEvaluator{}).Evaluate(ctx)
	if result.Activity != Idle {
		t.Errorf("expected Idle (unchanged), got %s", result.Activity)
	}
}

func TestSentryEvaluator_Active(t *testing.T) {
	ctx := &EvalContext{
		Current: &tesla.VehicleDataResponse{
			VehicleState: tesla.VehicleState{SentryMode: true},
		},
	}
	result := (&SentryEvaluator{}).Evaluate(ctx)
	if result.Activity != Low {
		t.Errorf("expected Low (sentry on), got %s", result.Activity)
	}
}

func TestEngine_FirstPoll(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	shouldPoll, _ := engine.ShouldPoll("VIN123")
	if !shouldPoll {
		t.Error("first poll should always be allowed")
	}
}

func TestEngine_MarkBudgetExhaustedPausesPollEnginePath(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	resetAt := time.Now().Add(time.Hour)

	engine.MarkBudgetExhausted("VIN123", resetAt)

	shouldPoll, decision := engine.ShouldPoll("VIN123")
	if shouldPoll {
		t.Fatal("poll should remain paused until the budget reset")
	}
	if len(decision.Reasons) != 1 || decision.Reasons[0] != "Fleet API daily budget exhausted" {
		t.Fatalf("reasons = %v, want budget exhaustion", decision.Reasons)
	}
	state, ok := engine.GetVehicleState("VIN123")
	if !ok || !state.BudgetPausedUntil.Equal(resetAt) {
		t.Fatalf("budget pause state = %+v, want reset at %v", state, resetAt)
	}
	if got := engine.CostTracker().Snapshot().SavingsBreakdown["budget"]; got != 1 {
		t.Fatalf("budget skips = %d, want 1 actual skipped poll", got)
	}

	engine.ResetVehicle("VIN123")
	shouldPoll, _ = engine.ShouldPoll("VIN123")
	if !shouldPoll {
		t.Fatal("reset vehicle should clear the budget pause")
	}
}

func TestEngine_MarkBudgetUnavailableUsesRetryBackoffWithoutClaimingExhaustion(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	retryAt := time.Now().Add(time.Minute)

	engine.MarkBudgetUnavailable("VIN123", retryAt)

	shouldPoll, decision := engine.ShouldPoll("VIN123")
	if shouldPoll {
		t.Fatal("poll should back off while budget evidence is unavailable")
	}
	if len(decision.Reasons) != 1 || decision.Reasons[0] != "Fleet API budget evidence unavailable" {
		t.Fatalf("reasons = %v, want unavailable budget evidence", decision.Reasons)
	}
	state, ok := engine.GetVehicleState("VIN123")
	if !ok || state.LastDecision == nil ||
		len(state.LastDecision.Reasons) != 1 ||
		state.LastDecision.Reasons[0] != "Fleet API budget evidence unavailable" {
		t.Fatalf("state = %+v, want unavailable evidence without exhausted state", state)
	}
	if !state.BudgetPausedUntil.IsZero() {
		t.Fatalf("budget pause = %v, want zero because exhaustion is unproven", state.BudgetPausedUntil)
	}
	if got := engine.CostTracker().Snapshot().PollsSaved; got != 0 {
		t.Fatalf("polls saved = %d, want 0 because an evidence outage is not a saving", got)
	}
	if got := engine.CostTracker().Snapshot().EstimatedSavings; got != 0 {
		t.Fatalf("estimated savings = %v, want 0 because an evidence outage is not a saving", got)
	}
}

func TestEngine_ReconcileFleetPrunesRetiredBudgetPauses(t *testing.T) {
	metrics.PollingBudgetPausedVehicles.Set(0)
	t.Cleanup(func() {
		metrics.PollingBudgetPausedVehicles.Set(0)
	})

	engine := NewPollEngine(DefaultEngineConfig())
	engine.MarkBudgetExhausted("VIN-RETIRED", time.Now().Add(time.Hour))
	engine.ReconcileFleet([]string{"VIN-RETIRED"})
	if got := testutil.ToFloat64(metrics.PollingBudgetPausedVehicles); got != 1 {
		t.Fatalf("paused vehicles = %v, want 1", got)
	}

	engine.ReconcileFleet([]string{"VIN-ACTIVE"})
	if _, ok := engine.GetVehicleState("VIN-RETIRED"); !ok {
		t.Fatal("one missing fleet cycle pruned an active budget pause")
	}
	if got := testutil.ToFloat64(metrics.PollingBudgetPausedVehicles); got != 1 {
		t.Fatalf("paused vehicles after one absence = %v, want 1", got)
	}

	engine.ReconcileFleet([]string{"VIN-ACTIVE"})
	if _, ok := engine.GetVehicleState("VIN-RETIRED"); ok {
		t.Fatal("retired vehicle state was not pruned after consecutive absences")
	}
	if got := testutil.ToFloat64(metrics.PollingBudgetPausedVehicles); got != 0 {
		t.Fatalf("paused vehicles after reconciliation = %v, want 0", got)
	}
}

func TestEngine_ApplyBudgetPacingDistributesRemainingCallsAcrossFleet(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	engine.SetFleetSize(2)
	speed := 65
	engine.Assess("VIN123", &tesla.VehicleDataResponse{
		State:      "online",
		DriveState: tesla.DriveState{Speed: &speed, Power: 30},
	})

	interval := engine.ApplyBudgetPacing("VIN123", tesla.BudgetSnapshot{
		ResetAt:                time.Now().Add(24 * time.Hour),
		DailyLimitMicroUSD:     300_000,
		CommandReserveMicroUSD: 50_000,
		BackgroundCostMicroUSD: 2_000,
	})
	if interval < 23*time.Minute || interval > 24*time.Minute {
		t.Fatalf("paced interval = %v, want about 23 minutes for 62 remaining calls", interval)
	}

	state, ok := engine.GetVehicleState("VIN123")
	if !ok || state.LastDecision == nil {
		t.Fatalf("state = %+v, want a recorded pacing decision", state)
	}
	if state.LastDecision.NextInterval != interval {
		t.Fatalf("decision interval = %v, want %v", state.LastDecision.NextInterval, interval)
	}
	foundReason := false
	for _, reason := range state.LastDecision.Reasons {
		if reason == "Fleet API budget pacing preserves coverage through the UTC day" {
			foundReason = true
		}
	}
	if !foundReason {
		t.Fatalf("decision reasons = %v, want budget pacing evidence", state.LastDecision.Reasons)
	}
}

func TestEngine_ApplyBudgetPacingHonorsTotalSpendAfterReserveOverspend(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	engine.SetFleetSize(2)
	speed := 65
	engine.Assess("VIN123", &tesla.VehicleDataResponse{
		State:      "online",
		DriveState: tesla.DriveState{Speed: &speed, Power: 30},
	})

	interval := engine.ApplyBudgetPacing("VIN123", tesla.BudgetSnapshot{
		ResetAt:                time.Now().Add(24 * time.Hour),
		DailyLimitMicroUSD:     300_000,
		CommandReserveMicroUSD: 50_000,
		EstimatedCostMicroUSD:  290_000,
		BackgroundCostMicroUSD: 100_000,
	})
	if interval < 11*time.Hour+59*time.Minute || interval > 12*time.Hour+time.Minute {
		t.Fatalf("paced interval = %v, want about 12 hours for two calls per vehicle", interval)
	}
}

func TestEngine_StateSnapshotsDoNotAliasPublishedDecisions(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	speed := 65
	engine.Assess("VIN123", &tesla.VehicleDataResponse{
		State:      "online",
		DriveState: tesla.DriveState{Speed: &speed, Power: 30},
	})

	beforePacing, ok := engine.GetVehicleState("VIN123")
	if !ok || beforePacing.LastDecision == nil || len(beforePacing.LastDecision.Reasons) == 0 {
		t.Fatalf("state = %+v, want an initial decision", beforePacing)
	}
	originalInterval := beforePacing.LastDecision.NextInterval
	originalReason := beforePacing.LastDecision.Reasons[0]

	engine.ApplyBudgetPacing("VIN123", tesla.BudgetSnapshot{
		ResetAt:                time.Now().Add(24 * time.Hour),
		DailyLimitMicroUSD:     300_000,
		CommandReserveMicroUSD: 50_000,
		EstimatedCostMicroUSD:  2_000,
		BackgroundCostMicroUSD: 2_000,
	})
	if beforePacing.LastDecision.NextInterval != originalInterval ||
		beforePacing.LastDecision.Reasons[0] != originalReason {
		t.Fatal("previously published state changed after budget pacing")
	}

	current, ok := engine.GetVehicleState("VIN123")
	if !ok || current.LastDecision == nil {
		t.Fatalf("state = %+v, want a current decision", current)
	}
	current.LastDecision.Reasons[0] = "mutated by caller"
	current.DecisionHistory[0].Reasons[0] = "mutated history"

	unchanged, _ := engine.GetVehicleState("VIN123")
	if unchanged.LastDecision.Reasons[0] == "mutated by caller" {
		t.Fatal("LastDecision reasons alias caller-owned snapshot")
	}
	if unchanged.DecisionHistory[0].Reasons[0] == "mutated history" {
		t.Fatal("DecisionHistory reasons alias caller-owned snapshot")
	}
}

func TestEngine_Assess_Driving(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	speed := 65
	data := &tesla.VehicleDataResponse{
		State:       "online",
		DriveState:  tesla.DriveState{Speed: &speed, Power: 30},
		ChargeState: tesla.ChargeState{ChargingState: "Disconnected"},
	}

	decision := engine.Assess("VIN123", data)

	if decision.Activity != Active {
		t.Errorf("expected Active, got %s", decision.Activity)
	}
	if decision.Profile != ProfileDriving {
		t.Errorf("expected driving profile, got %s", decision.Profile)
	}
	if decision.NextInterval != 15*time.Second {
		t.Errorf("expected 15s interval for driving, got %v", decision.NextInterval)
	}
}

func TestEngine_Assess_Charging(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	data := &tesla.VehicleDataResponse{
		State:       "online",
		ChargeState: tesla.ChargeState{ChargingState: "Charging", ChargeRate: 32},
	}

	decision := engine.Assess("VIN123", data)

	if decision.Activity != Active {
		t.Errorf("expected Active, got %s", decision.Activity)
	}
	if decision.Profile != ProfileCharging {
		t.Errorf("expected charging profile, got %s", decision.Profile)
	}
	if decision.NextInterval != 60*time.Second {
		t.Errorf("expected 60s interval for charging, got %v", decision.NextInterval)
	}
}

func TestEngine_Assess_Idle_ProgressiveBackoff(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	data := &tesla.VehicleDataResponse{
		State:        "online",
		ChargeState:  tesla.ChargeState{ChargingState: "Disconnected", BatteryLevel: 80},
		ClimateState: tesla.ClimateState{},
		VehicleState: tesla.VehicleState{},
	}

	// First assessment — battery evaluator returns Low (no baseline yet),
	// so this won't be pure idle. Just establish baseline.
	engine.Assess("VIN123", data)
	engine.mu.Lock()
	engine.vehicles["VIN123"].NextPollAfter = time.Time{}
	engine.mu.Unlock()

	// Second: now all evaluators return Idle (battery unchanged). consecIdle=1 → base interval
	d2 := engine.Assess("VIN123", data)
	if d2.NextInterval != 5*time.Minute {
		t.Errorf("1st idle: expected 5m (base), got %v", d2.NextInterval)
	}

	engine.mu.Lock()
	engine.vehicles["VIN123"].NextPollAfter = time.Time{}
	engine.mu.Unlock()

	// Third: consecIdle=2 → 2× base = 10m
	d3 := engine.Assess("VIN123", data)
	if d3.NextInterval != 10*time.Minute {
		t.Errorf("2nd idle: expected 10m (2× backoff), got %v", d3.NextInterval)
	}

	engine.mu.Lock()
	engine.vehicles["VIN123"].NextPollAfter = time.Time{}
	engine.mu.Unlock()

	// Fourth: consecIdle=3 → 4× base = 20m
	d4 := engine.Assess("VIN123", data)
	if d4.NextInterval != 20*time.Minute {
		t.Errorf("3rd idle: expected 20m (4× backoff), got %v", d4.NextInterval)
	}

	engine.mu.Lock()
	engine.vehicles["VIN123"].NextPollAfter = time.Time{}
	engine.mu.Unlock()

	// Fifth: consecIdle=4 → 8× base = 40m → capped at 30m
	d5 := engine.Assess("VIN123", data)
	if d5.NextInterval != 30*time.Minute {
		t.Errorf("4th idle: expected 30m (capped), got %v", d5.NextInterval)
	}
}

func TestEngine_Assess_IdleToActive_Reset(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	idleData := &tesla.VehicleDataResponse{
		State:        "online",
		ChargeState:  tesla.ChargeState{ChargingState: "Disconnected", BatteryLevel: 80},
		ClimateState: tesla.ClimateState{},
	}

	// Seed idle backoff so the active transition can prove it resets.
	engine.Assess("VIN123", idleData)
	engine.mu.Lock()
	engine.vehicles["VIN123"].NextPollAfter = time.Time{}
	engine.mu.Unlock()
	engine.Assess("VIN123", idleData)

	// Now the car starts driving
	speed := 65
	driveData := &tesla.VehicleDataResponse{
		State:       "online",
		DriveState:  tesla.DriveState{Speed: &speed},
		ChargeState: tesla.ChargeState{ChargingState: "Disconnected", BatteryLevel: 79},
	}

	engine.mu.Lock()
	engine.vehicles["VIN123"].NextPollAfter = time.Time{}
	engine.mu.Unlock()

	decision := engine.Assess("VIN123", driveData)

	// Backoff should be completely reset
	if decision.Activity != Active {
		t.Errorf("expected Active after driving, got %s", decision.Activity)
	}
	if decision.NextInterval != 15*time.Second {
		t.Errorf("expected 15s after reset, got %v", decision.NextInterval)
	}

	engine.mu.RLock()
	vs := engine.vehicles["VIN123"]
	engine.mu.RUnlock()
	if vs.ConsecIdle != 0 {
		t.Errorf("consecIdle should be 0 after activity, got %d", vs.ConsecIdle)
	}
}

func TestEngine_ShouldPoll_RespectsBackoff(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())

	// Set up a vehicle with a future backoff
	engine.mu.Lock()
	engine.vehicles["VIN123"] = &VehiclePollingState{
		VIN:             "VIN123",
		NextPollAfter:   time.Now().Add(5 * time.Minute),
		CurrentActivity: Idle,
		CurrentProfile:  ProfileIdle,
	}
	engine.mu.Unlock()

	shouldPoll, decision := engine.ShouldPoll("VIN123")
	if shouldPoll {
		t.Error("should not poll during backoff")
	}
	if decision.ShouldPoll {
		t.Error("decision.ShouldPoll should be false during backoff")
	}
}

func TestEngine_MarkSleeping(t *testing.T) {
	engine := NewPollEngine(DefaultEngineConfig())
	engine.MarkSleeping("VIN123")

	vs, ok := engine.GetVehicleState("VIN123")
	if !ok {
		t.Fatal("vehicle should exist after MarkSleeping")
	}
	if vs.CurrentActivity != Sleeping {
		t.Errorf("expected Sleeping, got %s", vs.CurrentActivity)
	}
	if vs.CurrentProfile != ProfileSleeping {
		t.Errorf("expected sleeping profile, got %s", vs.CurrentProfile)
	}
}

func TestEngine_FleetTelemetry_MoreAggressiveBackoff(t *testing.T) {
	cfg := DefaultEngineConfig()
	cfg.FleetTelemetryEnabled = true
	engine := NewPollEngine(cfg)

	data := &tesla.VehicleDataResponse{
		State:        "online",
		ChargeState:  tesla.ChargeState{ChargingState: "Disconnected", BatteryLevel: 80},
		ClimateState: tesla.ClimateState{},
	}

	d1 := engine.Assess("VIN123", data)
	// Fleet Telemetry doubles the idle base interval to 10 minutes.
	if d1.NextInterval != 10*time.Minute {
		t.Errorf("FT idle: expected 10m (2× base), got %v", d1.NextInterval)
	}
}

func TestCostTracker_RecordAndSnapshot(t *testing.T) {
	ct := NewCostTracker(0.00222, 10.0)

	ct.RecordPoll()
	ct.RecordPoll()
	ct.RecordSkip("idle")
	ct.RecordSkip("fleet_telemetry")
	ct.RecordBaselineTick()
	ct.RecordBaselineTick()
	ct.RecordBaselineTick()
	ct.RecordBaselineTick()

	snap := ct.Snapshot()
	if snap.PollsMade != 2 {
		t.Errorf("expected 2 polls made, got %d", snap.PollsMade)
	}
	if snap.PollsSaved != 2 {
		t.Errorf("expected 2 polls saved, got %d", snap.PollsSaved)
	}
	if snap.SavingsBreakdown["idle_detection"] != 1 {
		t.Errorf("expected 1 idle skip, got %d", snap.SavingsBreakdown["idle_detection"])
	}
	if snap.SavingsBreakdown["fleet_telemetry"] != 1 {
		t.Errorf("expected 1 FT skip, got %d", snap.SavingsBreakdown["fleet_telemetry"])
	}
	if snap.SavingsPercent != 50.0 {
		t.Errorf("expected 50%% savings, got %.1f%%", snap.SavingsPercent)
	}
}

func TestActivityLevel_String(t *testing.T) {
	tests := map[ActivityLevel]string{
		Sleeping: "sleeping",
		Idle:     "idle",
		Low:      "low",
		Moderate: "moderate",
		Active:   "active",
		Critical: "critical",
	}
	for level, expected := range tests {
		if level.String() != expected {
			t.Errorf("ActivityLevel(%d).String() = %q, want %q", level, level.String(), expected)
		}
	}
}
