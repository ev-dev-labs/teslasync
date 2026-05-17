// Phase-50 / 0019 — N5 Per-charging-session diagnosis.
//
// charging_diagnosis.go ships TWO new read-only tools:
// `query_charge_session` (single ChargingSession by ID) and
// `query_charging_aggregation` (deterministic flag-detection
// envelope mirroring the frontend
// web/src/lib/chargingAggregation.ts logic).
//
// Together they form the two-tool whitelist the charging-diagnosis
// strategy is allowed to call (see
// internal/ai/strategies/charging-diagnosis/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." Both tools are reads — Mutates()
//     returns false. The dispatcher's deny-all confirm gate refuses
//     anything mutating; this slice ships zero mutating tools and
//     adds nothing to the charging ingestion or aggregation
//     pipeline.
//
//   - "Explain trickle, expensive, low-power, or interrupted
//     charging flags WITHOUT changing how flags are computed." The
//     query_charging_aggregation tool mirrors the deterministic
//     thresholds + priority-ordered flag-detection logic from
//     web/src/lib/chargingAggregation.ts so the LLM sees the same
//     flag set the user sees on the page. Threshold values
//     (DEFAULT_THRESHOLDS in the .ts file) are pinned to the
//     identical numbers — a future change to one MUST update the
//     other in lockstep, enforced by the unit test
//     TestQueryChargingAggregation_ThresholdsMatchFrontend.
//
//   - One tool, multiple strategies: each tool is registered on the
//     process-wide tools.Registry alongside the 12 builtins + the
//     digest tool + the year-review tool + the anomaly tool + the
//     drive-coaching tool, so a future strategy that also wants
//     per-charging-session diagnosis context (e.g. a long-term
//     home-charger optimisation strategy) can declare it without
//     re-registration. The dispatcher's per-strategy whitelist
//     still gates which strategies can call each tool.
//
// Output envelope (query_charging_aggregation):
//
//	{
//	  "session_id":        int64,
//	  "vehicle_id":        int64,
//	  "duration_min":      float64 | null,
//	  "kwh_added":         float64 | null,
//	  "avg_power_kw":      float64 | null,
//	  "peak_power_kw":     float64 | null,
//	  "cost_per_kwh":      float64 | null,  // derived: cost_decimal / kwh_added
//	  "cost_total":        float64 | null,  // pass-through cost_decimal
//	  "currency":          string  | null,
//	  "charger_category":  string,          // "home" | "supercharger" | "dc" | "unknown"
//	  "start_soc_pct":     float64 | null,
//	  "end_soc_pct":       float64 | null,
//	  "delta_soc_pct":     float64 | null,
//	  "is_active":         bool,
//	  "flags":             []string,        // ordered subset of the 5 canonical flag names
//	  "flag":              string  | null,  // first match (priority order — mirrors the frontend)
//	  "flag_detail":       map | null,      // human-readable detail per flag (numbers in SI + display units)
//	  "thresholds":        map,             // pinned thresholds the flags above were evaluated against
//	}
//
// All numeric power/energy fields are SI canonical (Phase-48
// contract). Derived `avg_power_kw` / `kwh_added` / `cost_per_kwh`
// are dimensioned for human-readable narration but are still
// derived from SI inputs; the frontend's useUnits()/useFormatting()
// at the display boundary handles user-preferred unit conversion.

package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ---------------------------------------------------------------------------
// query_charge_session
// ---------------------------------------------------------------------------

// queryChargeSessionInput is the typed input shape for the
// query_charge_session tool. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct so a
// malformed input fails before any ChargeSource method runs.
//
// Reuses the same shape as [chargeIDInput] in builtins.go but is
// declared separately so the per-tool input/output schema cache
// keys stay distinct (the cache is keyed by reflect.Type, not by
// JSON shape) AND so a future per-tool field addition does not
// silently change the existing query_charge_detail surface.
type queryChargeSessionInput struct {
	// SessionID identifies the charging session to summarise.
	// Required + positive — the AI handler ALWAYS scopes to the
	// caller-supplied session_id from the URL path, so a missing
	// or nonsense ID is a programming error rather than a
	// user-facing case.
	SessionID int64 `json:"session_id" validate:"required,gte=1" desc:"Numeric charging session ID."`
}

