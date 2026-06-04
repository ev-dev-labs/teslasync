// Year-in-review narration tool.
//
// This file defines one read-only tool, `query_year_in_review_context`.
// The tool is the only surface
// the yir-narration strategy is allowed to call (see
// internal/ai/strategies/yir-narration/strategy.go's allowedTools
// whitelist).
//
// Design constraints:
//
//   - We compose the existing tools.DriveSource.GetByVehicle and
//     tools.ChargeSource.GetByVehicle methods (already used by the 12
//     builtins) and aggregate in-process — no new SQL columns,
//     joins, or migrations.
//
//   - The tool is read-only. Mutates() returns false, and the
//     dispatcher's deny-all confirm gate refuses mutating tools.
//
//   - One tool, multiple strategies: the tool is registered on the
//     process-wide tools.Registry alongside the 12 builtins + the
//     digest tool so a future strategy that wants annual aggregates
//     can declare it too. The dispatcher's per-strategy whitelist
//     still gates which strategies can call it.
//
// The tool's output is a deterministic aggregate envelope:
//
//	{
//	  "vehicle_id": int64,
//	  "year": int,
//	  "year_start_utc": "RFC3339",
//	  "year_end_utc":   "RFC3339",
//	  "drives_count":         int,
//	  "drives_distance_m":    float64,  // sum of Drive.DistanceM
//	  "drives_duration_s":    int64,    // sum of Drive.DurationS
//	  "drives_energy_used_wh": float64, // sum of *Drive.EnergyUsedWh (nil-skip)
//	  "drives_regen_energy_wh": float64,
//	  "charges_count":        int,
//	  "charges_energy_added_wh": float64, // sum of *ChargingSession.TotalEnergyAddedWh
//	}
//
// All fields are SI canonical. The frontend's useUnits() / useFormatting()
// converts to the user's preferred units at the display boundary.

package yir

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// queryYearInReviewContextInput is the typed input shape for the
// tool. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
type queryYearInReviewContextInput struct {
	// VehicleID identifies the vehicle whose year we summarise.
	// Required + positive — the AI handler ALWAYS scopes to the
	// caller's own vehicle, so a missing or nonsense ID is a
	// programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// Year selects the calendar year (UTC) to summarise. Bounded
	// to 2010..2100 to mirror the YearReviewHandler's existing
	// validation — a confused LLM that picks year 0 cannot
	// silently produce a meaningless aggregate.
	Year int `json:"year" validate:"required,gte=2010,lte=2100" desc:"Calendar year (UTC) to summarise; 2010..2100."`
}

// queryYearInReviewContext is the read-only tool that aggregates one
// calendar year of drives + charging sessions for a single vehicle.
//
// The dispatcher is allowed to invoke this tool because the
// yir-narration strategy declares it in its Tools() whitelist.
// Other strategies that want the same aggregate must add the name
// to their own Tools() list.
type queryYearInReviewContext struct {
	drives  tools.DriveSource
	charges tools.ChargeSource
}

// Name implements [Tool].
func (t *queryYearInReviewContext) Name() string { return "query_year_in_review_context" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryYearInReviewContext) Description() string {
	return "Return a one-year aggregate (drives + charging sessions) for a vehicle. " +
		"All numeric fields are SI canonical (meters, seconds, watt-hours). " +
		"Use this for annual year-in-review narration; do not iterate by calling this multiple times for the same year."
}

// InputSchema implements [Tool].
func (t *queryYearInReviewContext) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryYearInReviewContextInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryYearInReviewContext) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryYearInReviewContext) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryYearInReviewContext) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryYearInReviewContext) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryYearInReviewContextInput](raw)
}

