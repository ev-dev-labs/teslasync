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

func (r *vehicleRepository) GetByUserID(ctx context.Context, userID string) ([]vehicle.Vehicle, error) {
	rows, err := r.pool.Query(ctx, queries.GetVehiclesByUserID, userID)
	if err != nil {
		return nil, fmt.Errorf("querying vehicles for user %s: %w", userID, err)
	}
	vehicles, err := pgx.CollectRows(rows, pgx.RowToStructByName[vehicle.Vehicle])
	if err != nil {
		return nil, fmt.Errorf("collecting vehicles for user %s: %w", userID, err)
	}
	return vehicles, nil
}

func (r *vehicleRepository) GetByIDForUpdate(ctx context.Context, id string) (*vehicle.Vehicle, error) {
	return r.scanOne(ctx, r.pool, queries.GetVehicleByIDForUpdate, id)
}

func (r *vehicleRepository) Save(ctx context.Context, v *vehicle.Vehicle) error {
	_, err := r.pool.Exec(ctx, queries.UpsertVehicle,
		v.ID, v.UserID, v.VIN, v.DisplayName, v.Model, v.Year, v.Color,
		v.FSMState, v.SubFSMState, v.OdometerMiles, v.BatteryLevel,
		v.RangeMiles, v.IsCharging, v.Latitude, v.Longitude,
		v.CreatedAt, v.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("saving vehicle %s: %w", v.ID, err)
	}
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
		&v.ID, &v.UserID, &v.VIN, &v.DisplayName, &v.Model, &v.Year, &v.Color,
		&v.FSMState, &v.SubFSMState, &v.OdometerMiles, &v.BatteryLevel,
		&v.RangeMiles, &v.IsCharging, &v.Latitude, &v.Longitude,
		&v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("vehicle: %w", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning vehicle: %w", err)
	}
	return &v, nil
}
