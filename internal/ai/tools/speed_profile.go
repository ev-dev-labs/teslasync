// Phase-50 / 0022 — D2 Speed-profile insights.
//
// speed_profile.go ships TWO new read-only tools:
// `query_speed_profile` (SI aggregates plus a derived speed regime
// classification from the *drivemodel.Drive row) and
// `query_drive_context` (the drive's temporal + battery +
// temperature envelope from the SAME *drivemodel.Drive row).
//
// Together they form the two-tool whitelist the
// speed-profile-insights strategy is allowed to call (see
// internal/ai/strategies/speed-profile-insights/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." Both tools are reads — Mutates()
//     returns false. The dispatcher's deny-all confirm gate refuses
//     anything mutating; this slice ships zero mutating tools and
//     adds nothing to the drive ingestion or aggregation pipeline.
//
//   - "No new SQL written." Both tools call the existing
//     [DriveSource.GetByID] method (the same surface the
//     query_drive_detail builtin and the query_drive_telemetry_summary
//     coaching tool use). Speed-bucket math + regime classification
//     happen in-memory on the *drivemodel.Drive row.
//
//   - Privacy-by-default for route geometry: neither tool returns
//     start_lat / start_lon / end_lat / end_lon, nor the unredacted
//     start_address / end_address strings. The presence of an
//     address is surfaced as `has_start_address` / `has_end_address`
//     so the LLM can mention route character ("this drive had
//     known endpoints") without ever seeing the address string.
//     PolicySpeedProfileInsights's allow-list (ClassVehicleName
//     only) is a second line of defence; this in-tool exclusion is
//     the first.
//
//   - Speed-regime classification matches the existing fleet
//     analytics handler (internal/api/speed_profile_handler.go,
//     `CASE WHEN avg_speed_mps < 13.4112 THEN City ELSE …`) so the
//     LLM uses the SAME canonical bucket the deterministic chart
//     uses. Threshold values are SI-canonical from the Phase-48
//     migration; a future change to one MUST update the other in
//     lockstep, enforced by the unit test
//     TestQuerySpeedProfile_RegimeThresholdsMatchAnalytics.
//
// Output envelope (query_speed_profile):
//
//	{
//	  "drive_id":          int64,
//	  "vehicle_id":        int64,
//	  "distance_m":        float64,
//	  "duration_s":        int64,
//	  "avg_speed_mps":     float64 | null,
//	  "max_speed_mps":     float64 | null,
//	  "avg_speed_kmh":     float64 | null,   // derived: m/s * 3.6
//	  "max_speed_kmh":     float64 | null,   // derived: m/s * 3.6
//	  "avg_speed_mph":     float64 | null,   // derived: m/s / 0.44704
//	  "max_speed_mph":     float64 | null,   // derived: m/s / 0.44704
//	  "avg_power_w":       float64 | null,
//	  "energy_used_wh":    float64 | null,
//	  "kwh_per_100km":     float64 | null,   // derived: (wh/1000) / (m/100000)
//	  "speed_regime":      string,           // city | suburban | highway | high_speed | unknown
//	  "speed_regime_label": string,          // human-readable label matching the analytics handler
//	  "thresholds":        map,              // pinned thresholds the regime above was evaluated against
//	}
//
// Output envelope (query_drive_context):
//
//	{
//	  "drive_id":          int64,
//	  "vehicle_id":        int64,
//	  "started_at":        string (RFC3339) | null,
//	  "ended_at":          string (RFC3339) | null,
//	  "duration_s":        int64,
//	  "distance_m":        float64,
//	  "outside_temp_avg_c":  float64 | null,
//	  "outside_temp_avg_f":  float64 | null,   // pre-computed °F = (°C × 9/5) + 32
//	  "start_battery_pct":   int16   | null,
//	  "end_battery_pct":     int16   | null,
//	  "battery_consumed_pct":int16   | null,  // derived: start - end
//	  "ended_status":      string | null,
//	  "has_start_address": bool,             // presence-only flag; the string is NOT returned
//	  "has_end_address":   bool,
//	  "has_route_coordinates": bool,         // true iff lat/lon endpoints are stored
//	}
//
// All numeric speed/power/energy fields are SI canonical (Phase-48
// contract). Derived `kwh_per_100km` / `*_kmh` / `*_mph` are
// dimensioned for human-readable narration but are still derived
// from SI inputs; the frontend's useUnits() at the display boundary
// reformats to mi/kWh or kWh/100mi for US users.

