// Phase-50 / 0027 — C2 Battery health forecast narrative.
//
// battery_health_forecast.go ships ONE new read-only tool:
// `query_battery_health_forecast`. The tool is the single F4
// surface the battery-health-forecast-narrative strategy is
// allowed to call (see
// internal/ai/strategies/battery-health-forecast-narrative/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "thin Tool wrapper over an existing handler. **No new SQL
//     written.**" We compose existing helpers
//     (synthesizeBatterySnapshots, predictDegradation,
//     computeRiskFactors, lookupVehicleCapacityWh) and the existing
//     signal_log.SignalTrace + charging_sessions read paths through
//     a narrow [BatteryHealthForecaster] port. The production
//     adapter (*api.AIBatteryHealthForecaster) wraps the same
//     fields *BatteryDegradationHandler does and re-uses the SAME
//     package-level helpers so the AI surface is grounded in the
//     SAME deterministic forecast model the chart renders.
//
//   - The tool is a READ — Mutates() returns false. The dispatcher's
//     deny-all confirm gate refuses anything mutating; this slice
//     ships zero mutating tools.
//
//   - One tool, one strategy: the tool is registered on the
//     process-wide tools.Registry alongside the 12 builtins so a
//     future strategy that wants the same envelope can declare it
//     too. The dispatcher's per-strategy whitelist still gates
//     which strategies can call it.
//
// The tool's output is a deterministic typed envelope (all numeric
// metrics + bucket labels — no free-form prose) constructed by the
// production adapter:
//
//	{
//	  "vehicle_id": int64,
//	  "current_health_pct":              float64, // 0..100
//	  "current_capacity_wh":             float64,
//	  "current_range_km":                float64,
//	  "battery_capacity_wh":             float64, // nominal
//	  "snapshot_count":                  int,
//	  "first_snapshot_date":             "YYYY-MM-DD",
//	  "degradation_rate_pct_per_year":   float64, // |slope|
//	  "degradation_rate_pct_per_month":  float64,
//	  "years_to_80_pct":                 float64,
//	  "projected_80_pct_date":           "YYYY-MM" or "",
//	  "has_enough_data":                 bool,
//	  "stress_level":                    "Low"|"Medium"|"High",
//	  "charging_habits": {
//	      "fast_charge_count":    int,
//	      "slow_charge_count":    int,
//	      "deep_discharge_count": int,
//	      "charge_to_full_count": int,
//	      "high_soc_count":       int,
//	      "total_count":          int,
//	      "fast_charge_ratio_pct": float64
//	  },
//	  "risk_factors": [
//	    {"name": "fast_charge_ratio", "score": int, "label": "Low"|"Moderate"|"Elevated"|"High", "detail": string},
//	    ... 5 entries total
//	  ]
//	}
//
// All fields are SI canonical (Phase-48 contract). The frontend's
// useUnits()/useFormatting() at the display boundary converts to
// the user's preferred units before rendering.

package tools