// queryChargeSession is the read-only tool that returns ONE
// *models.ChargingSession by its ID. Distinct from the existing
// query_charge_detail builtin (which exposes the same surface under
// a different name) so the charging-diagnosis strategy's allowed-
// tool whitelist can stay self-contained: future per-feature
// changes to query_charge_session (e.g. adding a flag-overlay
// envelope) will not bleed into the chatbot's tool surface.
type queryChargeSession struct {
	src ChargeSource
}

// Name implements [Tool].
func (t *queryChargeSession) Name() string { return "query_charge_session" }

// Description implements [Tool].
func (t *queryChargeSession) Description() string {
	return "Return ONE charging session by its numeric ID, including SI energy/power/cost fields. " +
		"Use this BEFORE query_charging_aggregation to surface the raw session metrics; the " +
		"aggregation envelope adds the deterministic flag-detection layer on top."
}

// InputSchema implements [Tool].
func (t *queryChargeSession) InputSchema() json.RawMessage {
	return cachedSchema(queryChargeSessionInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryChargeSession) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryChargeSession) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryChargeSession) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryChargeSession) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryChargeSessionInput](raw)
}

// Execute implements [Tool]. One repo round-trip; no SQL is
// written by this method. A nil session (not found) is surfaced as
// an explicit error so the dispatcher emits a tool-error frame the
// LLM can handle — silently returning nil would let the diagnosis
// fabricate plausible-but-wrong narration.
func (t *queryChargeSession) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryChargeSessionInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_charge_session: no ChargeSource wired")
	}
	c, err := t.src.GetByID(ctx, input.SessionID)
	if err != nil {
		return nil, fmt.Errorf("query_charge_session: load session %d: %w", input.SessionID, err)
	}
	if c == nil {
		return nil, fmt.Errorf("charging session %d not found", input.SessionID)
	}
	return c, nil
}

// ---------------------------------------------------------------------------
// query_charging_aggregation
// ---------------------------------------------------------------------------

// queryChargingAggregationInput mirrors queryChargeSessionInput in
// shape so the LLM can call both tools with the same JSON object
// (it just renames the field across two different schema cache
// entries). Same SessionID validation rules.
type queryChargingAggregationInput struct {
	SessionID int64 `json:"session_id" validate:"required,gte=1" desc:"Numeric charging session ID."`
}

// queryChargingAggregation is the read-only tool that mirrors the
// frontend chargingAggregation.ts deterministic flag-detection
// logic. It computes the SAME set of flags the user sees on the
// page, with the SAME thresholds, in the SAME priority order, then
// returns them in a typed envelope the LLM can quote.
//
// The slice prompt's "without changing how flags are computed"
// mandate is satisfied by:
//
//  1. Replicating the thresholds verbatim (default 0.50 USD/kWh,
//     5 kW trickle ceiling, 360 minute trickle floor).
//  2. Replicating the priority order verbatim (telemetry_gap →
//     cost_zero → bad_power → expensive → trickle).
//  3. Returning the FIRST matching flag in `flag` (single-flag
//     mode, matching the frontend's "first match wins" badge
//     behaviour) AND the full ordered list in `flags` (so a
//     diagnosis can mention secondary flags if the LLM judges them
//     relevant).
//
// A unit test (TestQueryChargingAggregation_ThresholdsMatchFrontend)
// pins these constants to the identical numbers in
// web/src/lib/chargingAggregation.ts; a future PR that drifts one
// without the other will fail CI.
type queryChargingAggregation struct {
	src ChargeSource
}

