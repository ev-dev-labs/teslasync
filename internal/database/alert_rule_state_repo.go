package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AlertRuleState is one row of the per-(rule, vehicle) firing state that
// the streaming alert engine persists across pod restarts. See
// migration 000193_alert_rule_state.up.sql for the canonical schema and
// internal/api/rule_engine.go for the read/write semantics.
type AlertRuleState struct {
	RuleID              int64
	VehicleID           int64
	LatchedAt           *time.Time
	LastFiredAt         *time.Time
	FireCountSinceReset int
	UpdatedAt           time.Time
}

// AlertRuleStateRepo persists per-(rule, vehicle) alert latch/fire state
// in the alert_rule_state table introduced by migration 000193.
type AlertRuleStateRepo struct {
	db *DB
}

// NewAlertRuleStateRepo constructs a new repo bound to the given pool.
func NewAlertRuleStateRepo(db *DB) *AlertRuleStateRepo {
	return &AlertRuleStateRepo{db: db}
}

// alertRuleStateColumns is the canonical SELECT column list, kept in sync
// with scanAlertRuleState below.
const alertRuleStateColumns = `rule_id, vehicle_id, latched_at, last_fired_at, fire_count_since_reset, updated_at`

func scanAlertRuleState(row interface{ Scan(dest ...any) error }, s *AlertRuleState) error {
	return row.Scan(
		&s.RuleID, &s.VehicleID, &s.LatchedAt, &s.LastFiredAt,
		&s.FireCountSinceReset, &s.UpdatedAt,
	)
}

// alertRuleStateLoadAllSQL hydrates every (rule, vehicle) row at engine
// boot. Bounded by alert_rules.id LIMIT to keep startup time predictable.
const alertRuleStateLoadAllSQL = `SELECT ` + alertRuleStateColumns + `
	FROM alert_rule_state
	ORDER BY rule_id, vehicle_id
	LIMIT 100000`

// LoadAll returns every persisted state row. Called once at engine boot.
// The 100k LIMIT is informational — alert_rule_state is bounded by
// (#rules × #vehicles), and a deployment with > 100k entries is well
// outside the assumed scale.
func (r *AlertRuleStateRepo) LoadAll(ctx context.Context) ([]*AlertRuleState, error) {
	rows, err := r.db.Pool.Query(ctx, alertRuleStateLoadAllSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*AlertRuleState, 0)
	for rows.Next() {
		s := &AlertRuleState{}
		if err := scanAlertRuleState(rows, s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// alertRuleStateMarkFiredSQL is the race-safe upsert per Risk R1 of the
// Phase-49 / Slice 0002 design. The WHERE clause on ON CONFLICT DO UPDATE
// suppresses concurrent fires of the same once-mode rule across pods.
// The full statement runs atomically and returns AT MOST one row:
//
//   - First-ever fire: INSERT path → row returned with inserted=true.
//   - Same-pair re-fire while NOT latched (repeat-mode, or once-mode
//     after a falling-edge ClearLatch): UPDATE path → row returned with
//     inserted=false. Caller treats both true/false as "fire".
//   - Concurrent second once-mode fire while ALREADY latched: WHERE
//     fails → no row returned → caller suppresses.
//
// The (xmax = 0) trick distinguishes the INSERT path (xmax=0) from the
// UPDATE path (xmax!=0) in a single round trip; we don't currently use
// the distinction at the call site, but it documents the semantic and
// is cheap to keep for future audits.
//
// IMPORTANT: $4 MUST be cast inside both CASE expressions. Without the
// cast, pgx sends $4 as the unknown OID and PostgreSQL infers the CASE
// type as text (the INSERT VALUES branch has no ELSE column anchor;
// the UPDATE SET branch's ELSE references alert_rule_state.latched_at
// but we cast both for symmetry and future-drift protection). Writing
// text into a TIMESTAMPTZ column triggers SQLSTATE 42804 at execution
// time and routes the engine into the in-memory fallback — which then
// silently breaks persistence across pod restarts. Regression test:
// TestAlertRuleStateRepo_MarkFired_Roundtrip in this package.
const alertRuleStateMarkFiredSQL = `
INSERT INTO alert_rule_state (
	rule_id, vehicle_id, latched_at, last_fired_at, fire_count_since_reset, updated_at
) VALUES (
	$1, $2, CASE WHEN $3 THEN $4::timestamptz END, $4, 1, $4
)
ON CONFLICT (rule_id, vehicle_id) DO UPDATE
   SET latched_at             = CASE WHEN $3 THEN $4::timestamptz ELSE alert_rule_state.latched_at END,
       last_fired_at          = $4,
       fire_count_since_reset = alert_rule_state.fire_count_since_reset + 1,
       updated_at             = $4
 WHERE alert_rule_state.latched_at IS NULL
RETURNING (xmax = 0) AS inserted`

// MarkFired records a successful rule fire. Returns:
//
//   - (true, nil)  the fire was recorded (caller should dispatch the alert).
//   - (false, nil) the fire was suppressed by a concurrent latch held by
//     a peer pod (caller MUST NOT dispatch — race lost).
//   - (_, err)     unexpected DB error.
//
// `isOnce` controls whether to set latched_at on this fire. Pass true for
// rules with TriggerMode == "once".
func (r *AlertRuleStateRepo) MarkFired(ctx context.Context, ruleID, vehicleID int64, now time.Time, isOnce bool) (bool, error) {
	row := r.db.Pool.QueryRow(ctx, alertRuleStateMarkFiredSQL, ruleID, vehicleID, isOnce, now)
	var inserted bool
	if err := row.Scan(&inserted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	_ = inserted
	return true, nil
}

// alertRuleStateClearLatchSQL clears latched_at and resets the
// fire-count-since-reset counter. Called on a falling-edge transition.
//
// The WHERE clause skips no-op writes when the row is already cleared,
// which keeps the updated_at timestamp meaningful.
const alertRuleStateClearLatchSQL = `
UPDATE alert_rule_state
   SET latched_at             = NULL,
       fire_count_since_reset = 0,
       updated_at             = $3
 WHERE rule_id    = $1
   AND vehicle_id = $2
   AND (latched_at IS NOT NULL OR fire_count_since_reset > 0)`

// ClearLatch clears the latch and resets fire_count_since_reset for the
// given (rule, vehicle). No-op when there is no row for the pair.
func (r *AlertRuleStateRepo) ClearLatch(ctx context.Context, ruleID, vehicleID int64, now time.Time) error {
	_, err := r.db.Pool.Exec(ctx, alertRuleStateClearLatchSQL, ruleID, vehicleID, now)
	return err
}

// Compile-time guard: *pgxpool.Pool is the production driver behind r.db.Pool.
var _ = (*pgxpool.Pool)(nil)
