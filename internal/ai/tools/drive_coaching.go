// Phase-50 / 0018 — N4 Per-drive coaching narrative.
//
// drive_coaching.go ships ONE new read-only tool:
// `query_drive_telemetry_summary`. Combined with the existing
// `query_drive_detail` builtin (see builtins.go), it forms the
// two-tool whitelist the drive-coaching strategy is allowed to call
// (see internal/ai/strategies/drive-coaching/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "thin Tool wrapper over an existing handler. **No new SQL written.**"
//     The tool reads ONE *models.Drive row via the existing
//     [DriveSource.GetByID] method (the same surface
//     query_drive_detail uses) and computes coaching-friendly
//     derived fields (regen_share_pct, kwh_per_100km,
//     battery_consumed_pct) from the aggregates already persisted
//     on the drive row. No SQL is added, modified, or duplicated by
//     this slice.
//
//   - The tool is a READ — Mutates() returns false. The dispatcher's
//     deny-all confirm gate refuses anything mutating; this slice
//     ships zero mutating tools and adds nothing to the drive
//     ingestion or aggregation pipeline. The coach only NARRATES
//     already-aggregated drive state; it never writes.
//
//   - One tool, multiple strategies: the tool is registered on the
//     process-wide tools.Registry alongside the 12 builtins + the
//     digest tool + the year-review tool + the anomaly tool, so a
//     future strategy that also wants per-drive coaching context
//     (e.g. a long-term efficiency coach that aggregates many drives)
//     can declare it without re-registration. The dispatcher's
//     per-strategy whitelist still gates which strategies can call it.
//
// The tool's output is a deterministic envelope mirroring the
// *models.Drive aggregate fields plus three derived fields the
// coach prefers to quote in plain English:
//
//	{
//	  "drive_id":              int64,
//	  "vehicle_id":            int64,
//	  "distance_m":            float64,
//	  "duration_s":            int64,
//	  "avg_speed_mps":         float64 | null,
//	  "max_speed_mps":         float64 | null,
//	  "avg_power_w":           float64 | null,
//	  "energy_used_wh":        float64 | null,
//	  "regen_energy_wh":       float64 | null,
//	  "regen_share_pct":       float64 | null,  // derived: regen / (energy_used + regen) * 100
//	  "kwh_per_100km":         float64 | null,  // derived: (energy_used_wh / 1000) / (distance_m / 100000)
//	  "start_battery_pct":     int16   | null,
//	  "end_battery_pct":       int16   | null,
//	  "battery_consumed_pct":  int16   | null,  // derived: start_pct - end_pct
//	  "outside_temp_avg_c":    float64 | null,
//	  "ended_status":          string  | null,
//	}
//
// All numeric fields are SI canonical (Phase-48 contract). The
// derived `kwh_per_100km` / `regen_share_pct` are dimensioned for
// human-readable narration but are still derived from SI inputs;
// the frontend's useUnits()/useFormatting() at the display boundary
// converts to the user's preferred units before rendering.

package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// queryDriveTelemetrySummaryInput is the typed input shape for the
// tool. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any DriveSource method runs.
//
// Reuses the same shape as [driveIDInput] in builtins.go but is
// declared separately so the per-tool input/output schema cache
// keys stay distinct (the cache is keyed by reflect.Type, not by
// JSON shape).
type queryDriveTelemetrySummaryInput struct {
	// DriveID identifies the drive to summarise. Required + positive
	// — the AI handler ALWAYS scopes to the caller-supplied drive_id
	// from the URL path, so a missing or nonsense ID is a programming
	// error rather than a user-facing case.
	DriveID int64 `json:"drive_id" validate:"required,gte=1" desc:"Numeric drive ID to summarise."`
}

// queryDriveTelemetrySummary is the read-only tool that computes
// coaching-friendly derived fields from a single *models.Drive row.
// It is one of the TWO tools the drive-coaching strategy is allowed
// to call (the other being the existing query_drive_detail builtin).
type queryDriveTelemetrySummary struct {
	src DriveSource
}

// Name implements [Tool].
func (t *queryDriveTelemetrySummary) Name() string { return "query_drive_telemetry_summary" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryDriveTelemetrySummary) Description() string {
	return "Return a coaching-friendly aggregate envelope for ONE drive: distance, duration, " +
		"avg/max speed, energy used vs regen recovered (with a derived regen_share_pct and " +
		"kwh_per_100km), battery consumed, and ambient temp. All numeric fields are SI " +
		"canonical (meters, seconds, watt-hours, m/s). Use this AFTER query_drive_detail to " +
		"get pre-computed derived fields suitable for plain-language narration; do not " +
		"iterate by calling this multiple times for the same drive."
}

// InputSchema implements [Tool].
func (t *queryDriveTelemetrySummary) InputSchema() json.RawMessage {
	return cachedSchema(queryDriveTelemetrySummaryInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryDriveTelemetrySummary) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryDriveTelemetrySummary) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryDriveTelemetrySummary) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryDriveTelemetrySummary) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryDriveTelemetrySummaryInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// derivation; no SQL is written by this method.
