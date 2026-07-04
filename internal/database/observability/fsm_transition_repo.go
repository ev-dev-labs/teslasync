package observability

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ErrFSMTransitionRepoUnconfigured is returned by the write/read
// methods when the repo was constructed without a usable pool (nil
// *database.DB or nil pool). Returning an error rather than
// dereferencing a nil pool keeps a mis-wired repo from panicking the
// caller's goroutine.
var ErrFSMTransitionRepoUnconfigured = errors.New("observability: fsm transition repo not configured")

// FSMTransitionRepo handles persistence of FSM transition logs.
//
// Schema (migration 000187_fsm_live):
//
//	fsm_transitions(id, vehicle_id, ts, fsm_name, from_state, to_state,
//	                 trigger, details JSONB)
//
// One row per state transition per FSM per vehicle. The old column
// name `fsm_type` was retired by migration 000187, which dropped and
// recreated the table; the canonical column name is `fsm_name`. There
// is NO compatibility layer — callers pass the canonical name directly.
type FSMTransitionRepo struct {
	exec database.DBTX
}

// NewFSMTransitionRepo creates a new repo. A nil db (or a db with a nil
// pool) yields a repo whose methods return
// ErrFSMTransitionRepoUnconfigured instead of panicking — assigning a
// typed-nil *pgxpool.Pool into the database.DBTX interface would make
// the nil guard unreachable, so the assignment is done only when the
// pool is genuinely present.
func NewFSMTransitionRepo(db *database.DB) *FSMTransitionRepo {
	var exec database.DBTX
	if db != nil && db.Pool != nil {
		exec = db.Pool
	}
	return &FSMTransitionRepo{exec: exec}
}

// FSMTransitionRecord represents a single FSM transition log entry.
type FSMTransitionRecord struct {
	ID        int64                  `json:"id"`
	VehicleID int64                  `json:"vehicle_id"`
	TS        time.Time              `json:"ts"`
	FSMName   string                 `json:"fsm_name"`
	FromState string                 `json:"from_state"`
	ToState   string                 `json:"to_state"`
	Trigger   string                 `json:"trigger"`
	Details   map[string]interface{} `json:"details,omitempty"`
}

// Insert logs a single FSM transition. ts MUST be the wall-clock
// timestamp of the transition (caller-controlled, NOT Now() inside the
// repo) so callers driving from event time (replay, backfill) and
// callers driving from the real clock get identical write semantics.
// details is optional — pass nil for transitions with no structured
// context.
func (r *FSMTransitionRepo) Insert(ctx context.Context,
	vehicleID int64, ts time.Time, fsmName, fromState, toState, trigger string,
	details map[string]interface{}) error {

	if r == nil || r.exec == nil {
		return ErrFSMTransitionRepoUnconfigured
	}
	if fsmName == "" {
		fsmName = "vehicle"
	}
	if ts.IsZero() {
		ts = time.Now()
	}

	var detailsJSON []byte
	if len(details) > 0 {
		var err error
		detailsJSON, err = json.Marshal(details)
		if err != nil {
			return fmt.Errorf("fsm_transitions: marshal details: %w", err)
		}
	}

	_, err := r.exec.Exec(ctx,
		`INSERT INTO fsm_transitions (vehicle_id, ts, fsm_name, from_state, to_state, trigger, details)
		 VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), $7)`,
		vehicleID, ts, fsmName, fromState, toState, trigger, detailsJSON)
	if err != nil {
		return fmt.Errorf("fsm_transitions: insert: %w", err)
	}
	return nil
}

// Query retrieves FSM transitions with filters.
func (r *FSMTransitionRepo) Query(ctx context.Context, vehicleID int64, fsmName string,
	from, to time.Time, limit, offset int) ([]FSMTransitionRecord, int64, error) {

	if r == nil || r.exec == nil {
		return nil, 0, ErrFSMTransitionRepoUnconfigured
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	whereName := ""
	args := []interface{}{vehicleID, from, to}
	if fsmName != "" && fsmName != "all" {
		whereName = " AND fsm_name = $4"
		args = append(args, fsmName)
	}

	var total int64
	countSQL := `SELECT COUNT(*) FROM fsm_transitions WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3` + whereName
	if err := r.exec.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("fsm_transitions: count: %w", err)
	}

	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	fetchSQL := `SELECT id, vehicle_id, ts, fsm_name, COALESCE(from_state, ''), to_state, COALESCE(trigger, ''), details
		 FROM fsm_transitions WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3` + whereName +
		` ORDER BY ts DESC LIMIT $` + strconv.Itoa(limitIdx) + ` OFFSET $` + strconv.Itoa(offsetIdx)
	fetchArgs := append(args, limit, offset)

	rows, err := r.exec.Query(ctx, fetchSQL, fetchArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("fsm_transitions: query: %w", err)
	}
	defer rows.Close()

	records := make([]FSMTransitionRecord, 0)
	for rows.Next() {
		var rec FSMTransitionRecord
		var detailsRaw []byte
		if err := rows.Scan(&rec.ID, &rec.VehicleID, &rec.TS, &rec.FSMName,
			&rec.FromState, &rec.ToState, &rec.Trigger, &detailsRaw); err != nil {
			return nil, 0, fmt.Errorf("fsm_transitions: scan: %w", err)
		}
		if len(detailsRaw) > 0 {
			_ = json.Unmarshal(detailsRaw, &rec.Details)
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("fsm_transitions: rows: %w", err)
	}
	return records, total, nil
}
