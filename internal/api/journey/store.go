package journey

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ErrConflict signals a lost status-transition race: the session moved
// since it was read.
var ErrConflict = errors.New("journey: session moved concurrently")

// ErrNoSession signals a plan save against a missing session.
var ErrNoSession = errors.New("journey: session not found")

// Session is one planned-or-live trip.
type Session struct {
	ID          int64      `json:"id"`
	VehicleID   int64      `json:"vehicle_id"`
	Name        string     `json:"name"`
	OriginName  string     `json:"origin_name"`
	OriginLat   *float64   `json:"origin_lat"`
	OriginLng   *float64   `json:"origin_lng"`
	DestName    string     `json:"dest_name"`
	DestLat     *float64   `json:"dest_lat"`
	DestLng     *float64   `json:"dest_lng"`
	Status      string     `json:"status"`
	PlanVersion int        `json:"plan_version"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	StartedAt   *time.Time `json:"started_at"`
	EndedAt     *time.Time `json:"ended_at"`
}

// PlanVersion is one versioned plan snapshot for a session.
type PlanVersion struct {
	ID        int64           `json:"id"`
	SessionID int64           `json:"session_id"`
	Version   int             `json:"version"`
	Plan      json.RawMessage `json:"plan"`
	Note      string          `json:"note"`
	CreatedAt time.Time       `json:"created_at"`
}

// NewSession carries the create-session fields.
type NewSession struct {
	VehicleID  int64
	Name       string
	OriginName string
	OriginLat  *float64
	OriginLng  *float64
	DestName   string
	DestLat    *float64
	DestLng    *float64
}

// Store persists journey sessions + plan versions. Panics on nil db
// (fail-fast wiring). Safe for concurrent use (pgx pool).
type Store struct {
	db *database.DB
}

// NewStore wires the store.
func NewStore(db *database.DB) *Store {
	if db == nil {
		panic("journey: nil db")
	}
	return &Store{db: db}
}

const sessionColumns = `id, vehicle_id, name, origin_name, origin_lat, origin_lng,
	dest_name, dest_lat, dest_lng, status, plan_version,
	created_at, updated_at, started_at, ended_at`

func scanSession(row pgx.Row) (*Session, error) {
	s := &Session{}
	if err := row.Scan(
		&s.ID, &s.VehicleID, &s.Name, &s.OriginName, &s.OriginLat, &s.OriginLng,
		&s.DestName, &s.DestLat, &s.DestLng, &s.Status, &s.PlanVersion,
		&s.CreatedAt, &s.UpdatedAt, &s.StartedAt, &s.EndedAt,
	); err != nil {
		return nil, err
	}
	return s, nil
}

// Create inserts a planned session.
func (s *Store) Create(ctx context.Context, in NewSession) (*Session, error) {
	session, err := scanSession(s.db.Pool.QueryRow(ctx, `
		INSERT INTO journey_sessions
			(vehicle_id, name, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+sessionColumns,
		in.VehicleID, in.Name, in.OriginName, in.OriginLat, in.OriginLng,
		in.DestName, in.DestLat, in.DestLng,
	))
	if err != nil {
		return nil, fmt.Errorf("journey: create session: %w", err)
	}
	return session, nil
}

