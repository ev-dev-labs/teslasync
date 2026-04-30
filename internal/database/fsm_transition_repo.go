package database

import (
	"context"
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
	ID        int64     `json:"id"`
	VehicleID int64     `json:"vehicle_id"`
	FSMType   string    `json:"fsm_type"`
	FromState string    `json:"from_state"`
	ToState   string    `json:"to_state"`
	Trigger   string    `json:"trigger"`
	CreatedAt time.Time `json:"created_at"`
}

// Insert logs a single FSM transition.
func (r *FSMTransitionRepo) Insert(ctx context.Context, vehicleID int64, fsmType string, instanceID *int64,
	fromState, toState, trigger, guard, mode string, snapshot map[string]interface{}, durationMs int64) error {

	if fsmType == "" {
		fsmType = "vehicle"
	}
	_, err := r.db.Pool.Exec(ctx,
		`INSERT INTO fsm_transitions (vehicle_id, fsm_type, from_state, to_state, trigger)
		 VALUES ($1, $2, $3, $4, $5)`,
		vehicleID, fsmType, fromState, toState, trigger)
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

	// Build WHERE clause with optional fsm_type filter
	whereType := ""
	args := []interface{}{vehicleID, from, to}
	if fsmType != "" && fsmType != "all" {
		whereType = " AND fsm_type = $4"
		args = append(args, fsmType)
	}

	// Count
	var total int64
	countSQL := `SELECT COUNT(*) FROM fsm_transitions WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3` + whereType
	if err := r.db.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Fetch
	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	fetchSQL := `SELECT id, vehicle_id, COALESCE(fsm_type, 'vehicle'), from_state, to_state, COALESCE(trigger, ''), ts
		 FROM fsm_transitions WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3` + whereType +
		` ORDER BY ts DESC LIMIT $` + itoa(limitIdx) + ` OFFSET $` + itoa(offsetIdx)
	fetchArgs := append(args, limit, offset)

	rows, err := r.db.Pool.Query(ctx, fetchSQL, fetchArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	records := make([]FSMTransitionRecord, 0)
	for rows.Next() {
		var rec FSMTransitionRecord
		if err := rows.Scan(&rec.ID, &rec.VehicleID, &rec.FSMType, &rec.FromState, &rec.ToState,
			&rec.Trigger, &rec.CreatedAt); err != nil {
			return nil, 0, err
		}
		records = append(records, rec)
	}
	return records, total, rows.Err()
}