// Pinned thresholds. MUST match
// web/src/lib/chargingAggregation.ts → DEFAULT_THRESHOLDS.
const (
	chargingFlagExpensiveCostPerKwh = 0.50  // USD per kWh (frontend default)
	chargingFlagTricklePowerKw      = 5.0   // kW
	chargingFlagTrickleMinDurMin    = 360.0 // 6 hours, in minutes
	chargingFlagTelemetryGapKwhFloor = 0.1  // kWh
	chargingFlagTelemetryGapMinDur   = 5.0  // minutes
	chargingFlagCostZeroKwhFloor     = 1.0  // kWh
	chargingFlagBadPowerKw           = 3.0  // kW
	chargingFlagBadPowerMinDur       = 30.0 // minutes
)

// Name implements [Tool].
func (t *queryChargingAggregation) Name() string { return "query_charging_aggregation" }

// Description implements [Tool].
func (t *queryChargingAggregation) Description() string {
	return "Return the deterministic flag-detection envelope for ONE charging session: any of " +
		"trickle, expensive, low-power (bad_power), interrupted (telemetry_gap), or cost_zero, " +
		"plus the underlying numbers (kWh added, duration, average power, cost per kWh) and the " +
		"thresholds the flags were evaluated against. Use this AFTER query_charge_session to get " +
		"the SAME flag classification the user sees on the page; do not iterate by calling this " +
		"multiple times for the same session."
}

// InputSchema implements [Tool].
func (t *queryChargingAggregation) InputSchema() json.RawMessage {
	return cachedSchema(queryChargingAggregationInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryChargingAggregation) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *queryChargingAggregation) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user.
func (t *queryChargingAggregation) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryChargingAggregation) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryChargingAggregationInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// derivation; no SQL is written by this method.
func (t *queryChargingAggregation) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryChargingAggregationInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_charging_aggregation: no ChargeSource wired")
	}
	c, err := t.src.GetByID(ctx, input.SessionID)
	if err != nil {
		return nil, fmt.Errorf("query_charging_aggregation: load session %d: %w", input.SessionID, err)
	}
	if c == nil {
		return nil, fmt.Errorf("charging session %d not found", input.SessionID)
	}
	return aggregateChargingSession(c), nil
}

