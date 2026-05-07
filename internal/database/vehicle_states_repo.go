// Package database — VehicleStatesRepo backs the restored
// /vehicle-states/timeline + /vehicle-states/summary endpoints.
//
// Phase-43a / Prompt 0003. Phase-42 prompt 0077 deleted the legacy
// vehicle_states snapshot table; this repo re-derives the same product
// surface from the fsm_transitions append-only log (mig 000187), filtered
// to fsm_name = 'vehicle' (mirrors the precedent in
// internal/api/sleep_handler.go and internal/service/vehicle_service.go).
//
// Schema reality vs prompt:
//
//	mig 000187 fsm_transitions has columns
//	(id, vehicle_id, ts, fsm_name, from_state, to_state, trigger TEXT, details JSONB).
//
// The prompt's Decision #5 named columns trigger_field/trigger_value that
// do not exist on the table. Per the prompt's escape hatch, this repo
// adapts:
//
//	trigger_field <- trigger
//	trigger_value <- details ->> trigger
//
// (the JSONB lookup at the trigger-key position; e.g. trigger='Gear' and
// details={"Gear":"D",...} yields trigger_value="D"). Returns NULL when
// trigger or details is NULL or the key is absent.
//
// All queries scope to fsm_name='vehicle'. The unified table also holds
// rows for drive_session/charge_session/alert_cooldown/notification/command
// FSMs; including them would inflate state counts.
package database

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VehicleStateTransition is one row in the timeline response. Mirrors the
// frontend StateTransition shape with snake_case JSON tags. trigger and
// trigger_value are nullable (mig 000187 allows NULL trigger; details may
// be NULL or omit the key).
type VehicleStateTransition struct {
	Ts           time.Time `json:"ts"`
	FromState    *string   `json:"from_state"`
	ToState      string    `json:"to_state"`
	TriggerField *string   `json:"trigger_field"`
	TriggerValue *string   `json:"trigger_value"`
}

// VehicleStateSummaryRow is one row in the summary response: total dwell
// time and entry count for a single state, plus its share of the total.
type VehicleStateSummaryRow struct {
	State           string  `json:"state"`
	TotalSeconds    float64 `json:"total_seconds"`
	Percentage      float64 `json:"percentage"`
	TransitionCount int     `json:"transition_count"`
}

// vehicleStatesPool is the minimal pgxpool subset this repo needs.
// Declared locally so tests can supply a fake without dragging in
// pgxmock (the codebase does not vendor pgxmock — see repo memories).
type vehicleStatesPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// VehicleStatesRepo serves vehicle-state timeline + summary derived from
// fsm_transitions. Construct via NewVehicleStatesRepo.
type VehicleStatesRepo struct {
	pool vehicleStatesPool
}

// NewVehicleStatesRepo binds the repo to a pgx pool.
func NewVehicleStatesRepo(pool *pgxpool.Pool) *VehicleStatesRepo {
	if pool == nil {
		// Mirror the snapshot-writer fail-fast precedent — a nil pool
		// at construction is a wiring bug, not a runtime condition.
		panic("database.NewVehicleStatesRepo: pool must not be nil")
	}
	return &VehicleStatesRepo{pool: pool}
}

// timelineSelectSQL is exposed as a package-level constant so the
// SQL-shape test in vehicle_states_repo_test.go can assert column names
// + ORDER BY direction + fsm_name filter without needing a real DB. A
// mistyped column name on the new mig-000187 schema would otherwise only
// surface at runtime in production.
const timelineSelectSQL = `
SELECT
    ts,
    from_state,
    to_state,
    trigger        AS trigger_field,
    details ->> trigger AS trigger_value
FROM fsm_transitions
WHERE vehicle_id = $1
  AND fsm_name = 'vehicle'
  AND ts >= $2
  AND ts <= $3
ORDER BY ts ASC
`

// vehicleExistsSQL probes the vehicles row for a 404-vs-200-empty
// disambiguation. mig 000187 deliberately omits an FK on
// fsm_transitions.vehicle_id, so dangling transition rows for a
// dropped vehicle would otherwise produce 200 with stale data.
const vehicleExistsSQL = `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`

// VehicleExists reports whether a row exists in the vehicles table for
// vehicleID. Used by the handler to return 404 (unknown vehicle) vs 200
// with an empty array (vehicle exists but no transitions yet).
func (r *VehicleStatesRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx, vehicleExistsSQL, vehicleID).Scan(&exists); err != nil {
		return false, fmt.Errorf("vehicle_states: probe vehicle existence: %w", err)
	}
	return exists, nil
}

