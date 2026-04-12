package database

import (
	"context"
	"encoding/json"
	"time"
)

// FSMTransitionRepo handles persistence of FSM transition logs.
type FSMTransitionRepo struct {
	db *DB
}

// NewFSMTransitionRepo creates a new repo.
func NewFSMTransitionRepo(db *DB) *FSMTransitionRepo {
	return &FSMTransitionRepo{db: db}
}

// FSMTransitionRecord represents a single FSM transition log entry.
type FSMTransitionRecord struct {
	ID               int64                  `json:"id"`
	VehicleID        int64                  `json:"vehicle_id"`
	FSMType          string                 `json:"fsm_type"`
	FSMInstanceID    *int64                 `json:"fsm_instance_id,omitempty"`
	FromState        string                 `json:"from_state"`
	ToState          string                 `json:"to_state"`
	Trigger          string                 `json:"trigger"`
	Guard            string                 `json:"guard,omitempty"`
	Mode             string                 `json:"mode"`
	ContextSnapshot  map[string]interface{} `json:"context_snapshot,omitempty"`
	DurationInStateMs int64                 `json:"duration_in_state_ms"`
	CreatedAt        time.Time              `json:"created_at"`
}

// Insert logs a single FSM transition.
func (r *FSMTransitionRepo) Insert(ctx context.Context, vehicleID int64, fsmType string, instanceID *int64,
	fromState, toState, trigger, guard, mode string, snapshot map[string]interface{}, durationMs int64) error {

	snapshotJSON, _ := json.Marshal(snapshot)

	_, err := r.db.Pool.Exec(ctx,
		`INSERT INTO fsm_transitions (vehicle_id, fsm_type, fsm_instance_id, from_state, to_state,
		 trigger, guard, mode, context_snapshot, duration_in_state_ms)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		vehicleID, fsmType, instanceID, fromState, toState, trigger, guard, mode, snapshotJSON, durationMs)
	return err
}

// Query retrieves FSM transitions with filters.
func (r *FSMTransitionRepo) Query(ctx context.Context, vehicleID int64, fsmType string,
	instanceID *int64, from, to time.Time, limit, offset int) ([]FSMTransitionRecord, int64, error) {

	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	// Count
	countQuery := `SELECT COUNT(*) FROM fsm_transitions WHERE vehicle_id = $1 AND created_at BETWEEN $2 AND $3`
	args := []interface{}{vehicleID, from, to}
	argIdx := 4

	if fsmType != "" {
		countQuery += ` AND fsm_type = $` + itoa(argIdx)
		args = append(args, fsmType)
		argIdx++
	}
	if instanceID != nil {
		countQuery += ` AND fsm_instance_id = $` + itoa(argIdx)
		args = append(args, *instanceID)
		argIdx++
	}

	var total int64
	if err := r.db.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Fetch
	fetchQuery := `SELECT id, vehicle_id, fsm_type, fsm_instance_id, from_state, to_state,
		trigger, COALESCE(guard, ''), mode, context_snapshot, COALESCE(duration_in_state_ms, 0), created_at
		FROM fsm_transitions WHERE vehicle_id = $1 AND created_at BETWEEN $2 AND $3`
	fetchArgs := []interface{}{vehicleID, from, to}
	fetchIdx := 4

	if fsmType != "" {
		fetchQuery += ` AND fsm_type = $` + itoa(fetchIdx)
		fetchArgs = append(fetchArgs, fsmType)
		fetchIdx++
	}
	if instanceID != nil {
		fetchQuery += ` AND fsm_instance_id = $` + itoa(fetchIdx)
		fetchArgs = append(fetchArgs, *instanceID)
		fetchIdx++
	}

	fetchQuery += ` ORDER BY created_at DESC LIMIT $` + itoa(fetchIdx) + ` OFFSET $` + itoa(fetchIdx+1)
	fetchArgs = append(fetchArgs, limit, offset)

	rows, err := r.db.Pool.Query(ctx, fetchQuery, fetchArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	records := make([]FSMTransitionRecord, 0)
	for rows.Next() {
		var rec FSMTransitionRecord
		var snapshotBytes []byte
		if err := rows.Scan(&rec.ID, &rec.VehicleID, &rec.FSMType, &rec.FSMInstanceID,
			&rec.FromState, &rec.ToState, &rec.Trigger, &rec.Guard, &rec.Mode,
			&snapshotBytes, &rec.DurationInStateMs, &rec.CreatedAt); err != nil {
			return nil, 0, err
		}
		if snapshotBytes != nil {
			_ = json.Unmarshal(snapshotBytes, &rec.ContextSnapshot)
		}
		records = append(records, rec)
	}
	return records, total, rows.Err()
}