import (
	"context"
	"encoding/json"
	"errors"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by query_battery_health_forecast.
// ---------------------------------------------------------------------------

// BatteryHealthChargingHabits is the ratio-tagged charging-habits
// block the forecast narrator quotes. Mirrors the
// chargingHabits struct in
// internal/api/battery_degradation_handler.go's Predict but with
// the additional fast_charge_ratio_pct already computed so the
// LLM does not need to do division.
type BatteryHealthChargingHabits struct {
	FastChargeCount    int     `json:"fast_charge_count"`
	SlowChargeCount    int     `json:"slow_charge_count"`
	DeepDischargeCount int     `json:"deep_discharge_count"`
	ChargeToFullCount  int     `json:"charge_to_full_count"`
	HighSocCount       int     `json:"high_soc_count"`
	TotalCount         int     `json:"total_count"`
	FastChargeRatioPct float64 `json:"fast_charge_ratio_pct"`
}

// BatteryHealthRiskFactor mirrors the riskFactor JSON the
// deterministic /analytics/battery-degradation handler returns.
// Re-declared here so the AI tool envelope is self-contained — the
// `internal/api` package is a long-running consumer of these types
// and re-importing them would create a layering inversion (the
// tools package is below internal/api in the dependency graph).
type BatteryHealthRiskFactor struct {
	Name   string `json:"name"`
	Score  int    `json:"score"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

// BatteryHealthForecast is the typed envelope
// query_battery_health_forecast returns. Every field is grounded
// in the SAME deterministic forecast model the chart on
// /battery (BatteryHealthPage) renders — the adapter does not
// recompute anything the canonical handler doesn't already
// compute.
type BatteryHealthForecast struct {
	VehicleID                  int64                       `json:"vehicle_id"`
	CurrentHealthPct           float64                     `json:"current_health_pct"`
	CurrentCapacityWh          float64                     `json:"current_capacity_wh"`
	CurrentRangeKm             float64                     `json:"current_range_km"`
	BatteryCapacityWh          float64                     `json:"battery_capacity_wh"`
	SnapshotCount              int                         `json:"snapshot_count"`
	FirstSnapshotDate          string                      `json:"first_snapshot_date,omitempty"`
	DegradationRatePctPerYear  float64                     `json:"degradation_rate_pct_per_year"`
	DegradationRatePctPerMonth float64                     `json:"degradation_rate_pct_per_month"`
	YearsTo80Pct               float64                     `json:"years_to_80_pct"`
	Projected80PctDate         string                      `json:"projected_80_pct_date,omitempty"`
	HasEnoughData              bool                        `json:"has_enough_data"`
	StressLevel                string                      `json:"stress_level"`
	ChargingHabits             BatteryHealthChargingHabits `json:"charging_habits"`
	RiskFactors                []BatteryHealthRiskFactor   `json:"risk_factors"`
}

// ---------------------------------------------------------------------------
// Narrow port to the canonical forecaster.
// ---------------------------------------------------------------------------

// BatteryHealthForecaster is the narrow port the
// query_battery_health_forecast tool delegates to. In production
// it is satisfied by *api.AIBatteryHealthForecaster (wraps the
// same fields *api.BatteryDegradationHandler uses); tests
// substitute deterministic fakes so the tool unit tests stay
// hermetic.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the read-only contract that ADR-015 §I3 + the
// slice prompt mandate.
type BatteryHealthForecaster interface {
	// ForecastBatteryHealth runs the canonical deterministic
	// forecast for vehicleID and returns the typed envelope. Any
	// data-fetch / SQL error propagates back to the caller; a
	// non-nil error is rendered to the LLM as a tool failure
	// rather than crashing the dispatcher.
	ForecastBatteryHealth(ctx context.Context, vehicleID int64) (*BatteryHealthForecast, error)
}

// ---------------------------------------------------------------------------
// Tool: query_battery_health_forecast.
// ---------------------------------------------------------------------------

// queryBatteryHealthForecastInput is the typed input shape for the
// tool. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
type queryBatteryHealthForecastInput struct {
	// VehicleID identifies the vehicle whose forecast we narrate.
	// Required + positive — the AI handler ALWAYS scopes to the
	// caller's own vehicle, so a missing or nonsense ID is a
	// programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
}

// queryBatteryHealthForecast is the read-only tool that returns
// the deterministic battery-health forecast envelope.
//
// The dispatcher is allowed to invoke this tool because the
// battery-health-forecast-narrative strategy declares it in its
// Tools() whitelist. Other strategies that want the same envelope
// must add the name to their own Tools() list.
type queryBatteryHealthForecast struct {
	forecaster BatteryHealthForecaster
}

// Name implements [Tool].
func (t *queryBatteryHealthForecast) Name() string { return "query_battery_health_forecast" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryBatteryHealthForecast) Description() string {
	return "Return the deterministic battery-health forecast envelope for a vehicle: current state-of-health, " +
		"degradation rate (per-year and per-month), projected 80%-of-original-capacity date, stress level, " +
		"charging habits (fast/slow/deep-discharge/full-charge/high-SOC counts plus fast-charge ratio), and the " +
		"five risk-factor scores. All numeric fields are SI canonical. Use this for forecast narration; do not " +
		"iterate by calling this multiple times for the same vehicle."
}

// InputSchema implements [Tool].
func (t *queryBatteryHealthForecast) InputSchema() json.RawMessage {
	return cachedSchema(queryBatteryHealthForecastInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryBatteryHealthForecast) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryBatteryHealthForecast) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryBatteryHealthForecast) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryBatteryHealthForecast) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryBatteryHealthForecastInput](raw)
}

// Execute implements [Tool]. Delegates to the
// BatteryHealthForecaster port. The port handles all IO; this
// method's job is to enforce nil-port wiring and surface errors.
func (t *queryBatteryHealthForecast) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryBatteryHealthForecastInput)
	if t.forecaster == nil {
		return nil, errors.New("query_battery_health_forecast: no BatteryHealthForecaster wired")
	}
	out, err := t.forecaster.ForecastBatteryHealth(ctx, input.VehicleID)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("query_battery_health_forecast: forecaster returned nil envelope")
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// BatteryHealthForecastNarrativeSources bundles the narrow
// forecast interface RegisterBatteryHealthForecastNarrativeTools
// needs. Mirrors [SmartChargeScheduleSuggestionSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AIBatteryHealthForecaster); tests substitute
// deterministic fakes.
type BatteryHealthForecastNarrativeSources struct {
	Forecaster BatteryHealthForecaster
}

// RegisterBatteryHealthForecastNarrativeTools installs the
// battery-health-forecast-narrative slice's tools on r. Called
// from router.go AFTER the smart-charge-schedule-suggestion tool
// registration so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterBatteryHealthForecastNarrativeTools(r *Registry, s BatteryHealthForecastNarrativeSources) {
	r.Register(&queryBatteryHealthForecast{forecaster: s.Forecaster})
}
