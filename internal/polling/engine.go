package polling

import (
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// PollEngine is the central adaptive polling coordinator. It runs a pipeline
// of SignalEvaluators against each vehicle's API response, determines the
// optimal polling interval, and tracks cost savings.
//
// Adding a new signal is as simple as implementing SignalEvaluator and
// calling engine.AddEvaluator().
type PollEngine struct {
	mu                sync.RWMutex
	evaluators        []SignalEvaluator
	predictor         *Predictor
	costTracker       *CostTracker
	vehicles          map[string]*VehiclePollingState // keyed by VIN
	absentFleetCycles map[string]uint8
	fleetSize         int
	config            EngineConfig
}

const (
	budgetExhaustedReason        = "Fleet API daily budget exhausted"
	budgetUnavailableReason      = "Fleet API budget evidence unavailable"
	fleetPruneAfterMissingCycles = 2
)

// NewPollEngine creates an engine with the default evaluator pipeline.
func NewPollEngine(cfg EngineConfig) *PollEngine {
	if cfg.DecisionHistorySize <= 0 {
		cfg.DecisionHistorySize = 100
	}
	if cfg.MaxBackoff <= 0 {
		cfg.MaxBackoff = 30 * time.Minute
	}
	if cfg.Intervals.Driving <= 0 {
		cfg.Intervals = DefaultIntervalConfig()
	}
	if cfg.CostPerRequest <= 0 {
		cfg.CostPerRequest = tesla.EstimatedCostUSD(tesla.BudgetCategoryVehicleData)
	}
	if cfg.MonthlyCredit <= 0 {
		cfg.MonthlyCredit = 10.0
	}

	e := &PollEngine{
		vehicles:          make(map[string]*VehiclePollingState),
		absentFleetCycles: make(map[string]uint8),
		fleetSize:         1,
		config:            cfg,
		costTracker:       NewCostTracker(cfg.CostPerRequest, cfg.MonthlyCredit),
	}

	// Register the default evaluator pipeline
	e.evaluators = []SignalEvaluator{
		&DriveEvaluator{},
		&ChargeEvaluator{},
		&ClimateEvaluator{},
		&BatteryEvaluator{},
		&SentryEvaluator{},
	}

	return e
}

// AddEvaluator appends a custom evaluator to the pipeline.
func (e *PollEngine) AddEvaluator(ev SignalEvaluator) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.evaluators = append(e.evaluators, ev)
}

// SetPredictor wires the predictive scheduler into the engine.
func (e *PollEngine) SetPredictor(p *Predictor) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.predictor = p
}

// CostTracker returns the engine's cost tracker for dashboard queries.
func (e *PollEngine) CostTracker() *CostTracker {
	return e.costTracker
}

// SetFleetSize supplies the number of vehicles sharing the process budget so
// pacing reserves a fair share of the remaining UTC-day calls for each one.
func (e *PollEngine) SetFleetSize(size int) {
	if size < 1 {
		size = 1
	}
	e.mu.Lock()
	e.fleetSize = size
	e.mu.Unlock()
}