// Execute implements [Tool]. Two repo round-trips (drives + charges)
// then in-memory aggregation; no SQL is written by this method.
//
// Errors from either repo abort the whole tool — partial aggregates
// would silently mislead the LLM about the year's state.
func (t *queryYearInReviewContext) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryYearInReviewContextInput)
	if t.drives == nil {
		return nil, fmt.Errorf("query_year_in_review_context: no tools.DriveSource wired")
	}
	if t.charges == nil {
		return nil, fmt.Errorf("query_year_in_review_context: no tools.ChargeSource wired")
	}

	yearStart, yearEnd := calendarYearWindowUTC(input.Year)

	// Generous limit for a one-year window. Even a heavy commuter
	// rarely exceeds ~3000 drives/year; 50000 is far above any
	// realistic ceiling so a single repo round-trip suffices.
	// Pagination would distort the aggregate (we'd need to know
	// when to stop) and the year-in-review's value proposition
	// breaks down past the cap anyway — the eval harness's
	// canned-input goldens cover the realistic range.
	const aggregateLimit = 50000

	drives, err := t.drives.GetByVehicle(ctx, input.VehicleID, aggregateLimit, 0, yearStart, yearEnd)
	if err != nil {
		return nil, fmt.Errorf("query_year_in_review_context: load drives: %w", err)
	}
	charges, err := t.charges.GetByVehicle(ctx, input.VehicleID, aggregateLimit, 0, yearStart, yearEnd)
	if err != nil {
		return nil, fmt.Errorf("query_year_in_review_context: load charges: %w", err)
	}

	agg := aggregateYearInReview(drives, charges)
	agg["vehicle_id"] = input.VehicleID
	agg["year"] = input.Year
	agg["year_start_utc"] = yearStart.Format(time.RFC3339)
	agg["year_end_utc"] = yearEnd.Format(time.RFC3339)
	return agg, nil
}

// aggregateYearInReview is a pure helper: given the slices the
// repos returned, compute the deterministic aggregate envelope.
// Extracted so the unit test can call it directly without spinning
// up a fake tools.DriveSource / tools.ChargeSource and so the body of Execute
// stays focused on IO + error wrapping.
//
// Mirrors aggregateWeeklyDigest's shape so a future shared aggregator
// can be factored out without breaking either tool's golden output.
func aggregateYearInReview(drives []*drivemodel.Drive, charges []*chargingmodel.ChargingSession) map[string]any {
	var (
		drivesCount                  int
		distM, energyUsedWh, regenWh float64
		durS                         int64
	)
	for _, d := range drives {
		if d == nil {
			continue
		}
		drivesCount++
		distM += d.DistanceM
		durS += d.DurationS
		if d.EnergyUsedWh != nil {
			energyUsedWh += *d.EnergyUsedWh
		}
		if d.RegenEnergyWh != nil {
			regenWh += *d.RegenEnergyWh
		}
	}

	var (
		chargesCount int
		chargedWh    float64
	)
	for _, c := range charges {
		if c == nil {
			continue
		}
		chargesCount++
		if c.TotalEnergyAddedWh != nil {
			chargedWh += *c.TotalEnergyAddedWh
		}
	}

	return map[string]any{
		"drives_count":            drivesCount,
		"drives_distance_m":       distM,
		"drives_duration_s":       durS,
		"drives_energy_used_wh":   energyUsedWh,
		"drives_regen_energy_wh":  regenWh,
		"charges_count":           chargesCount,
		"charges_energy_added_wh": chargedWh,
	}
}

// calendarYearWindowUTC returns the [start, end) window for the
// calendar year `year` in UTC. The end is exclusive — exactly Jan 1
// of the following year — so range queries on a half-open interval
// match the tool's contract one-to-one and align with the existing
// YearReviewHandler's window arithmetic.
func calendarYearWindowUTC(year int) (start, end time.Time) {
	start = time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end = time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC)
	return start, end
}

// YearReviewSources bundles the narrow read interfaces
// RegisterYearReviewTools needs. Mirrors [DigestSources] but exposes
// only the surfaces the year-in-review tool actually consumes.
//
// Production wiring (router.go) reuses the same DriveRepo /
// ChargingRepo instances passed to [Register12Builtins] +
// [RegisterDigestTools]; tests substitute deterministic fakes
// per-source.
type YearReviewSources struct {
	Drives  tools.DriveSource
	Charges tools.ChargeSource
}

// RegisterYearReviewTools installs the year-in-review narration tools
// on r. Called from router.go AFTER Register12Builtins +
// RegisterDigestTools so the registry's alphabetical Names list ends
// with `query_year_in_review_context` without disturbing the
// BuiltinNames pin test or the digest-tool registration.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterYearReviewTools(r *tools.Registry, s YearReviewSources) {
	r.Register(&queryYearInReviewContext{drives: s.Drives, charges: s.Charges})
}
