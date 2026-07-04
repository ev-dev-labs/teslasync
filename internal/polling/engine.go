package polling

import (
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
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
	mu          sync.RWMutex
	evaluators  []SignalEvaluator
	predictor   *Predictor
	costTracker *CostTracker
	vehicles    map[string]*VehiclePollingState // keyed by VIN
	config      EngineConfig
}

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
		cfg.CostPerRequest = 0.00222
	}
	if cfg.MonthlyCredit <= 0 {
		cfg.MonthlyCredit = 10.0
	}

	e := &PollEngine{
		vehicles:    make(map[string]*VehiclePollingState),
		config:      cfg,
		costTracker: NewCostTracker(cfg.CostPerRequest, cfg.MonthlyCredit),
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

// ShouldPoll checks whether enough time has elapsed for the next poll of
// the given vehicle. Returns false with a decision explaining why the poll
// was skipped.
func (e *PollEngine) ShouldPoll(vin string) (bool, PollDecision) {
	e.mu.RLock()
	vs, exists := e.vehicles[vin]
	e.mu.RUnlock()

	// Record baseline tick (what would happen without the engine)
	e.costTracker.RecordBaselineTick()

	if !exists {
		// First time seeing this vehicle — always poll
		return true, PollDecision{
			ShouldPoll:   true,
			Activity:     Active,
			Profile:      ProfileIdle,
			Reasons:      []string{"first poll for this vehicle"},
			NextInterval: e.config.Intervals.Idle,
		}
	}

	now := time.Now()
	if now.Before(vs.NextPollAfter) {
		remaining := vs.NextPollAfter.Sub(now)
		reason := "backoff active"
		skipReason := "idle"

		if vs.CurrentProfile == ProfileSleeping {
			reason = "vehicle is sleeping"
			skipReason = "sleep"
		}

		e.costTracker.RecordSkip(skipReason)

		return false, PollDecision{
			ShouldPoll:   false,
			NextInterval: remaining,
			Activity:     vs.CurrentActivity,
			Profile:      vs.CurrentProfile,
			Reasons:      []string{reason},
		}
	}

	return true, PollDecision{
		ShouldPoll:   true,
		Activity:     vs.CurrentActivity,
		Profile:      vs.CurrentProfile,
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
	vs.LastDecision = &decision

	// Append to decision history ring buffer
	if len(vs.DecisionHistory) >= e.config.DecisionHistorySize {
		vs.DecisionHistory = vs.DecisionHistory[1:]
	}
	vs.DecisionHistory = append(vs.DecisionHistory, decision)
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
	vs.CurrentActivity = Sleeping
	vs.CurrentProfile = ProfileSleeping
	vs.NextPollAfter = time.Now().Add(e.config.MaxBackoff)
	e.costTracker.RecordSkip("sleep")
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
		vs.ConsecIdle = 0
		vs.CurrentActivity = Active
		vs.CurrentProfile = ProfileDriving
		vs.NextPollAfter = time.Time{}
	}
}

// GetVehicleState returns the current polling state for a vehicle. Thread-safe.
func (e *PollEngine) GetVehicleState(vin string) (*VehiclePollingState, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	vs, ok := e.vehicles[vin]
	if !ok {
		return nil, false
	}
	// Return a copy to avoid data races
	cp := *vs
	cp.LastResponse = nil // don't leak full response
	return &cp, true
}

// GetAllVehicleStates returns a snapshot of all tracked vehicles.
func (e *PollEngine) GetAllVehicleStates() map[string]*VehiclePollingState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	result := make(map[string]*VehiclePollingState, len(e.vehicles))
	for vin, vs := range e.vehicles {
		cp := *vs
		cp.LastResponse = nil
		result[vin] = &cp
	}
	return result
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