// ReconcileFleet updates budget pacing and drops state only after consecutive
// absences so a transient empty or partial database read cannot erase a pause.
func (e *PollEngine) ReconcileFleet(vins []string) {
	active := make(map[string]struct{}, len(vins))
	for _, vin := range vins {
		active[vin] = struct{}{}
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	e.fleetSize = len(active)
	if e.fleetSize < 1 {
		e.fleetSize = 1
	}
	for vin := range e.vehicles {
		if _, ok := active[vin]; ok {
			delete(e.absentFleetCycles, vin)
			continue
		}
		e.absentFleetCycles[vin]++
		if e.absentFleetCycles[vin] >= fleetPruneAfterMissingCycles {
			delete(e.vehicles, vin)
			delete(e.absentFleetCycles, vin)
		}
	}
	e.updateBudgetPausedGaugeLocked(time.Now())
}

// ShouldPoll checks whether enough time has elapsed for the next poll of
// the given vehicle. Returns false with a decision explaining why the poll
// was skipped.
func (e *PollEngine) ShouldPoll(vin string) (bool, PollDecision) {
	now := time.Now()
	e.mu.Lock()
	vs, exists := e.vehicles[vin]
	if exists && !vs.BudgetPausedUntil.IsZero() && !now.Before(vs.BudgetPausedUntil) {
		e.clearBudgetPauseLocked(vs)
	}
	if exists && !now.Before(vs.NextPollAfter) {
		vs.BackoffReason = ""
	}
	var state VehiclePollingState
	if exists {
		state = *vs
	}
	e.mu.Unlock()

	if !exists {
		e.costTracker.RecordBaselineTick()
		// First time seeing this vehicle — always poll
		return true, PollDecision{
			ShouldPoll:   true,
			Activity:     Active,
			Profile:      ProfileIdle,
			Reasons:      []string{"first poll for this vehicle"},
			NextInterval: e.config.Intervals.Idle,
		}
	}

	if now.Before(state.NextPollAfter) {
		remaining := state.NextPollAfter.Sub(now)
		reason := "backoff active"
		skipReason := "idle"

		if !state.BudgetPausedUntil.IsZero() && now.Before(state.BudgetPausedUntil) {
			reason = budgetExhaustedReason
			skipReason = "budget"
		} else if state.BackoffReason != "" {
			reason = state.BackoffReason
			skipReason = ""
		} else if state.CurrentProfile == ProfileSleeping {
			reason = "vehicle is sleeping"
			skipReason = "sleep"
		}

		if skipReason != "" {
			e.costTracker.RecordBaselineTick()
			e.costTracker.RecordSkip(skipReason)
		}

		return false, PollDecision{
			ShouldPoll:   false,
			NextInterval: remaining,
			Activity:     state.CurrentActivity,
			Profile:      state.CurrentProfile,
			Reasons:      []string{reason},
		}
	}

	e.costTracker.RecordBaselineTick()
	return true, PollDecision{
		ShouldPoll:   true,
		Activity:     state.CurrentActivity,
		Profile:      state.CurrentProfile,
		NextInterval: 0,
	}
}

// Assess evaluates a vehicle's API response through the evaluator pipeline
// and computes the next polling interval. Call this after every successful poll.
func (e *PollEngine) Assess(vin string, data *tesla.VehicleDataResponse) PollDecision {
	e.mu.Lock()
	vs, exists := e.vehicles[vin]
	if !exists {
		vs = &VehiclePollingState{VIN: vin}
		e.vehicles[vin] = vs
	}
	e.clearBudgetPauseLocked(vs)
	vs.BackoffReason = ""
	previous := vs.LastResponse
	lastPollTime := vs.LastPollTime
	e.mu.Unlock()

	ctx := &EvalContext{
		Current:       data,
		Previous:      previous,
		TimeSinceLast: time.Since(lastPollTime),
		VehicleState:  data.State,
	}

	// Run all evaluators and take the highest activity level
	e.mu.RLock()
	evaluators := make([]SignalEvaluator, len(e.evaluators))
	copy(evaluators, e.evaluators)
	e.mu.RUnlock()

	highestActivity := Sleeping
	var reasons []string

	for _, ev := range evaluators {
		result := ev.Evaluate(ctx)
		if result.Activity > highestActivity {
			highestActivity = result.Activity
		}
		if result.Activity >= Low {
			reasons = append(reasons, ev.Name()+": "+result.Reason)
		}
	}

	// If all evaluators returned Idle, add that as a reason
	if highestActivity <= Idle {
		reasons = append(reasons, "all signals indicate vehicle is idle")
	}

	// Determine profile and interval under the write lock so the ConsecIdle
	// mutation and the interval computation that reads it stay atomic with
	// respect to concurrent GetVehicleState/GetAllVehicleStates readers.
	// Update consecutive idle BEFORE computing interval so backoff is immediate.
	e.mu.Lock()
	if highestActivity <= Idle {
		vs.ConsecIdle++
	} else {
		vs.ConsecIdle = 0
	}
	consecIdle := vs.ConsecIdle
	profile, interval := e.computeInterval(highestActivity, vs, data)
	e.mu.Unlock()

	// Check predictor for upcoming state changes
	var prediction *PredictionInfo
	e.mu.RLock()
	predictor := e.predictor
	e.mu.RUnlock()
	if predictor != nil {
		prediction = predictor.Predict(vin)
		if prediction != nil && prediction.Confidence >= 0.5 && prediction.EstimatedIn < 10*time.Minute {
			// Upcoming state change predicted — increase polling frequency
			if interval > 2*time.Minute {
				interval = 2 * time.Minute
				reasons = append(reasons, "predictor: "+prediction.BasedOn)
			}
		}
	}

	decision := PollDecision{
		ShouldPoll:   true,
		NextInterval: interval,
		Activity:     highestActivity,
		Profile:      profile,
		Reasons:      reasons,
		CostSaved:    0,
		Prediction:   prediction,
	}

	// Update vehicle state
	e.mu.Lock()
	vs.LastResponse = data
	vs.LastPollTime = time.Now()
	vs.NextPollAfter = time.Now().Add(interval)
	vs.CurrentActivity = highestActivity
	vs.CurrentProfile = profile
	vs.LastBatteryLevel = data.ChargeState.BatteryLevel
	vs.LastOdometer = data.VehicleState.Odometer
	storedDecision := clonePollDecision(decision)
	vs.LastDecision = &storedDecision

	// Append to decision history ring buffer
	if len(vs.DecisionHistory) >= e.config.DecisionHistorySize {
		vs.DecisionHistory = vs.DecisionHistory[1:]
	}
	vs.DecisionHistory = append(vs.DecisionHistory, clonePollDecision(decision))
	e.mu.Unlock()

	// Record the poll with cost tracker
	e.costTracker.RecordPoll()

	log.Debug().
		Str("vin", vin).
		Str("activity", highestActivity.String()).
		Str("profile", string(profile)).
		Dur("next_interval", interval).
		Int("consec_idle", consecIdle).
		Strs("reasons", reasons).
		Msg("poll engine assessment")

	return decision
}

// computeInterval determines the poll profile and interval based on activity
// level and consecutive idle count (for progressive backoff).
func (e *PollEngine) computeInterval(activity ActivityLevel, vs *VehiclePollingState, data *tesla.VehicleDataResponse) (PollProfile, time.Duration) {
	switch {
	case activity >= Active:
		// Determine if driving or charging from current response
		if data != nil && data.ChargeState.ChargingState == enums.ChargeStateCharging {
			return ProfileCharging, e.config.Intervals.Charging
		}
		return ProfileDriving, e.config.Intervals.Driving

	case activity == Moderate:
		// Moderate activity — use charging interval as a reasonable middle ground
		return ProfileCharging, e.config.Intervals.Charging

	case activity == Low:
		// Low activity — 2× idle interval
		interval := e.config.Intervals.Idle
		if e.config.FleetTelemetryEnabled {
			interval = 2 * interval
		}
		return ProfileIdle, interval

	case activity <= Idle:
		// Progressive backoff for idle vehicles
		base := e.config.Intervals.Idle
		if e.config.FleetTelemetryEnabled {
			base = 2 * base // more aggressive when FT is primary
		}

		consecIdle := vs.ConsecIdle
		if consecIdle < 1 {
			consecIdle = 1
		}

		// Exponential backoff: base, 2×base, 4×base, ...
		multiplier := 1 << uint(consecIdle-1) // 1, 2, 4, 8, ...
		interval := base * time.Duration(multiplier)

		if interval > e.config.MaxBackoff {
			interval = e.config.MaxBackoff
		}

		return ProfileIdle, interval

	default:
		return ProfileSleeping, 0
	}
}

// MarkSleeping sets a vehicle as sleeping (HTTP 408). The engine will not
// recommend polling this vehicle until ResetVehicle is called.
func (e *PollEngine) MarkSleeping(vin string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	vs, exists := e.vehicles[vin]
	if !exists {
		vs = &VehiclePollingState{VIN: vin}
		e.vehicles[vin] = vs
	}
	e.clearBudgetPauseLocked(vs)
	vs.BackoffReason = ""
	vs.CurrentActivity = Sleeping
	vs.CurrentProfile = ProfileSleeping
	vs.NextPollAfter = time.Now().Add(e.config.MaxBackoff)
	e.costTracker.RecordSkip("sleep")
}

// MarkBudgetExhausted pauses a vehicle until the shared UTC-day budget resets.
func (e *PollEngine) MarkBudgetExhausted(vin string, until time.Time) {
	now := time.Now()
	if !until.After(now) {
		return
	}

	e.mu.Lock()
	vs, exists := e.vehicles[vin]
	if !exists {
		vs = &VehiclePollingState{VIN: vin, CurrentProfile: ProfileIdle}
		e.vehicles[vin] = vs
	}
	if until.After(vs.BudgetPausedUntil) {
		vs.BudgetPausedUntil = until
	}
	if until.After(vs.NextPollAfter) {
		vs.NextPollAfter = until
	}
	vs.BackoffReason = ""
	remaining := time.Until(vs.BudgetPausedUntil)
	decision := PollDecision{
		ShouldPoll:   false,
		NextInterval: remaining,
		Activity:     vs.CurrentActivity,
		Profile:      vs.CurrentProfile,
		Reasons:      []string{budgetExhaustedReason},
	}
	vs.LastDecision = &decision
	if len(vs.DecisionHistory) >= e.config.DecisionHistorySize {
		vs.DecisionHistory = vs.DecisionHistory[1:]
	}
	vs.DecisionHistory = append(vs.DecisionHistory, decision)
	e.updateBudgetPausedGaugeLocked(now)
	e.mu.Unlock()
}

// MarkBudgetUnavailable applies a short retry delay when the shared budget
// store cannot prove allowance. It does not claim the daily cap was consumed.
func (e *PollEngine) MarkBudgetUnavailable(vin string, until time.Time) {
	now := time.Now()
	if !until.After(now) {
		return
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	vs, exists := e.vehicles[vin]
	if !exists {
		vs = &VehiclePollingState{VIN: vin, CurrentProfile: ProfileIdle}
		e.vehicles[vin] = vs
	}
	if until.After(vs.NextPollAfter) {
		vs.NextPollAfter = until
	}
	vs.BackoffReason = budgetUnavailableReason
	decision := PollDecision{
		ShouldPoll:   false,
		NextInterval: time.Until(vs.NextPollAfter),
		Activity:     vs.CurrentActivity,
		Profile:      vs.CurrentProfile,
		Reasons:      []string{budgetUnavailableReason},
	}
	vs.LastDecision = &decision
	if len(vs.DecisionHistory) >= e.config.DecisionHistorySize {
		vs.DecisionHistory = vs.DecisionHistory[1:]
	}
	vs.DecisionHistory = append(vs.DecisionHistory, decision)
}

// ApplyBudgetPacing stretches the next interval when the remaining background
// allowance would otherwise be exhausted before the UTC-day reset.
func (e *PollEngine) ApplyBudgetPacing(vin string, snapshot tesla.BudgetSnapshot) time.Duration {
	now := time.Now()
	if !snapshot.ResetAt.After(now) {
		return 0
	}

	remainingMicroUSD := snapshot.RemainingBackgroundMicroUSD()
	requestCost := tesla.EstimatedCostMicroUSD(tesla.BudgetCategoryVehicleData)
	if requestCost <= 0 {
		return 0
	}
	remainingCalls := remainingMicroUSD / requestCost
	if remainingCalls <= 0 {
		e.MarkBudgetExhausted(vin, snapshot.ResetAt)
		return time.Until(snapshot.ResetAt)
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	callsPerVehicle := remainingCalls / int64(e.fleetSize)
	if callsPerVehicle < 1 {
		callsPerVehicle = 1
	}
	timeRemaining := snapshot.ResetAt.Sub(now)
	minimumInterval := timeRemaining / time.Duration(callsPerVehicle)
	if timeRemaining%time.Duration(callsPerVehicle) != 0 {
		minimumInterval++
	}

	vs, exists := e.vehicles[vin]
	if !exists {
		vs = &VehiclePollingState{VIN: vin, CurrentProfile: ProfileIdle}
		e.vehicles[vin] = vs
	}
	budgetNextPoll := now.Add(minimumInterval)
	if !budgetNextPoll.After(vs.NextPollAfter) {
		return 0
	}

	vs.NextPollAfter = budgetNextPoll
	if vs.LastDecision != nil {
		decision := clonePollDecision(*vs.LastDecision)
		decision.NextInterval = minimumInterval
		decision.Reasons = append(
			decision.Reasons,
			"Fleet API budget pacing preserves coverage through the UTC day",
		)
		vs.LastDecision = &decision
	}
	if last := len(vs.DecisionHistory) - 1; last >= 0 {
		vs.DecisionHistory[last].NextInterval = minimumInterval
		vs.DecisionHistory[last].Reasons = append(
			vs.DecisionHistory[last].Reasons,
			"Fleet API budget pacing preserves coverage through the UTC day",
		)
	}
	return minimumInterval
}

// MarkStreamingSkip records that a vehicle was skipped because fleet telemetry
// is actively streaming for it.
func (e *PollEngine) MarkStreamingSkip(vin string) {
	e.costTracker.RecordSkip("fleet_telemetry")
}

// ResetVehicle clears all backoff state for a vehicle (e.g., when it wakes up).
func (e *PollEngine) ResetVehicle(vin string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if vs, ok := e.vehicles[vin]; ok {
		e.clearBudgetPauseLocked(vs)
		vs.ConsecIdle = 0
		vs.CurrentActivity = Active
		vs.CurrentProfile = ProfileDriving
		vs.NextPollAfter = time.Time{}
		vs.BackoffReason = ""
	}
}

func (e *PollEngine) clearBudgetPauseLocked(vs *VehiclePollingState) {
	if vs.BudgetPausedUntil.IsZero() {
		return
	}
	vs.BudgetPausedUntil = time.Time{}
	e.updateBudgetPausedGaugeLocked(time.Now())
}

func (e *PollEngine) updateBudgetPausedGaugeLocked(now time.Time) {
	paused := 0
	for _, state := range e.vehicles {
		if !state.BudgetPausedUntil.IsZero() && now.Before(state.BudgetPausedUntil) {
			paused++
		}
	}
	metrics.PollingBudgetPausedVehicles.Set(float64(paused))
}

// GetVehicleState returns the current polling state for a vehicle. Thread-safe.
func (e *PollEngine) GetVehicleState(vin string) (*VehiclePollingState, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	vs, ok := e.vehicles[vin]
	if !ok {
		return nil, false
	}
	return cloneVehiclePollingState(vs), true
}

// GetAllVehicleStates returns a snapshot of all tracked vehicles.
func (e *PollEngine) GetAllVehicleStates() map[string]*VehiclePollingState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	result := make(map[string]*VehiclePollingState, len(e.vehicles))
	for vin, vs := range e.vehicles {
		result[vin] = cloneVehiclePollingState(vs)
	}
	return result
}

func cloneVehiclePollingState(state *VehiclePollingState) *VehiclePollingState {
	copyState := *state
	copyState.LastResponse = nil
	if state.LastDecision != nil {
		decision := clonePollDecision(*state.LastDecision)
		copyState.LastDecision = &decision
	}
	copyState.DecisionHistory = make([]PollDecision, len(state.DecisionHistory))
	for index := range state.DecisionHistory {
		copyState.DecisionHistory[index] = clonePollDecision(state.DecisionHistory[index])
	}
	return &copyState
}

func clonePollDecision(decision PollDecision) PollDecision {
	decision.Reasons = append([]string(nil), decision.Reasons...)
	if decision.Prediction != nil {
		prediction := *decision.Prediction
		decision.Prediction = &prediction
	}
	return decision
}

// GetDecisionHistory returns recent decisions for a vehicle.
func (e *PollEngine) GetDecisionHistory(vin string, limit int) []PollDecision {
	e.mu.RLock()
	defer e.mu.RUnlock()
	vs, ok := e.vehicles[vin]
	if !ok {
		return nil
	}
	history := vs.DecisionHistory
	if limit > 0 && limit < len(history) {
		history = history[len(history)-limit:]
	}
	result := make([]PollDecision, len(history))
	copy(result, history)
	return result
}