// aggregateChargingSession is a pure helper: given a
// *models.ChargingSession, compute the deterministic diagnosis
// envelope. Extracted so the unit test can call it directly without
// spinning up a fake ChargeSource and so the body of Execute stays
// focused on IO + error wrapping.
//
// All derivations are SAFE — division-by-zero is guarded, and
// nil-pointer aggregates remain nil in the output envelope (rather
// than collapsing to zero, which would silently mislead the
// diagnosis about whether a metric is "zero" or "unknown").
func aggregateChargingSession(c *models.ChargingSession) map[string]any {
	out := map[string]any{
		"session_id": c.ID,
		"vehicle_id": c.VehicleID,
		"is_active":  c.IsActive(),
	}

	// Duration (minutes). Mirrors the frontend's
	// durationMinutes(session): nil for in-progress sessions or
	// malformed timestamps.
	durMinPtr := c.DurationMinutes()
	if durMinPtr != nil {
		out["duration_min"] = *durMinPtr
	} else {
		out["duration_min"] = nil
	}

	// kWh added. Pass-through Wh / 1000. nil on a missing
	// total_energy_added_wh column.
	var kwhAdded *float64
	if c.TotalEnergyAddedWh != nil {
		v := *c.TotalEnergyAddedWh / 1000.0
		kwhAdded = &v
		out["kwh_added"] = v
	} else {
		out["kwh_added"] = nil
	}

	// avg_power_kw — mirrors the frontend's avgPowerW(session) but
	// returns nil when neither path produces a positive value (the
	// frontend collapses to 0; the LLM benefits from explicit nil).
	avgPowerKw := computeAvgPowerKw(c, durMinPtr, kwhAdded)
	if avgPowerKw != nil {
		out["avg_power_kw"] = *avgPowerKw
	} else {
		out["avg_power_kw"] = nil
	}

	// peak_power_kw — pass-through W / 1000. nil on missing column.
	if c.PeakPowerW != nil {
		out["peak_power_kw"] = *c.PeakPowerW / 1000.0
	} else {
		out["peak_power_kw"] = nil
	}

	// Cost — pass-through cost_decimal + currency, plus derived
	// cost_per_kwh (mirrors the frontend's costPerKwh(session)).
	if c.CostDecimal != nil {
		out["cost_total"] = *c.CostDecimal
	} else {
		out["cost_total"] = nil
	}
	if c.CostCurrency != nil {
		out["currency"] = *c.CostCurrency
	} else {
		out["currency"] = nil
	}
	cpk := computeCostPerKwh(c, kwhAdded)
	if cpk != nil {
		out["cost_per_kwh"] = *cpk
	} else {
		out["cost_per_kwh"] = nil
	}

	// Charger category — mirrors getChargerCategory(charger_type).
	var chargerType string
	if c.ChargerType != nil {
		chargerType = *c.ChargerType
	}
	out["charger_category"] = classifyChargerCategory(chargerType)

	// SoC pass-through.
	if c.StartSocPct != nil {
		out["start_soc_pct"] = *c.StartSocPct
	} else {
		out["start_soc_pct"] = nil
	}
	if c.EndSocPct != nil {
		out["end_soc_pct"] = *c.EndSocPct
	} else {
		out["end_soc_pct"] = nil
	}
	if c.DeltaSocPct != nil {
		out["delta_soc_pct"] = *c.DeltaSocPct
	} else {
		out["delta_soc_pct"] = nil
	}

	// Flag detection — priority-ordered, matching the frontend's
	// detectChargingAnomalies first-match-wins behaviour. We
	// emit:
	//   - `flags`: ordered list of EVERY matching flag (LLM may
	//     reference secondary observations);
	//   - `flag`:  the first matching flag (the badge the user
	//     sees on the page, single-flag-per-session by frontend
	//     contract).
	flags := detectChargingFlags(c, durMinPtr, kwhAdded, avgPowerKw, cpk)
	out["flags"] = flags
	if len(flags) > 0 {
		out["flag"] = flags[0]
	} else {
		out["flag"] = nil
	}

	// flag_detail — human-readable per-flag explanation the LLM
	// can quote without doing arithmetic. Always returns a map
	// (possibly empty).
	out["flag_detail"] = chargingFlagDetail(flags, c, durMinPtr, kwhAdded, avgPowerKw, cpk)

	// Thresholds — pinned constants this evaluation used.
	// Surfaced so the LLM can quote the threshold the flag was
	// raised against without inventing one.
	out["thresholds"] = map[string]any{
		"expensive_cost_per_kwh":     chargingFlagExpensiveCostPerKwh,
		"trickle_power_kw":           chargingFlagTricklePowerKw,
		"trickle_min_duration_min":   chargingFlagTrickleMinDurMin,
		"telemetry_gap_kwh_floor":    chargingFlagTelemetryGapKwhFloor,
		"telemetry_gap_min_duration": chargingFlagTelemetryGapMinDur,
		"cost_zero_kwh_floor":        chargingFlagCostZeroKwhFloor,
		"bad_power_kw":               chargingFlagBadPowerKw,
		"bad_power_min_duration":     chargingFlagBadPowerMinDur,
	}

	return out
}

// computeAvgPowerKw mirrors the frontend's avgPowerW(session): use
// energy/duration when both are present + positive, else fall back
// to the persisted avg_power_w column. Returns nil only when both
// paths fail (the frontend collapses to 0; nil is more honest).
//
// kwhAdded is taken in as a pointer so the helper can avoid
// re-reading c.TotalEnergyAddedWh — but it's safe to pass nil.
func computeAvgPowerKw(c *models.ChargingSession, durMin *float64, kwhAdded *float64) *float64 {
	if durMin != nil && *durMin > 0 && kwhAdded != nil && *kwhAdded > 0 {
		v := *kwhAdded / (*durMin / 60.0)
		return &v
	}
	if c.AvgPowerW != nil && *c.AvgPowerW > 0 {
		v := *c.AvgPowerW / 1000.0
		return &v
	}
	return nil
}

