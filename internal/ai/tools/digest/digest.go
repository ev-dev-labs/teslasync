// This file exposes one read-only tool: `query_weekly_digest_context`.
// The tool is the single F4 surface the digest-narration strategy is
// allowed to call (see internal/ai/strategies/digest-narration/strategy.go's
// allowedTools whitelist).
//
// Design constraints:
//
//   - "thin Tool wrapper over an existing handler. **No new SQL written.**"
//     We compose the existing tools.DriveSource.GetByVehicle and
//     tools.ChargeSource.GetByVehicle methods that already back
//     query_drives_recent / query_charges_recent.
//
//   - The tool is a READ — Mutates() returns false. The dispatcher's
//     deny-all confirm gate refuses anything mutating; this tool
//     provides no mutating tools.
//
//   - One tool, multiple strategies: the tool is registered on the
//     process-wide tools.Registry alongside the 12 builtins so a
//     future strategy that wants weekly aggregates can declare it
//     too. The dispatcher's per-strategy whitelist still gates which
//     strategies can call it.
//
// The tool's output is a deterministic aggregate envelope:
//
//	{
//	  "vehicle_id": int64,
//	  "week_start_utc": "RFC3339",
//	  "week_end_utc":   "RFC3339",
//	  "drives_count":   int,
//	  "drives_distance_m":   float64,  // sum of Drive.DistanceM
//	  "drives_duration_s":   int64,    // sum of Drive.DurationS
//	  "drives_energy_used_wh": float64, // sum of *Drive.EnergyUsedWh (skips nil)
//	  "drives_regen_energy_wh": float64,
//	  "charges_count":  int,
//	  "charges_energy_added_wh": float64, // sum of *ChargingSession.TotalEnergyAddedWh
//	}
//
// All fields are SI canonical. The frontend's
// useUnits()/useFormatting() at the display boundary converts to
// the user's preferred units before rendering.

package digest

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// queryWeeklyDigestContextInput is the typed input shape for the
// tool. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
type queryWeeklyDigestContextInput struct {
	// VehicleID identifies the vehicle whose week we summarise.
	// Required + positive — the AI handler ALWAYS scopes to the
	// caller's own vehicle, so a missing or nonsense ID is a
	// programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// WeekOffsetWeeks selects which week to summarise. 0 ⇒ the
	// current ISO week (Mon-00:00 → next Mon-00:00 UTC); -1 ⇒ the
	// previous week; etc. Bounded so a confused LLM cannot point
	// at year-old data and mislead the user about "this week".
	WeekOffsetWeeks int `json:"week_offset_weeks" validate:"gte=-12,lte=0" desc:"Week to summarise: 0 = current ISO week, -1 = previous week, … minimum -12."`
}

// queryWeeklyDigestContext is the read-only tool that aggregates one
// week of drives + charging sessions for a single vehicle.
//
// The dispatcher is allowed to invoke this tool because the
// digest-narration strategy declares it in its Tools() whitelist.
// Other strategies that want the same aggregate must add the name
// to their own Tools() list.
type queryWeeklyDigestContext struct {
	drives  tools.DriveSource
	charges tools.ChargeSource
}

func (t *queryWeeklyDigestContext) Name() string { return "query_weekly_digest_context" }

func (t *queryWeeklyDigestContext) Description() string {
	return "Return a one-week aggregate (drives + charging sessions) for a vehicle. " +
		"All numeric fields are SI canonical (meters, seconds, watt-hours). " +
		"Use this for weekly digest narration; do not iterate by calling this multiple times for the same week."
}

func (t *queryWeeklyDigestContext) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryWeeklyDigestContextInput{})
}

func (t *queryWeeklyDigestContext) OutputSchema() json.RawMessage { return nil }

func (t *queryWeeklyDigestContext) Mutates() bool { return false }

func (t *queryWeeklyDigestContext) RequiredScope() string { return "" }

func (t *queryWeeklyDigestContext) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryWeeklyDigestContextInput](raw)
}