package tools

import (
	"context"
	"encoding/json"
	"fmt"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// ---------------------------------------------------------------------------
// Speed regime thresholds — pinned to the deterministic fleet
// analytics handler so the LLM sees the SAME canonical bucket the
// SpeedHistogramChart already renders.
//
// MUST match
// internal/api/speed_profile_handler.go's CASE statements:
//
//	CASE
//	  WHEN avg_speed_mps < 13.4112 THEN 'City (<30)'
//	  WHEN avg_speed_mps < 26.8224 THEN 'Suburban (30-60)'
//	  WHEN avg_speed_mps < 40.2336 THEN 'Highway (60-90)'
//	  ELSE 'High Speed (90+)'
//	END
//
// 13.4112 / 26.8224 / 40.2336 mps correspond to 30 / 60 / 90 mph.
// The unit test TestQuerySpeedProfile_RegimeThresholdsMatchAnalytics
// pins these constants to the identical numbers in the SQL handler;
// a future PR that drifts one without the other will fail CI.
// ---------------------------------------------------------------------------
const (
	speedRegimeCityCeilingMps     = 13.4112 // 30 mph
	speedRegimeSuburbanCeilingMps = 26.8224 // 60 mph
	speedRegimeHighwayCeilingMps  = 40.2336 // 90 mph

	mpsToKmh = 3.6
	mpsToMph = 1.0 / 0.44704
)

// ---------------------------------------------------------------------------
// query_speed_profile
// ---------------------------------------------------------------------------

// querySpeedProfileInput is the typed input shape for the
// query_speed_profile tool. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct so a
// malformed input fails before any DriveSource method runs.
type querySpeedProfileInput struct {
	// DriveID identifies the drive to summarise. Required + positive
	// — the AI handler ALWAYS scopes to the caller-supplied
	// drive_id from the URL path, so a missing or nonsense ID is a
	// programming error rather than a user-facing case.
	DriveID int64 `json:"drive_id" validate:"required,gte=1" desc:"Numeric drive ID."`
}

// querySpeedProfile is the read-only tool that returns ONE
// *drivemodel.Drive's SI speed aggregates plus a derived regime
// classification. Distinct from the existing query_drive_detail
// builtin so the speed-profile-insights strategy's allowed-tool
// whitelist can stay self-contained: future per-feature changes to
// query_speed_profile (e.g. adding a per-bucket reading count
// envelope when the drive_telemetry table grows that surface) will
// not bleed into the chatbot's tool surface.
type querySpeedProfile struct {
	src DriveSource
}

// Name implements [Tool].
func (t *querySpeedProfile) Name() string { return "query_speed_profile" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *querySpeedProfile) Description() string {
	return "Return the SI-canonical speed aggregates for ONE drive plus a derived speed regime " +
		"classification (city/suburban/highway/high_speed) matching the deterministic " +
		"SpeedHistogramChart already rendered on the page. Includes avg/max speed in m/s plus " +
		"derived km/h and mph values for human-readable narration, energy used, and a derived " +
		"kwh_per_100km efficiency figure. Use this BEFORE query_drive_context to surface the raw " +
		"speed metrics; the context envelope adds the temporal/battery/temperature backdrop on " +
		"top."
}

// InputSchema implements [Tool].
func (t *querySpeedProfile) InputSchema() json.RawMessage {
	return CachedSchema(querySpeedProfileInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *querySpeedProfile) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *querySpeedProfile) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *querySpeedProfile) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *querySpeedProfile) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[querySpeedProfileInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// derivation; no SQL is written by this method.
//
// A nil drive (drive not found) is surfaced as an explicit error so
// the dispatcher emits a tool-error frame the LLM can handle —
// silently returning an empty envelope would let the insights
// fabricate plausible-but-wrong narration.
func (t *querySpeedProfile) Execute(ctx context.Context, in any) (any, error) {
	input := in.(querySpeedProfileInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_speed_profile: no DriveSource wired")
	}
	d, err := t.src.GetByID(ctx, input.DriveID)
	if err != nil {
		return nil, fmt.Errorf("query_speed_profile: load drive %d: %w", input.DriveID, err)
	}
	if d == nil {
		return nil, fmt.Errorf("drive %d not found", input.DriveID)
	}
	return summariseSpeedProfile(d), nil
}

// summariseSpeedProfile is a pure helper: given a *drivemodel.Drive,
// compute the deterministic speed-profile envelope. Extracted so the
// unit test can call it directly without spinning up a fake
// DriveSource and so the body of Execute stays focused on IO +
// error wrapping.
//
// All derivations are SAFE — division-by-zero is guarded, and
// nil-pointer aggregates remain nil in the output envelope (rather
// than collapsing to zero, which would silently mislead the
// narration about whether a metric is "zero" or "unknown").
func summariseSpeedProfile(d *drivemodel.Drive) map[string]any {
	out := map[string]any{
		"drive_id":   d.ID,
		"vehicle_id": d.VehicleID,
		"distance_m": d.DistanceM,
		"duration_s": d.DurationS,
	}

	// SI speed aggregates pass-through — nil-aware so JSON null is
	// preserved when the column was NULL on the drive row.
	out["avg_speed_mps"] = DerefFloat64Ptr(d.AvgSpeedMps)
	out["max_speed_mps"] = DerefFloat64Ptr(d.MaxSpeedMps)
	out["avg_power_w"] = DerefFloat64Ptr(d.AvgPowerW)
	out["energy_used_wh"] = DerefFloat64Ptr(d.EnergyUsedWh)

	// Derived km/h and mph — emitted alongside the SI values so the
	// narration can quote a familiar unit without doing arithmetic
	// in the prompt (which models do badly). Both are nil-aware.
	if d.AvgSpeedMps != nil {
		out["avg_speed_kmh"] = *d.AvgSpeedMps * mpsToKmh
		out["avg_speed_mph"] = *d.AvgSpeedMps * mpsToMph
	} else {
		out["avg_speed_kmh"] = nil
		out["avg_speed_mph"] = nil
	}
	if d.MaxSpeedMps != nil {
		out["max_speed_kmh"] = *d.MaxSpeedMps * mpsToKmh
		out["max_speed_mph"] = *d.MaxSpeedMps * mpsToMph
	} else {
		out["max_speed_kmh"] = nil
		out["max_speed_mph"] = nil
	}

	// kwh_per_100km = (energy_used_wh / 1000) / (distance_m /
	// 100000) — the canonical EU efficiency unit. Computed from
	// SI inputs; the frontend's useUnits() reformats to mi/kWh or
	// kWh/100mi for US users. nil energy ⇒ nil; non-positive
	// distance ⇒ nil (a stationary "drive" has no efficiency).
	if d.EnergyUsedWh != nil && d.DistanceM > 0 {
		kwh := *d.EnergyUsedWh / 1000.0
		hundredKm := d.DistanceM / 100000.0
		out["kwh_per_100km"] = kwh / hundredKm
	} else {
		out["kwh_per_100km"] = nil
	}

	// Speed regime classification — mirrors the deterministic SQL
	// CASE in internal/api/speed_profile_handler.go. nil avg speed
	// ⇒ "unknown" (the chart skips the row; the narration should
	// say so explicitly rather than guessing).
	regime, label := classifySpeedRegime(d.AvgSpeedMps)
	out["speed_regime"] = regime
	out["speed_regime_label"] = label

	// Thresholds — pinned constants this classification used.
	// Surfaced so the LLM can quote the boundary the regime was
	// classified against without inventing one.
	out["thresholds"] = map[string]any{
		"city_ceiling_mps":     speedRegimeCityCeilingMps,
		"suburban_ceiling_mps": speedRegimeSuburbanCeilingMps,
		"highway_ceiling_mps":  speedRegimeHighwayCeilingMps,
		"city_ceiling_mph":     30.0,
		"suburban_ceiling_mph": 60.0,
		"highway_ceiling_mph":  90.0,
	}

	return out
}

// classifySpeedRegime returns the (machine, human) regime tuple for
// a nullable SI avg speed. Mirrors the SQL CASE in the deterministic
// fleet analytics handler exactly — same ceilings, same ordering,
// same "ELSE high speed" tail.
//
// nil ⇒ ("unknown", "Unknown"). The narration is expected to use
// the regime key for logic and the label for human-readable copy.
func classifySpeedRegime(avgMps *float64) (string, string) {
	if avgMps == nil {
		return "unknown", "Unknown"
	}
	switch v := *avgMps; {
	case v < speedRegimeCityCeilingMps:
		return "city", "City (<30 mph)"
	case v < speedRegimeSuburbanCeilingMps:
		return "suburban", "Suburban (30-60 mph)"
	case v < speedRegimeHighwayCeilingMps:
		return "highway", "Highway (60-90 mph)"
	default:
		return "high_speed", "High Speed (90+ mph)"
	}
}

// ---------------------------------------------------------------------------
// query_drive_context
// ---------------------------------------------------------------------------

// queryDriveContextInput mirrors querySpeedProfileInput in shape so
// the LLM can call both tools with the same JSON object (it just
// renames the field across two different schema cache entries).
// Same DriveID validation rules.
type queryDriveContextInput struct {
	DriveID int64 `json:"drive_id" validate:"required,gte=1" desc:"Numeric drive ID."`
}

// queryDriveContext is the read-only tool that returns ONE
// *drivemodel.Drive's temporal + battery + temperature envelope WITHOUT
// route geometry. Distinct from the existing query_drive_detail
// builtin and from query_drive_telemetry_summary so the
// speed-profile-insights strategy's allowed-tool whitelist can stay
// self-contained AND so the privacy-by-default exclusion of
// lat/lon/address is fixed at the tool boundary (not relying on
// redaction-policy enforcement alone).
type queryDriveContext struct {
	src DriveSource
}

// Name implements [Tool].
func (t *queryDriveContext) Name() string { return "query_drive_context" }

// Description implements [Tool].
func (t *queryDriveContext) Description() string {
	return "Return the temporal, battery, and temperature context envelope for ONE drive: " +
		"started_at/ended_at timestamps, distance, duration, outside temperature, start/end " +
		"battery percentages and consumed delta, ended_status, and PRESENCE flags for " +
		"start/end addresses + route coordinates (the address strings and lat/lon themselves " +
		"are NOT returned — privacy-by-default at the tool boundary). Use this AFTER " +
		"query_speed_profile to add temporal and battery context to the speed regime " +
		"narration; do not iterate by calling this multiple times for the same drive."
}

// InputSchema implements [Tool].
func (t *queryDriveContext) InputSchema() json.RawMessage {
	return CachedSchema(queryDriveContextInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryDriveContext) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *queryDriveContext) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryDriveContext) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryDriveContext) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryDriveContextInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// envelope construction; no SQL is written by this method.
