package observability

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

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
	db *database.DB
}

// NewFSMTransitionRepo creates a new repo.
func NewFSMTransitionRepo(db *database.DB) *FSMTransitionRepo {
	return &FSMTransitionRepo{db: db}
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
			return err
		}
	}

	_, err := r.db.Pool.Exec(ctx,
		`INSERT INTO fsm_transitions (vehicle_id, ts, fsm_name, from_state, to_state, trigger, details)
		 VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), $7)`,
		vehicleID, ts, fsmName, fromState, toState, trigger, detailsJSON)
	return err
}

// Query retrieves FSM transitions with filters.
func (r *FSMTransitionRepo) Query(ctx context.Context, vehicleID int64, fsmName string,
	from, to time.Time, limit, offset int) ([]FSMTransitionRecord, int64, error) {

	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	whereName := ""
	args := []interface{}{vehicleID, from, to}
	if fsmName != "" && fsmName != "all" {
		whereName = " AND fsm_name = $4"
		args = append(args, fsmName)
	}

	var total int64
	countSQL := `SELECT COUNT(*) FROM fsm_transitions WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3` + whereName
	if err := r.db.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	fetchSQL := `SELECT id, vehicle_id, ts, fsm_name, COALESCE(from_state, ''), to_state, COALESCE(trigger, ''), details
		 FROM fsm_transitions WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3` + whereName +
		` ORDER BY ts DESC LIMIT $` + strconv.Itoa(limitIdx) + ` OFFSET $` + strconv.Itoa(offsetIdx)
	fetchArgs := append(args, limit, offset)

	rows, err := r.db.Pool.Query(ctx, fetchSQL, fetchArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	records := make([]FSMTransitionRecord, 0)
	for rows.Next() {
		var rec FSMTransitionRecord
		var detailsRaw []byte
		if err := rows.Scan(&rec.ID, &rec.VehicleID, &rec.TS, &rec.FSMName,
			&rec.FromState, &rec.ToState, &rec.Trigger, &detailsRaw); err != nil {
			return nil, 0, err
		}
		if len(detailsRaw) > 0 {
			_ = json.Unmarshal(detailsRaw, &rec.Details)
		}
		records = append(records, rec)
	}
	return records, total, rows.Err()
}