// Execute performs the repo reads and then aggregates in memory.
//
// Errors from either repo abort the whole tool — partial aggregates
// would silently mislead the LLM about the week's state.
func (t *queryWeeklyDigestContext) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryWeeklyDigestContextInput)
	if t.drives == nil {
		return nil, fmt.Errorf("query_weekly_digest_context: no tools.DriveSource wired")
	}
	if t.charges == nil {
		return nil, fmt.Errorf("query_weekly_digest_context: no tools.ChargeSource wired")
	}

	weekStart, weekEnd := isoWeekWindowUTC(time.Now().UTC(), input.WeekOffsetWeeks)

	// Generous limit (1000) for one week — far above any realistic
	// week of drives. Pagination is unnecessary for a one-week
	// aggregate; if a user genuinely had >1000 drives in a week,
	// the digest's value proposition (a friendly recap) breaks
	// down anyway and the eval harness's golden cap (10) is the
	// right place to surface that.
	const aggregateLimit = 1000

	drives, err := t.drives.GetByVehicle(ctx, input.VehicleID, aggregateLimit, 0, weekStart, weekEnd)
	if err != nil {
		return nil, fmt.Errorf("query_weekly_digest_context: load drives: %w", err)
	}
	charges, err := t.charges.GetByVehicle(ctx, input.VehicleID, aggregateLimit, 0, weekStart, weekEnd)
	if err != nil {
		return nil, fmt.Errorf("query_weekly_digest_context: load charges: %w", err)
	}

	agg := aggregateWeeklyDigest(drives, charges)
	agg["vehicle_id"] = input.VehicleID
	agg["week_start_utc"] = weekStart.Format(time.RFC3339)
	agg["week_end_utc"] = weekEnd.Format(time.RFC3339)
	return agg, nil
}

// aggregateWeeklyDigest is a pure helper: given the repo results,
// Extracted so the unit test can call it directly without spinning
// up a fake tools.DriveSource / tools.ChargeSource and so the body of Execute
// stays focused on IO + error wrapping.
func aggregateWeeklyDigest(drives []*drivemodel.Drive, charges []*chargingmodel.ChargingSession) map[string]any {
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

// isoWeekWindowUTC returns the [start, end) window for the ISO week
// that contains `now` shifted by `offsetWeeks` (0 = the week of
// `now`, -1 = previous week).
//
// ISO weeks start Monday 00:00 UTC. The end is exclusive — exactly
// 7 days after the start — so range queries on a half-open interval
// match the tool's contract one-to-one.
func isoWeekWindowUTC(now time.Time, offsetWeeks int) (start, end time.Time) {
	now = now.UTC()
	// time.Weekday: Sunday=0, Monday=1, ... — convert to "days
	// since Monday" so Monday becomes 0.
	daysSinceMonday := (int(now.Weekday()) + 6) % 7
	startOfThisWeek := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, -daysSinceMonday)
	start = startOfThisWeek.AddDate(0, 0, offsetWeeks*7)
	end = start.AddDate(0, 0, 7)
	return start, end
}

// DigestSources bundles the narrow read interfaces RegisterDigestTools
// needs. Mirrors [Sources] but exposes only the surfaces the digest
// tool actually consumes — keeping the call-site explicit about
// which repos this feature depends on.
//
// Production wiring (router.go) reuses the same DriveRepo /
// ChargingRepo instances passed to [Register12Builtins]; tests
// substitute deterministic fakes per-source.
type DigestSources struct {
	Drives  tools.DriveSource
	Charges tools.ChargeSource
}

// RegisterDigestTools installs the digest-narration tools on
// r. Called from router.go AFTER Register12Builtins so the registry's
// alphabetical Names list ends with `query_weekly_digest_context`
// without disturbing the BuiltinNames pin test.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterDigestTools(r *tools.Registry, s DigestSources) {
	r.Register(&queryWeeklyDigestContext{drives: s.Drives, charges: s.Charges})
}