// Get returns one session by id, or nil when missing.
func (s *Store) Get(ctx context.Context, id int64) (*Session, error) {
	session, err := scanSession(s.db.Pool.QueryRow(ctx,
		`SELECT `+sessionColumns+` FROM journey_sessions WHERE id = $1`, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journey: get session: %w", err)
	}
	return session, nil
}

// List returns sessions for a vehicle, newest first. Empty status lists
// all. Limit clamped 1..100.
func (s *Store) List(ctx context.Context, vehicleID int64, status string, limit int) ([]*Session, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT `+sessionColumns+` FROM journey_sessions
		WHERE vehicle_id = $1 AND ($2 = '' OR status = $2)
		ORDER BY updated_at DESC LIMIT $3`, vehicleID, status, limit)
	if err != nil {
		return nil, fmt.Errorf("journey: list sessions: %w", err)
	}
	defer rows.Close()
	out := []*Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("journey: scan session: %w", err)
		}
		out = append(out, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("journey: list sessions: %w", err)
	}
	return out, nil
}

// ActiveForVehicle returns the vehicle's active session, if any. At most
// one session per vehicle may be active; starting a second is rejected.
func (s *Store) ActiveForVehicle(ctx context.Context, vehicleID int64) (*Session, error) {
	session, err := scanSession(s.db.Pool.QueryRow(ctx, `
		SELECT `+sessionColumns+` FROM journey_sessions
		WHERE vehicle_id = $1 AND status = 'active' LIMIT 1`, vehicleID))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journey: active session: %w", err)
	}
	return session, nil
}

// SetStatus moves a session to to, stamping started/ended times. The
// conditional update makes concurrent transitions safe: a lost race
// reports ErrConflict instead of silently overwriting.
func (s *Store) SetStatus(ctx context.Context, id int64, from, to string) (*Session, error) {
	if err := Transition(from, to); err != nil {
		return nil, err
	}
	session, err := scanSession(s.db.Pool.QueryRow(ctx, `
		UPDATE journey_sessions SET
			status = $2,
			updated_at = now(),
			started_at = CASE WHEN $2 = 'active' AND started_at IS NULL THEN now() ELSE started_at END,
			ended_at = CASE WHEN $2 IN ('completed', 'aborted') THEN now() ELSE NULL END
		WHERE id = $1 AND status = $3
		RETURNING `+sessionColumns, id, to, from))
	if err == pgx.ErrNoRows {
		return nil, ErrConflict
	}
	if err != nil {
		return nil, fmt.Errorf("journey: set status: %w", err)
	}
	return session, nil
}

// SavePlan appends the next plan version and advances the session's
// plan_version pointer atomically.
func (s *Store) SavePlan(ctx context.Context, sessionID int64, plan json.RawMessage, note string) (*PlanVersion, error) {
	if len(plan) == 0 {
		plan = json.RawMessage(`{}`)
	}
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("journey: save plan: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback on success is a no-op
	var version int
	if err := tx.QueryRow(ctx, `
		UPDATE journey_sessions SET plan_version = plan_version + 1, updated_at = now()
		WHERE id = $1 RETURNING plan_version`, sessionID).Scan(&version); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNoSession
		}
		return nil, fmt.Errorf("journey: save plan: %w", err)
	}
	pv := &PlanVersion{}
	if err := tx.QueryRow(ctx, `
		INSERT INTO journey_plan_versions (session_id, version, plan, note)
		VALUES ($1, $2, $3, $4)
		RETURNING id, session_id, version, plan, note, created_at`,
		sessionID, version, string(plan), note,
	).Scan(&pv.ID, &pv.SessionID, &pv.Version, &pv.Plan, &pv.Note, &pv.CreatedAt); err != nil {
		return nil, fmt.Errorf("journey: save plan: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("journey: save plan: %w", err)
	}
	return pv, nil
}

// ListPlans returns a session's plan versions, newest first.
func (s *Store) ListPlans(ctx context.Context, sessionID int64) ([]*PlanVersion, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, session_id, version, plan, note, created_at
		FROM journey_plan_versions WHERE session_id = $1
		ORDER BY version DESC`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("journey: list plans: %w", err)
	}
	defer rows.Close()
	out := []*PlanVersion{}
	for rows.Next() {
		pv := &PlanVersion{}
		if err := rows.Scan(&pv.ID, &pv.SessionID, &pv.Version, &pv.Plan, &pv.Note, &pv.CreatedAt); err != nil {
			return nil, fmt.Errorf("journey: scan plan: %w", err)
		}
		out = append(out, pv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("journey: list plans: %w", err)
	}
	return out, nil
}
