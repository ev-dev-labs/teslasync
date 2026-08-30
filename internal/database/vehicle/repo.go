package vehicle

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/jackc/pgx/v5"
)

// VehicleRepo provides vehicle data access operations.
type VehicleRepo struct {
	db *database.DB
}

func NewVehicleRepo(db *database.DB) *VehicleRepo {
	return &VehicleRepo{db: db}
}

func (r *VehicleRepo) Create(ctx context.Context, v *vehiclemodel.Vehicle) error {
	ctx, span := tracing.DBSpan(ctx, "insert", "vehicles", tracing.VehicleVIN(v.VIN))
	defer span.End()
	tz := v.Timezone
	if tz == "" {
		tz = "UTC"
	}
	query := `
		INSERT INTO vehicles (tesla_id, vin, display_name, model, trim_level, color, timezone, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		RETURNING id`
	now := time.Now().UTC()
	err := r.db.Pool.QueryRow(ctx, query,
		v.TeslaID, v.VIN, v.DisplayName, v.Model, v.TrimLevel, v.Color, tz, now,
	).Scan(&v.ID)
	if err == nil {
		v.Timezone = tz
	}
	tracing.EndSpan(span, err)
	return err
}

func (r *VehicleRepo) GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "vehicles", tracing.VehicleID(id))
	defer span.End()
	query := `SELECT id, tesla_id, vin, display_name, model, trim_level, color, timezone, created_at, updated_at
		FROM vehicles WHERE id = $1`
	v := &vehiclemodel.Vehicle{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&v.ID, &v.TeslaID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimLevel, &v.Color, &v.Timezone, &v.CreatedAt, &v.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	tracing.EndSpan(span, err)
	return v, err
}

func (r *VehicleRepo) GetByVIN(ctx context.Context, vin string) (*vehiclemodel.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "vehicles", tracing.VehicleVIN(vin))
	defer span.End()
	query := `SELECT id, tesla_id, vin, display_name, model, trim_level, color, timezone, created_at, updated_at
		FROM vehicles WHERE vin = $1`
	v := &vehiclemodel.Vehicle{}
	err := r.db.Pool.QueryRow(ctx, query, vin).Scan(
		&v.ID, &v.TeslaID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimLevel, &v.Color, &v.Timezone, &v.CreatedAt, &v.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	tracing.EndSpan(span, err)
	return v, err
}

func (r *VehicleRepo) GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select_all", "vehicles")
	defer span.End()
	query := `SELECT id, tesla_id, vin, display_name, model, trim_level, color, timezone, archived_at, created_at, updated_at
		FROM vehicles ORDER BY id`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vehicles []*vehiclemodel.Vehicle
	for rows.Next() {
		v := &vehiclemodel.Vehicle{}
		if err := rows.Scan(
			&v.ID, &v.TeslaID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimLevel, &v.Color, &v.Timezone, &v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		vehicles = append(vehicles, v)
	}
	return vehicles, rows.Err()
}

// GetPage returns a deterministic page of vehicles for the public list
// endpoint. GetAll remains available to trusted internal fleet-wide workflows
// (analytics, maintenance) that explicitly own their aggregate cost.
func (r *VehicleRepo) GetPage(ctx context.Context, limit, offset int) ([]*vehiclemodel.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select_page", "vehicles")
	defer span.End()
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	const query = `SELECT id, tesla_id, vin, display_name, model, trim_level, color, timezone, archived_at, created_at, updated_at
		FROM vehicles
		ORDER BY id
		LIMIT $1 OFFSET $2`
	rows, err := r.db.Pool.Query(ctx, query, limit, offset)
	if err != nil {
		tracing.EndSpan(span, err)
		return nil, fmt.Errorf("list vehicle page: %w", err)
	}
	defer rows.Close()

	vehicles := make([]*vehiclemodel.Vehicle, 0, limit)
	for rows.Next() {
		v := &vehiclemodel.Vehicle{}
		if err := rows.Scan(
			&v.ID, &v.TeslaID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimLevel, &v.Color, &v.Timezone, &v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			tracing.EndSpan(span, err)
			return nil, fmt.Errorf("scan vehicle page: %w", err)
		}
		vehicles = append(vehicles, v)
	}
	if err := rows.Err(); err != nil {
		tracing.EndSpan(span, err)
		return nil, fmt.Errorf("iterate vehicle page: %w", err)
	}
	return vehicles, nil
}

func (r *VehicleRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM vehicles WHERE id = $1`, id)
	return err
}

// UpdateTimezone persists the IANA timezone reported by Tesla
// (vehicle_state.timezone) for the given vehicle. Called by the worker on
// every successful poll when the value differs from the cached row, so
// the vehicles table converges on the car's actual local time without
// requiring an out-of-band sync (Phase 40 / 22).
func (r *VehicleRepo) UpdateTimezone(ctx context.Context, id int64, tz string) error {
	ctx, span := tracing.DBSpan(ctx, "update", "vehicles", tracing.VehicleID(id))
	defer span.End()
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE vehicles SET timezone = $1, updated_at = NOW() WHERE id = $2`,
		tz, id,
	)
	tracing.EndSpan(span, err)
	return err
}
