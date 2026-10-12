package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type vehicleRepository struct {
	pool pgxPool
}

func NewVehicleRepository(pool *pgxpool.Pool) repository.VehicleRepository {
	return &vehicleRepository{pool: pool}
}

func (r *vehicleRepository) GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error) {
	return r.scanOne(ctx, r.pool, queries.GetVehicleByID, id)
}

func (r *vehicleRepository) GetByVIN(ctx context.Context, vin string) (*vehicle.Vehicle, error) {
	return r.scanOne(ctx, r.pool, queries.GetVehicleByVIN, vin)
}

func (r *vehicleRepository) GetAll(ctx context.Context) ([]vehicle.Vehicle, error) {
	rows, err := r.pool.Query(ctx, queries.GetAllVehicles)
	if err != nil {
		return nil, fmt.Errorf("querying fleet vehicles: %w", err)
	}
	vehicles, err := pgx.CollectRows(rows, pgx.RowToStructByName[vehicle.Vehicle])
	if err != nil {
		return nil, fmt.Errorf("collecting fleet vehicles: %w", err)
	}
	return vehicles, nil
}

func (r *vehicleRepository) GetByIDForUpdate(ctx context.Context, id string) (*vehicle.Vehicle, error) {
	return r.scanOne(ctx, r.pool, queries.GetVehicleByIDForUpdate, id)
}

func (r *vehicleRepository) Save(ctx context.Context, v *vehicle.Vehicle) error {
	if v == nil || v.TeslaID <= 0 {
		return fmt.Errorf("saving vehicle requires Tesla identity: %w", domain.ErrValidation)
	}
	if v.FSMState != "" || v.SubFSMState != "" || v.OdometerMiles != 0 ||
		v.BatteryLevel != 0 || v.RangeMiles != 0 || v.IsCharging ||
		v.Latitude != 0 || v.Longitude != 0 {
		return fmt.Errorf("vehicle metadata cannot persist lifecycle or live measurements: %w", domain.ErrValidation)
	}
	timezone := v.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	query := queries.UpsertVehicle
	args := []any{v.TeslaID, v.VIN, v.DisplayName, v.Model, v.OptionCodes, v.Color, v.TrimLevel, timezone}
	if v.ID != "" {
		query = queries.UpdateVehicle
		args = []any{v.ID, v.TeslaID, v.VIN, v.DisplayName, v.Model, v.OptionCodes, v.Color, v.TrimLevel, v.ArchivedAt, timezone}
	}
	err := r.pool.QueryRow(ctx, query, args...).Scan(&v.ID, &v.EnrolledAt, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("vehicle %s identity: %w", v.ID, domain.ErrNotFound)
		}
		return fmt.Errorf("saving vehicle %s: %w", v.ID, err)
	}
	v.Timezone = timezone
	return nil
}

func (r *vehicleRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, queries.DeleteVehicle, id)
	if err != nil {
		return fmt.Errorf("deleting vehicle %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("vehicle %s: %w", id, domain.ErrNotFound)
	}
	return nil
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (r *vehicleRepository) scanOne(ctx context.Context, q querier, query string, args ...any) (*vehicle.Vehicle, error) {
	var v vehicle.Vehicle
	row := q.QueryRow(ctx, query, args...)
	err := row.Scan(
		&v.ID, &v.TeslaID, &v.VIN, &v.DisplayName, &v.Model, &v.OptionCodes, &v.Color,
		&v.TrimLevel, &v.EnrolledAt, &v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt, &v.Timezone,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("vehicle: %w", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning vehicle: %w", err)
	}
	return &v, nil
}
