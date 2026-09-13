package comfort

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Config is the per-vehicle comfort autopilot configuration.
type Config struct {
	VehicleID   int64     `json:"vehicle_id"`
	Enabled     bool      `json:"enabled"`
	TargetTempC float64   `json:"target_temp_c"`
	LeadMinutes int       `json:"lead_minutes"`
	ICSURL      string    `json:"ics_url"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Run is one preconditioning run (also the idempotency record).
type Run struct {
	ID         int64     `json:"id"`
	VehicleID  int64     `json:"vehicle_id"`
	EventUID   string    `json:"event_uid"`
	EventTitle string    `json:"event_title"`
	StartsAt   time.Time `json:"starts_at"`
	ActedAt    time.Time `json:"acted_at"`
}

// Store persists comfort config + runs. Panics on nil db (fail-fast
// wiring). Safe for concurrent use (pgx pool).
type Store struct {
	db *database.DB
}

// NewStore wires the store.
func NewStore(db *database.DB) *Store {
	if db == nil {
		panic("comfort: nil db")
	}
	return &Store{db: db}
}

// DefaultConfig returns the disabled config for a vehicle.
func DefaultConfig(vehicleID int64) *Config {
	return &Config{VehicleID: vehicleID, TargetTempC: 21, LeadMinutes: 20}
}

// GetConfig returns the stored config, or a disabled default when the
// vehicle was never configured.
func (s *Store) GetConfig(ctx context.Context, vehicleID int64) (*Config, error) {
	c := &Config{}
	err := s.db.Pool.QueryRow(ctx,
		`SELECT vehicle_id, enabled, target_temp_c, lead_minutes, ics_url, updated_at
		 FROM comfort_config WHERE vehicle_id = $1`, vehicleID,
	).Scan(&c.VehicleID, &c.Enabled, &c.TargetTempC, &c.LeadMinutes, &c.ICSURL, &c.UpdatedAt)
	if err == pgx.ErrNoRows {
		return DefaultConfig(vehicleID), nil
	}
	if err != nil {
		return nil, fmt.Errorf("comfort: get config: %w", err)
	}
	return c, nil
}

// UpsertConfig inserts or replaces the vehicle config.
func (s *Store) UpsertConfig(ctx context.Context, c *Config) error {
	_, err := s.db.Pool.Exec(ctx, `
		INSERT INTO comfort_config (vehicle_id, enabled, target_temp_c, lead_minutes, ics_url, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (vehicle_id) DO UPDATE SET
			enabled = EXCLUDED.enabled, target_temp_c = EXCLUDED.target_temp_c,
			lead_minutes = EXCLUDED.lead_minutes, ics_url = EXCLUDED.ics_url,
			updated_at = now()`,
		c.VehicleID, c.Enabled, c.TargetTempC, c.LeadMinutes, c.ICSURL,
	)
	if err != nil {
		return fmt.Errorf("comfort: upsert config: %w", err)
	}
	return nil
}

// EnabledConfigs returns every enabled config for the evaluator.
func (s *Store) EnabledConfigs(ctx context.Context) ([]*Config, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT vehicle_id, enabled, target_temp_c, lead_minutes, ics_url, updated_at
		 FROM comfort_config WHERE enabled`)
	if err != nil {
		return nil, fmt.Errorf("comfort: list enabled: %w", err)
	}
	defer rows.Close()
	var out []*Config
	for rows.Next() {
		c := &Config{}
		if err := rows.Scan(&c.VehicleID, &c.Enabled, &c.TargetTempC, &c.LeadMinutes, &c.ICSURL, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("comfort: scan enabled: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("comfort: list enabled: %w", err)
	}
	return out, nil
}

// HasRun reports whether the event UID was already acted on.
func (s *Store) HasRun(ctx context.Context, vehicleID int64, uid string) (bool, error) {
	var exists bool
	err := s.db.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM comfort_runs WHERE vehicle_id = $1 AND event_uid = $2)`,
		vehicleID, uid,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("comfort: has run: %w", err)
	}
	return exists, nil
}

// LogRun records a run. The (vehicle_id, event_uid) unique constraint
// makes double-act a no-op returning ran=false.
func (s *Store) LogRun(ctx context.Context, r *Run) (ran bool, err error) {
	err = s.db.Pool.QueryRow(ctx, `
		INSERT INTO comfort_runs (vehicle_id, event_uid, event_title, starts_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (vehicle_id, event_uid) DO NOTHING
		RETURNING id, acted_at`,
		r.VehicleID, r.EventUID, r.EventTitle, r.StartsAt,
	).Scan(&r.ID, &r.ActedAt)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("comfort: log run: %w", err)
	}
	return true, nil
}

// ListRuns returns recent runs, newest first. Limit clamped 1..100.
func (s *Store) ListRuns(ctx context.Context, vehicleID int64, limit int) ([]*Run, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, vehicle_id, event_uid, event_title, starts_at, acted_at
		FROM comfort_runs WHERE vehicle_id = $1
		ORDER BY id DESC LIMIT $2`, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("comfort: list runs: %w", err)
	}
	defer rows.Close()
	out := []*Run{}
	for rows.Next() {
		r := &Run{}
		if err := rows.Scan(&r.ID, &r.VehicleID, &r.EventUID, &r.EventTitle, &r.StartsAt, &r.ActedAt); err != nil {
			return nil, fmt.Errorf("comfort: scan run: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("comfort: list runs: %w", err)
	}
	return out, nil
}