// computeCostPerKwh mirrors the frontend's costPerKwh(session):
// returns nil for free / unknown / zero-energy sessions, otherwise
// cost_decimal / kwhAdded.
func computeCostPerKwh(c *models.ChargingSession, kwhAdded *float64) *float64 {
	if kwhAdded == nil || *kwhAdded <= 0 {
		return nil
	}
	if c.CostDecimal == nil || *c.CostDecimal <= 0 {
		return nil
	}
	v := *c.CostDecimal / *kwhAdded
	return &v
}

// classifyChargerCategory mirrors the frontend's
// getChargerCategory(charger_type) — case-insensitive substring
// match against a small set of well-known prefixes.
//
// Empty/nil charger_type → "home" (per the frontend comment "null
// type historically means home AC").
func classifyChargerCategory(chargerType string) string {
	if chargerType == "" {
		return "home"
	}
	t := lower(chargerType)
	switch {
	case strContains(t, "super"), strContains(t, "tpc"):
		return "supercharger"
	case strContains(t, "dc"), strContains(t, "ccs"), strContains(t, "chademo"), strContains(t, "fast"):
		return "dc"
	case strContains(t, "home"), strContains(t, "ac"), strContains(t, "wall"):
		return "home"
	}
	return "unknown"
}

// detectChargingFlags returns the ordered set of flags the
// deterministic detector raises for this session. Mirrors the
// frontend's detectChargingAnomalies: priority order is
// telemetry_gap → cost_zero → bad_power → expensive → trickle. The
// frontend stops at the FIRST match (one badge per session); we
// return the full ordered match list so the LLM can mention
// secondary observations if it judges them relevant. The first
// element is also exposed as `flag` for parity with the user's
// badge.
func detectChargingFlags(c *models.ChargingSession, durMin *float64, kwhAdded *float64, avgPowerKw *float64, cpk *float64) []string {
	flags := []string{}

	// Helper: the frontend treats nil duration as 0 for flag math;
	// nil kwh as 0; nil avgPower as 0; nil cpk as "unknown" (the
	// expensive flag short-circuits).
	dur := 0.0
	if durMin != nil {
		dur = *durMin
	}
	kwh := 0.0
	if kwhAdded != nil {
		kwh = *kwhAdded
	}
	power := 0.0
	if avgPowerKw != nil {
		power = *avgPowerKw
	}

	// telemetry_gap — energyKwh < 0.1 AND duration > 5 min.
	// Mirrors the frontend's "0 kWh added in {dur} — telemetry
	// gap?" message. Maps to the slice prompt's "interrupted"
	// flag family.
	if kwh < chargingFlagTelemetryGapKwhFloor && dur > chargingFlagTelemetryGapMinDur {
		flags = append(flags, "telemetry_gap")
	}

	// cost_zero — energyKwh > 1 AND cost is null/zero AND
	// charger is NOT home (free home charging is normal).
	chargerCategory := "home"
	if c.ChargerType != nil {
		chargerCategory = classifyChargerCategory(*c.ChargerType)
	}
	costMissing := c.CostDecimal == nil || *c.CostDecimal == 0
	if kwh > chargingFlagCostZeroKwhFloor && costMissing && chargerCategory != "home" {
		flags = append(flags, "cost_zero")
	}

	// bad_power — DC charger AND duration > 30 min AND avg power
	// < 3 kW. Maps to the slice prompt's "low-power" flag family.
	if chargerCategory == "dc" && dur > chargingFlagBadPowerMinDur && power < chargingFlagBadPowerKw {
		flags = append(flags, "bad_power")
	}

	// expensive — cost_per_kwh known AND > 0.50.
	if cpk != nil && *cpk > chargingFlagExpensiveCostPerKwh {
		flags = append(flags, "expensive")
	}

	// trickle — duration > 360 min AND avg power < 5 kW.
	if dur > chargingFlagTrickleMinDurMin && power < chargingFlagTricklePowerKw {
		flags = append(flags, "trickle")
	}

	return flags
}