//
// A nil drive (drive not found) is surfaced as an explicit error so
// the dispatcher emits a tool-error frame the LLM can handle —
// silently returning an empty envelope would let the coach
// fabricate plausible-but-wrong narration.
func (t *queryDriveTelemetrySummary) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryDriveTelemetrySummaryInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_drive_telemetry_summary: no DriveSource wired")
	}
	d, err := t.src.GetByID(ctx, input.DriveID)
	if err != nil {
		return nil, fmt.Errorf("query_drive_telemetry_summary: load drive %d: %w", input.DriveID, err)
	}
	if d == nil {
		return nil, fmt.Errorf("drive %d not found", input.DriveID)
	}
	return summariseDriveForCoaching(d), nil
}

// summariseDriveForCoaching is a pure helper: given a *models.Drive,
// compute the deterministic coaching envelope. Extracted so the
// unit test can call it directly without spinning up a fake
// DriveSource and so the body of Execute stays focused on IO +
// error wrapping.
//
// All derivations are SAFE — division-by-zero is guarded, and
// nil-pointer aggregates remain nil in the output envelope (rather
// than collapsing to zero, which would silently mislead the coach
// about whether a metric is "zero" or "unknown").
func summariseDriveForCoaching(d *models.Drive) map[string]any {
	out := map[string]any{
		"drive_id":   d.ID,
		"vehicle_id": d.VehicleID,
		"distance_m": d.DistanceM,
		"duration_s": d.DurationS,
	}

	// Speed / power aggregates — surface nil through the envelope
	// when the column is NULL on the drive row. JSON null is
	// distinguishable from JSON 0 by the LLM and keeps the
	// nil-aware comments above honest.
	out["avg_speed_mps"] = derefFloat64Ptr(d.AvgSpeedMps)
	out["max_speed_mps"] = derefFloat64Ptr(d.MaxSpeedMps)
	out["avg_power_w"] = derefFloat64Ptr(d.AvgPowerW)
	out["energy_used_wh"] = derefFloat64Ptr(d.EnergyUsedWh)
	out["regen_energy_wh"] = derefFloat64Ptr(d.RegenEnergyWh)

	// regen_share_pct = regen / (energy_used + regen) * 100 — the
	// fraction of total round-trip energy the driver recovered
	// through regen. The denominator is the SUM (not just
	// energy_used) so a perfectly efficient regen-only drive (rare,
	// downhill) would approach 50%, not exceed 100%. Both nil ⇒
	// nil; non-positive denominator ⇒ nil.
	if d.EnergyUsedWh != nil && d.RegenEnergyWh != nil {
		denom := *d.EnergyUsedWh + *d.RegenEnergyWh
		if denom > 0 {
			out["regen_share_pct"] = (*d.RegenEnergyWh / denom) * 100.0
		} else {
			out["regen_share_pct"] = nil
		}
	} else {
		out["regen_share_pct"] = nil
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

	// Battery consumed — derived only when both endpoints are
	// known, otherwise nil. Note: a regen-only drive can have a
	// negative battery_consumed_pct (battery went UP), which is a
	// valid coaching observation, so we don't clamp the result.
	out["start_battery_pct"] = derefInt16Ptr(d.StartBatteryPct)
	out["end_battery_pct"] = derefInt16Ptr(d.EndBatteryPct)
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
	out["outside_temp_avg_c"] = derefFloat64Ptr(d.OutsideTempAvgC)
	out["ended_status"] = derefStringPtr(d.EndedStatus)

	return out
}

// derefFloat64Ptr returns the deref'd value or the typed nil any so
// the JSON encoder emits `null` for nil aggregates instead of `0`.
func derefFloat64Ptr(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// derefInt16Ptr mirrors derefFloat64Ptr for *int16 (battery pct).
func derefInt16Ptr(p *int16) any {
	if p == nil {
		return nil
	}
	return *p
}

// derefStringPtr mirrors derefFloat64Ptr for *string (ended_status).
// Empty strings stay empty (not collapsed to nil) so a future
// migration that allows empty-string sentinels keeps round-trip
// integrity.
func derefStringPtr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// DriveCoachingSources bundles the narrow read interfaces
// RegisterDriveCoachingTools needs. Mirrors [DigestSources] /
// [AnomalySources] but exposes only the surface the
// query_drive_telemetry_summary tool actually consumes.
//
// Production wiring (router.go) reuses the same *database.DriveRepo
// instance the HTTP path is built around (and that
// Register12Builtins already received); tests substitute
// deterministic fakes per-source.
type DriveCoachingSources struct {
	Drives DriveSource
}

// RegisterDriveCoachingTools installs the drive-coaching slice's
// tools on r. Called from router.go AFTER Register12Builtins +
// RegisterDigestTools + RegisterYearReviewTools + RegisterAnomalyTools
// + RegisterAlertBuilderTools + RegisterAutomationBuilderTools +
// RegisterSearchTools so the registry's alphabetical Names list
// continues to grow deterministically without disturbing the
// BuiltinNames pin test or any earlier registration.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterDriveCoachingTools(r *Registry, s DriveCoachingSources) {
	r.Register(&queryDriveTelemetrySummary{src: s.Drives})
}