func (t *queryDriveContext) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryDriveContextInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_drive_context: no DriveSource wired")
	}
	d, err := t.src.GetByID(ctx, input.DriveID)
	if err != nil {
		return nil, fmt.Errorf("query_drive_context: load drive %d: %w", input.DriveID, err)
	}
	if d == nil {
		return nil, fmt.Errorf("drive %d not found", input.DriveID)
	}
	return buildDriveContext(d), nil
}

// buildDriveContext is a pure helper: given a *drivemodel.Drive, build
// the temporal + battery + temperature envelope WITHOUT route
// geometry. Extracted so the unit test can call it directly without
// spinning up a fake DriveSource.
//
// CRITICAL: this function MUST NOT return start_lat, start_lon,
// end_lat, end_lon, start_address, or end_address. The presence of
// each address/coordinate set is surfaced as a boolean flag only —
// the LLM can reason about route character ("this drive had named
// endpoints") without ever seeing the address string. The unit test
// TestBuildDriveContext_ExcludesPreciseRouteData pins this.
func buildDriveContext(d *drivemodel.Drive) map[string]any {
	out := map[string]any{
		"drive_id":   d.ID,
		"vehicle_id": d.VehicleID,
		"duration_s": d.DurationS,
		"distance_m": d.DistanceM,
	}

	// Timestamps — RFC3339 strings for stable JSON shape. EndTs is
	// nullable (in-progress drives can have a NULL end_ts in the
	// drives table); nil ⇒ JSON null, not a sentinel string.
	out["started_at"] = d.StartTs.Format("2006-01-02T15:04:05Z07:00")
	if d.EndTs != nil {
		out["ended_at"] = d.EndTs.Format("2006-01-02T15:04:05Z07:00")
	} else {
		out["ended_at"] = nil
	}

	// Battery — start, end, derived consumed delta. A regen-only
	// drive can have a negative battery_consumed_pct (battery went
	// UP), which is a valid observation, so we don't clamp.
	out["start_battery_pct"] = DerefInt16Ptr(d.StartBatteryPct)
	out["end_battery_pct"] = DerefInt16Ptr(d.EndBatteryPct)
	if d.StartBatteryPct != nil && d.EndBatteryPct != nil {
		consumed := int16(*d.StartBatteryPct) - int16(*d.EndBatteryPct)
		out["battery_consumed_pct"] = consumed
	} else {
		out["battery_consumed_pct"] = nil
	}

	// Cabin temp + ended status — pass-through (already nullable).
	// InsideTempAvgC is intentionally excluded: it's nil on every
	// row by ADR-001 / Phase-42 (column dropped) and surfacing it
	// would mislead the LLM about its availability.
	out["outside_temp_avg_c"] = DerefFloat64Ptr(d.OutsideTempAvgC)
	out["outside_temp_avg_f"] = CToFPtr(d.OutsideTempAvgC)
	out["ended_status"] = DerefStringPtr(d.EndedStatus)

	// Privacy: presence-only flags. The actual strings + lat/lon
	// are NEVER returned by this tool. The slice's redaction
	// policy (ClassVehicleName only) is a second line of defence
	// — this in-tool exclusion is the first.
	out["has_start_address"] = d.StartAddress != nil && *d.StartAddress != ""
	out["has_end_address"] = d.EndAddress != nil && *d.EndAddress != ""
	out["has_route_coordinates"] = d.StartLat != nil && d.StartLon != nil && d.EndLat != nil && d.EndLon != nil

	return out
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// SpeedProfileInsightsSources bundles the narrow read interfaces
// RegisterSpeedProfileInsightsTools needs. Mirrors
// [DriveCoachingSources] / [ChargingDiagnosisSources] but exposes
// only the surface the two speed-profile-insights tools actually
// consume.
//
// Production wiring (router.go) reuses the same *database.DriveRepo
// instance the HTTP path is built around (and that
// Register12Builtins already received); tests substitute
// deterministic fakes per-source.
type SpeedProfileInsightsSources struct {
	Drives DriveSource
}

// RegisterSpeedProfileInsightsTools installs the
// speed-profile-insights slice's tools on r. Called from router.go
// AFTER Register12Builtins + RegisterDigestTools +
// RegisterYearReviewTools + RegisterAnomalyTools +
// RegisterAlertBuilderTools + RegisterAutomationBuilderTools +
// RegisterSearchTools + RegisterDriveCoachingTools +
// RegisterChargingDiagnosisTools + RegisterRagHelpTools +
// RegisterNLDriveSearchReplayTools so the registry's alphabetical
// Names list continues to grow deterministically without disturbing
// the BuiltinNames pin test or any earlier registration.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterSpeedProfileInsightsTools(r *Registry, s SpeedProfileInsightsSources) {
	r.Register(&querySpeedProfile{src: s.Drives})
	r.Register(&queryDriveContext{src: s.Drives})
}
