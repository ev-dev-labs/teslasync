package database

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// GuardRepo provides data access for guard mode configuration and events.
type GuardRepo struct {
	db *DB
}

func NewGuardRepo(db *DB) *GuardRepo {
	return &GuardRepo{db: db}
}

// ── Config ──────────────────────────────────────────────────────────────

// GetConfig returns the guard config for a vehicle, or nil if none exists.
func (r *GuardRepo) GetConfig(ctx context.Context, vehicleID int64) (*models.GuardConfig, error) {
	cfg := &models.GuardConfig{}
	err := r.db.Pool.QueryRow(ctx,
		`SELECT vehicle_id, enabled, home_geofence_id, sensitivity, auto_panic, created_at, updated_at
		 FROM vehicle_guard_config WHERE vehicle_id = $1`, vehicleID,
	).Scan(&cfg.VehicleID, &cfg.Enabled, &cfg.HomeGeofenceID, &cfg.Sensitivity, &cfg.AutoPanic, &cfg.CreatedAt, &cfg.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// UpsertConfig creates or updates the guard config for a vehicle.
func (r *GuardRepo) UpsertConfig(ctx context.Context, cfg *models.GuardConfig) error {
	now := time.Now().UTC()
	cfg.UpdatedAt = now
	_, err := r.db.Pool.Exec(ctx,
		`INSERT INTO vehicle_guard_config (vehicle_id, enabled, home_geofence_id, sensitivity, auto_panic, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $6)
		 ON CONFLICT (vehicle_id)
		 DO UPDATE SET enabled = $2, home_geofence_id = $3, sensitivity = $4, auto_panic = $5, updated_at = $6`,
		cfg.VehicleID, cfg.Enabled, cfg.HomeGeofenceID, cfg.Sensitivity, cfg.AutoPanic, now,
	)
	if err != nil {
		return err
	}
	cfg.CreatedAt = now
	return nil
}

// ── Events ──────────────────────────────────────────────────────────────

// CreateEvent inserts a new guard event.
func (r *GuardRepo) CreateEvent(ctx context.Context, ev *models.GuardEvent) error {
	detailsJSON, err := json.Marshal(ev.Details)
	if err != nil {
		detailsJSON = []byte("{}")
	}
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO guard_events (vehicle_id, event_type, latitude, longitude, speed, details, notified_channels, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		ev.VehicleID, ev.EventType, ev.Latitude, ev.Longitude, ev.Speed,
		detailsJSON, ev.NotifiedChannels, time.Now().UTC(),
	).Scan(&ev.ID)
}

// ListEvents returns guard events for a vehicle, newest first.
func (r *GuardRepo) ListEvents(ctx context.Context, vehicleID int64, limit, offset int) ([]*models.GuardEvent, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, vehicle_id, event_type, latitude, longitude, speed, details, notified_channels,
		        acknowledged, acknowledged_at, created_at
		 FROM guard_events WHERE vehicle_id = $1
		 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		vehicleID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*models.GuardEvent
	for rows.Next() {
		ev := &models.GuardEvent{}
		var detailsJSON []byte
		if err := rows.Scan(
			&ev.ID, &ev.VehicleID, &ev.EventType, &ev.Latitude, &ev.Longitude,
			&ev.Speed, &detailsJSON, &ev.NotifiedChannels,
			&ev.Acknowledged, &ev.AcknowledgedAt, &ev.CreatedAt,
		); err != nil {
			return nil, err
		}
		if detailsJSON != nil {
			_ = json.Unmarshal(detailsJSON, &ev.Details)
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// AcknowledgeEvent marks a guard event as acknowledged, scoped to vehicle for safety.
func (r *GuardRepo) AcknowledgeEvent(ctx context.Context, vehicleID, eventID int64) error {
	tag, err := r.db.Pool.Exec(ctx,
		`UPDATE guard_events SET acknowledged = TRUE, acknowledged_at = $1
		 WHERE id = $2 AND vehicle_id = $3 AND acknowledged = FALSE`,
		time.Now().UTC(), eventID, vehicleID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
