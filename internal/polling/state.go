package polling

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// PollProfile categorises the vehicle's overall state for interval selection.
type PollProfile string

const (
	ProfileDriving  PollProfile = "driving"
	ProfileCharging PollProfile = "charging"
	ProfileIdle     PollProfile = "idle"
	ProfileSleeping PollProfile = "sleeping"
)

// PollDecision is the output of the engine for a single assessment cycle.
type PollDecision struct {
	ShouldPoll   bool            `json:"should_poll"`
	NextInterval time.Duration   `json:"next_interval_ms"`
	Activity     ActivityLevel   `json:"activity"`
	Profile      PollProfile     `json:"profile"`
	Reasons      []string        `json:"reasons"`
	CostSaved    float64         `json:"cost_saved"`
	Prediction   *PredictionInfo `json:"prediction,omitempty"`
}

// PredictionInfo describes an upcoming predicted state change.
type PredictionInfo struct {
	NextState   string        `json:"next_state"`   // "driving", "charging"
	EstimatedIn time.Duration `json:"estimated_in"` // how soon
	Confidence  float64       `json:"confidence"`
	BasedOn     string        `json:"based_on"` // human-readable source
}

// VehiclePollingState tracks per-vehicle polling state managed by the engine.
type VehiclePollingState struct {
	VIN               string                     `json:"vin"`
	LastResponse      *tesla.VehicleDataResponse `json:"-"`
	LastPollTime      time.Time                  `json:"last_poll_time"`
	NextPollAfter     time.Time                  `json:"next_poll_after"`
	BudgetPausedUntil time.Time                  `json:"budget_paused_until,omitzero"`
	BackoffReason     string                     `json:"backoff_reason,omitempty"`
	CurrentActivity   ActivityLevel              `json:"current_activity"`
	CurrentProfile    PollProfile                `json:"current_profile"`
	ConsecIdle        int                        `json:"consec_idle"`
	LastBatteryLevel  int                        `json:"last_battery_level"`
	LastOdometer      float64                    `json:"last_odometer"`
	LastDecision      *PollDecision              `json:"last_decision,omitempty"`
	DecisionHistory   []PollDecision             `json:"-"` // ring buffer, kept in memory
}

// IntervalConfig holds the poll intervals for each vehicle state.
type IntervalConfig struct {
	Driving  time.Duration `json:"driving"`  // default 15s
	Charging time.Duration `json:"charging"` // default 60s
	Idle     time.Duration `json:"idle"`     // default 5min
	Sleeping time.Duration `json:"sleeping"` // default 0 (don't poll)
}

// DefaultIntervalConfig returns sensible defaults.
func DefaultIntervalConfig() IntervalConfig {
	return IntervalConfig{
		Driving:  15 * time.Second,
		Charging: 60 * time.Second,
		Idle:     5 * time.Minute,
		Sleeping: 0,
	}
}

// EngineConfig controls the behaviour of the PollEngine.
type EngineConfig struct {
	Intervals             IntervalConfig `json:"intervals"`
	MaxBackoff            time.Duration  `json:"max_backoff"` // absolute cap (default 30min)
	EnablePredictor       bool           `json:"enable_predictor"`
	FleetTelemetryEnabled bool           `json:"fleet_telemetry_enabled"`
	DecisionHistorySize   int            `json:"decision_history_size"` // ring buffer size (default 100)
	CostPerRequest        float64        `json:"cost_per_request"`
	MonthlyCredit         float64        `json:"monthly_credit"` // $10
}

// DefaultEngineConfig returns sensible defaults.
func DefaultEngineConfig() EngineConfig {
	return EngineConfig{
		Intervals:           DefaultIntervalConfig(),
		MaxBackoff:          30 * time.Minute,
		EnablePredictor:     true,
		DecisionHistorySize: 100,
		CostPerRequest:      tesla.EstimatedCostUSD(tesla.BudgetCategoryVehicleData),
		MonthlyCredit:       10.0,
	}
}
