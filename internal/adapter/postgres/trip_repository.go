package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type tripRepository struct {
	pool *pgxpool.Pool
}

func NewTripRepository(pool *pgxpool.Pool) repository.TripRepository {
	return &tripRepository{pool: pool}
}

func (r *tripRepository) GetByID(ctx context.Context, id string) (*trip.Trip, error) {
	var t trip.Trip
	err := r.pool.QueryRow(ctx, queries.GetTripByID, id).Scan(
		&t.ID, &t.VehicleID, &t.StartLatitude, &t.StartLongitude, &t.EndLatitude, &t.EndLongitude,
		&t.StartAddress, &t.EndAddress, &t.DistanceM, &t.EnergyUsedWh,
		&t.EfficiencyWhPerM, &t.MaxSpeedMps, &t.FSMState, &t.StartedAt, &t.CompletedAt, &t.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("trip %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning trip %s: %w", id, err)
	}
	return &t, nil
}

func (r *tripRepository) GetByVehicleID(ctx context.Context, vehicleID string) ([]trip.Trip, error) {
	rows, err := r.pool.Query(ctx, queries.GetTripsByVehicleID, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("querying trips for vehicle %s: %w", vehicleID, err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[trip.Trip])
}

func (r *tripRepository) ListByDateRange(ctx context.Context, vehicleID string, from, to time.Time) ([]trip.Trip, error) {
	rows, err := r.pool.Query(ctx, queries.ListTripsByDateRange, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("listing trips for vehicle %s: %w", vehicleID, err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[trip.Trip])
}

func (r *tripRepository) GetByIDForUpdate(ctx context.Context, id string) (*trip.Trip, error) {
	var t trip.Trip
	err := r.pool.QueryRow(ctx, queries.GetTripByIDForUpdate, id).Scan(
		&t.ID, &t.VehicleID, &t.StartLatitude, &t.StartLongitude, &t.EndLatitude, &t.EndLongitude,
		&t.StartAddress, &t.EndAddress, &t.DistanceM, &t.EnergyUsedWh,
		&t.EfficiencyWhPerM, &t.MaxSpeedMps, &t.FSMState, &t.StartedAt, &t.CompletedAt, &t.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("trip %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning trip %s: %w", id, err)
	}
	return &t, nil
}

func (r *tripRepository) Save(ctx context.Context, t *trip.Trip) error {
	_, err := r.pool.Exec(ctx, queries.UpsertTrip,
		t.ID, t.VehicleID, t.StartLatitude, t.StartLongitude, t.EndLatitude, t.EndLongitude,
		t.StartAddress, t.EndAddress, t.DistanceM, t.EnergyUsedWh,
		t.EfficiencyWhPerM, t.MaxSpeedMps, t.FSMState, t.StartedAt, t.CompletedAt, t.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("saving trip %s: %w", t.ID, err)
	}
	return nil
}