// Timeline returns vehicle-FSM transitions for vehicleID inside
// [windowStart, windowEnd] in chronological (ASC) order. Both bounds are
// inclusive. Caller must validate windowStart <= windowEnd.
func (r *VehicleStatesRepo) Timeline(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]VehicleStateTransition, error) {
	rows, err := r.pool.Query(ctx, timelineSelectSQL, vehicleID, windowStart, windowEnd)
	if err != nil {
		return nil, fmt.Errorf("vehicle_states: timeline query: %w", err)
	}
	defer rows.Close()

	out := make([]VehicleStateTransition, 0)
	for rows.Next() {
		var t VehicleStateTransition
		if err := rows.Scan(&t.Ts, &t.FromState, &t.ToState, &t.TriggerField, &t.TriggerValue); err != nil {
			return nil, fmt.Errorf("vehicle_states: timeline row scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("vehicle_states: timeline rows iter: %w", err)
	}
	return out, nil
}

// Summary returns the time-in-state breakdown for vehicleID over
// [windowStart, windowEnd]. Implementation: fetch the timeline rows,
// then walk them in Go via computeStateSummary. Splitting the dwell
// algorithm out keeps it pure-Go and unit-testable without a database.
func (r *VehicleStatesRepo) Summary(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]VehicleStateSummaryRow, float64, error) {
	transitions, err := r.Timeline(ctx, vehicleID, windowStart, windowEnd)
	if err != nil {
		return nil, 0, err
	}
	rows, total := computeStateSummary(transitions, windowStart, windowEnd)
	return rows, total, nil
}

// computeStateSummary walks an ASC-ordered slice of vehicle-FSM
// transitions inside [windowStart, windowEnd] and returns the dwell-time
// breakdown per to_state, plus total_seconds.
//
// Algorithm (per locked Decision #6 with safety clamps):
//
//  1. If transitions is empty: return ([], 0). Operator-visible
//     evidence that the vehicle has no recorded vehicle-FSM transitions
//     in the window.
//  2. Prefix dwell. If transitions[0].FromState is non-nil, attribute
//     [windowStart, transitions[0].Ts] to that state. The prefix carries
//     no transition_count entry — the vehicle was already in that state
//     before the window opened. If FromState is NULL (very first
//     transition observed for this vehicle, mig 000187 allows this),
//     skip the prefix; total_seconds becomes "known dwell seconds"
//     rather than "window seconds". This trade-off avoids dominating
//     the percentage view with an "unknown" bucket for newly onboarded
//     vehicles.
//  3. Middle dwells. For each adjacent pair (i, i+1), attribute
//     [transitions[i].Ts, transitions[i+1].Ts] to transitions[i].ToState
//     and bump transition_count for that state.
//  4. Suffix dwell. Attribute [last.Ts, windowEnd] to last.ToState and
//     bump its transition_count.
//  5. Defensive clamps. Negative durations (future timestamps, clock
//     skew, unsorted input) are clamped to zero so they cannot
//     subtract from the total. Negative percentages are impossible
//     under this clamping.
//  6. Compute total_seconds and per-state percentage. Output rows are
//     sorted by total_seconds DESC then state ASC for stable rendering.
func computeStateSummary(transitions []VehicleStateTransition, windowStart, windowEnd time.Time) ([]VehicleStateSummaryRow, float64) {
	if len(transitions) == 0 {
		return []VehicleStateSummaryRow{}, 0
	}

	dwell := map[string]time.Duration{}
	counts := map[string]int{}

	add := func(state string, d time.Duration) {
		if d < 0 {
			d = 0
		}
		dwell[state] += d
	}

	// Prefix.
	first := transitions[0]
	if first.FromState != nil && *first.FromState != "" {
		add(*first.FromState, first.Ts.Sub(windowStart))
	}

	// Middle.
	for i := 0; i < len(transitions)-1; i++ {
		add(transitions[i].ToState, transitions[i+1].Ts.Sub(transitions[i].Ts))
		counts[transitions[i].ToState]++
	}

	// Suffix.
	last := transitions[len(transitions)-1]
	add(last.ToState, windowEnd.Sub(last.Ts))
	counts[last.ToState]++

	// Materialize.
	totalSec := 0.0
	for _, d := range dwell {
		totalSec += d.Seconds()
	}

	out := make([]VehicleStateSummaryRow, 0, len(dwell))
	for state, d := range dwell {
		row := VehicleStateSummaryRow{
			State:           state,
			TotalSeconds:    d.Seconds(),
			TransitionCount: counts[state],
		}
		if totalSec > 0 {
			row.Percentage = (row.TotalSeconds / totalSec) * 100
		}
		out = append(out, row)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].TotalSeconds != out[j].TotalSeconds {
			return out[i].TotalSeconds > out[j].TotalSeconds
		}
		return out[i].State < out[j].State
	})

	return out, totalSec
}
