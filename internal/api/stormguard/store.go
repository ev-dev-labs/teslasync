package stormguard

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Config is the per-vehicle storm-guard arming + home coordinates.
type Config struct {
	VehicleID int64     `json:"vehicle_id"`
	Enabled   bool      `json:"enabled"`
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	TargetSOC int       `json:"target_soc"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Event is one assessment/action log row.
type Event struct {
	ID        int64     `json:"id"`
	VehicleID int64     `json:"vehicle_id"`
	Level     string    `json:"level"`
	Reason    string    `json:"reason"`
	Acted     bool      `json:"acted"`
	CreatedAt time.Time `json:"created_at"`
}

// Store persists storm-guard config + events. Panics on nil db
// (fail-fast wiring). Safe for concurrent use (pgx pool).
type Store struct {
	db *database.DB
}

// NewStore wires the store.
func NewStore(db *database.DB) *Store {
	if db == nil {
		panic("stormguard: nil db")
	}
	return &Store{db: db}
}

// DefaultConfig returns the disarmed config for a vehicle.
func DefaultConfig(vehicleID int64) *Config {
	return &Config{VehicleID: vehicleID, TargetSOC: 90}
}

// GetConfig returns the stored config, or a disarmed default when the
// vehicle was never configured.
func (s *Store) GetConfig(ctx context.Context, vehicleID int64) (*Config, error) {
	c := &Config{}
	err := s.db.Pool.QueryRow(ctx,
		`SELECT vehicle_id, enabled, lat, lng, target_soc, updated_at
		 FROM stormguard_config WHERE vehicle_id = $1`, vehicleID,
	).Scan(&c.VehicleID, &c.Enabled, &c.Lat, &c.Lng, &c.TargetSOC, &c.UpdatedAt)
	if err == pgx.ErrNoRows {
		return DefaultConfig(vehicleID), nil
	}
	if err != nil {
		return nil, fmt.Errorf("stormguard: get config: %w", err)
	}
	return c, nil
}

// UpsertConfig inserts or replaces the vehicle config.
func (s *Store) UpsertConfig(ctx context.Context, c *Config) error {
	_, err := s.db.Pool.Exec(ctx, `
		INSERT INTO stormguard_config (vehicle_id, enabled, lat, lng, target_soc, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (vehicle_id) DO UPDATE SET
			enabled = EXCLUDED.enabled, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
			target_soc = EXCLUDED.target_soc, updated_at = now()`,
		c.VehicleID, c.Enabled, c.Lat, c.Lng, c.TargetSOC,
	)
	if err != nil {
		return fmt.Errorf("stormguard: upsert config: %w", err)
	}
	return nil
}

// ArmedConfigs returns every enabled config for the hourly evaluator.
func (s *Store) ArmedConfigs(ctx context.Context) ([]*Config, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT vehicle_id, enabled, lat, lng, target_soc, updated_at
		 FROM stormguard_config WHERE enabled`)
	if err != nil {
		return nil, fmt.Errorf("stormguard: list armed: %w", err)
	}
	defer rows.Close()
	var out []*Config
	for rows.Next() {
		c := &Config{}
		if err := rows.Scan(&c.VehicleID, &c.Enabled, &c.Lat, &c.Lng, &c.TargetSOC, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("stormguard: scan armed: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stormguard: list armed: %w", err)
	}
	return out, nil
}

// LogEvent appends an assessment/action row.
func (s *Store) LogEvent(ctx context.Context, e *Event) error {
	err := s.db.Pool.QueryRow(ctx, `
		INSERT INTO stormguard_events (vehicle_id, level, reason, acted)
		VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
		e.VehicleID, e.Level, e.Reason, e.Acted,
	).Scan(&e.ID, &e.CreatedAt)
	if err != nil {
		return fmt.Errorf("stormguard: log event: %w", err)
	}
	return nil
}

// LastEventLevel returns the most recent logged level for dedupe (""
// / when none).
func (s *Store) LastEventLevel(ctx context.Context, vehicleID int64) (string, error) {
	var level string
	err := s.db.Pool.QueryRow(ctx,
		`SELECT level FROM stormguard_events
		 WHERE vehicle_id = $1 ORDER BY id DESC LIMIT 1`, vehicleID,
	).Scan(&level)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("stormguard: last level: %w", err)
	}
	return level, nil
}

// ListEvents returns recent events, newest first. Limit clamped 1..100.
func (s *Store) ListEvents(ctx context.Context, vehicleID int64, limit int) ([]*Event, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, vehicle_id, level, reason, acted, created_at
		FROM stormguard_events WHERE vehicle_id = $1
		ORDER BY id DESC LIMIT $2`, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("stormguard: list events: %w", err)
	}
	defer rows.Close()
	out := []*Event{}
	for rows.Next() {
		e := &Event{}
		if err := rows.Scan(&e.ID, &e.VehicleID, &e.Level, &e.Reason, &e.Acted, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("stormguard: scan event: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stormguard: list events: %w", err)
	}
	return out, nil
}
