package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// VehicleRepo provides vehicle data access operations.
type VehicleRepo struct {
	db *DB
}

func NewVehicleRepo(db *DB) *VehicleRepo {
	return &VehicleRepo{db: db}
}

func (r *VehicleRepo) Create(ctx context.Context, v *models.Vehicle) error {
	ctx, span := tracing.DBSpan(ctx, "insert", "vehicles", tracing.VehicleVIN(v.VIN))
	defer span.End()
	query := `
		INSERT INTO vehicles (vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, is_gear_capable, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
		RETURNING id`
	now := time.Now().UTC()
	err := r.db.Pool.QueryRow(ctx, query,
		v.VehicleID, v.VIN, v.DisplayName, v.Model, v.TrimBadging,
		v.ExteriorColor, v.WheelType, v.State, v.Healthy, v.IsGearCapable, now,
	).Scan(&v.ID)
	tracing.EndSpan(span, err)
	return err
}

func (r *VehicleRepo) GetByID(ctx context.Context, id int64) (*models.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "vehicles", tracing.VehicleID(id))
	defer span.End()
	query := `SELECT id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, is_gear_capable, created_at, updated_at
		FROM vehicles WHERE id = $1`
	v := &models.Vehicle{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&v.ID, &v.VehicleID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimBadging,
		&v.ExteriorColor, &v.WheelType, &v.State, &v.Healthy, &v.IsGearCapable, &v.CreatedAt, &v.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	tracing.EndSpan(span, err)
	return v, err
}

func (r *VehicleRepo) GetByVIN(ctx context.Context, vin string) (*models.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "vehicles", tracing.VehicleVIN(vin))
	defer span.End()
	query := `SELECT id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, is_gear_capable, created_at, updated_at
		FROM vehicles WHERE vin = $1`
	v := &models.Vehicle{}
	err := r.db.Pool.QueryRow(ctx, query, vin).Scan(
		&v.ID, &v.VehicleID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimBadging,
		&v.ExteriorColor, &v.WheelType, &v.State, &v.Healthy, &v.IsGearCapable, &v.CreatedAt, &v.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	tracing.EndSpan(span, err)
	return v, err
}

func (r *VehicleRepo) GetAll(ctx context.Context) ([]*models.Vehicle, error) {
	ctx, span := tracing.DBSpan(ctx, "select_all", "vehicles")
	defer span.End()
	query := `SELECT id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, is_gear_capable, created_at, updated_at
		FROM vehicles ORDER BY id`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vehicles []*models.Vehicle
	for rows.Next() {
		v := &models.Vehicle{}
		if err := rows.Scan(
			&v.ID, &v.VehicleID, &v.VIN, &v.DisplayName, &v.Model, &v.TrimBadging,
			&v.ExteriorColor, &v.WheelType, &v.State, &v.Healthy, &v.IsGearCapable, &v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		vehicles = append(vehicles, v)
	}
	return vehicles, rows.Err()
}

func (r *VehicleRepo) UpdateState(ctx context.Context, id int64, state string, healthy bool) error {
	query := `UPDATE vehicles SET state = $2, healthy = $3, updated_at = $4 WHERE id = $1`
	_, err := r.db.Pool.Exec(ctx, query, id, state, healthy, time.Now().UTC())
	return err
}

func (r *VehicleRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM vehicles WHERE id = $1`, id)
	return err
}

// SetGearCapable persists whether a vehicle has ever received a Gear signal via Fleet Telemetry.
func (r *VehicleRepo) SetGearCapable(ctx context.Context, id int64, capable bool) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE vehicles SET is_gear_capable = $2, updated_at = $3 WHERE id = $1`,
		id, capable, time.Now().UTC())
	return err
}