// chargingFlagDetail emits a per-flag human-readable detail map
// the LLM can quote verbatim. Empty input → empty map (not nil) so
// JSON marshalling stays consistent.
func chargingFlagDetail(flags []string, c *models.ChargingSession, durMin *float64, kwhAdded *float64, avgPowerKw *float64, cpk *float64) map[string]any {
	out := map[string]any{}
	for _, f := range flags {
		switch f {
		case "telemetry_gap":
			out[f] = map[string]any{
				"reason":          "0 kWh added but session ran for >5 minutes",
				"duration_min":    derefFloatOrNil(durMin),
				"kwh_added":       derefFloatOrNil(kwhAdded),
				"threshold_min":   chargingFlagTelemetryGapMinDur,
				"threshold_kwh":   chargingFlagTelemetryGapKwhFloor,
			}
		case "cost_zero":
			out[f] = map[string]any{
				"reason":        "Energy was added but no cost was recorded for a non-home session",
				"kwh_added":     derefFloatOrNil(kwhAdded),
				"threshold_kwh": chargingFlagCostZeroKwhFloor,
			}
		case "bad_power":
			out[f] = map[string]any{
				"reason":              "Sustained low power on a DC charger",
				"avg_power_kw":        derefFloatOrNil(avgPowerKw),
				"duration_min":        derefFloatOrNil(durMin),
				"threshold_power_kw":  chargingFlagBadPowerKw,
				"threshold_min":       chargingFlagBadPowerMinDur,
			}
		case "expensive":
			var currency string
			if c.CostCurrency != nil {
				currency = *c.CostCurrency
			}
			out[f] = map[string]any{
				"reason":               "Cost per kWh is above the configured threshold",
				"cost_per_kwh":         derefFloatOrNil(cpk),
				"currency":             currency,
				"threshold_per_kwh":    chargingFlagExpensiveCostPerKwh,
			}
		case "trickle":
			out[f] = map[string]any{
				"reason":             "Long, low-power charging session (slow trickle)",
				"avg_power_kw":       derefFloatOrNil(avgPowerKw),
				"duration_min":       derefFloatOrNil(durMin),
				"threshold_power_kw": chargingFlagTricklePowerKw,
				"threshold_min":      chargingFlagTrickleMinDurMin,
			}
		}
	}
	return out
}

// derefFloatOrNil returns the deref'd value or nil so the JSON
// encoder emits `null` for nil pointers instead of `0` (avoids the
// LLM confusing "zero" and "unknown").
func derefFloatOrNil(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// strContains and lower are tiny helpers kept package-private to
// avoid an extra strings import in this file. They mirror the
// frontend's `t.includes(...)` substring test on a lowercased
// string.
func strContains(s, sub string) bool {
	if sub == "" {
		return true
	}
	if len(sub) > len(s) {
		return false
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func lower(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// ChargingDiagnosisSources bundles the narrow read interfaces
// RegisterChargingDiagnosisTools needs. Mirrors [DriveCoachingSources]
// / [DigestSources] / [AnomalySources] but exposes only the surface
// the two charging-diagnosis tools actually consume.
//
// Production wiring (router.go) reuses the same *database.ChargingRepo
// instance the HTTP path is built around (and that Register12Builtins
// already received); tests substitute deterministic fakes per-source.
type ChargingDiagnosisSources struct {
	Charges ChargeSource
}

// RegisterChargingDiagnosisTools installs the charging-diagnosis
// slice's tools on r. Called from router.go AFTER Register12Builtins
// + RegisterDigestTools + RegisterYearReviewTools + RegisterAnomalyTools
// + RegisterAlertBuilderTools + RegisterAutomationBuilderTools +
// RegisterSearchTools + RegisterDriveCoachingTools so the registry's
// alphabetical Names list continues to grow deterministically without
// disturbing the BuiltinNames pin test or any earlier registration.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterChargingDiagnosisTools(r *Registry, s ChargingDiagnosisSources) {
	r.Register(&queryChargeSession{src: s.Charges})
	r.Register(&queryChargingAggregation{src: s.Charges})
}
