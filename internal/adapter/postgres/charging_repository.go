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
	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type chargingRepository struct {
	pool pgxPool
}

func NewChargingSessionRepository(pool *pgxpool.Pool) repository.ChargingSessionRepository {
	return &chargingRepository{pool: pool}
}

func (r *chargingRepository) GetByID(ctx context.Context, id string) (*charging.ChargingSession, error) {
	var s charging.ChargingSession
	err := r.pool.QueryRow(ctx, queries.GetChargingSessionByID, id).Scan(
		&s.ID, &s.VehicleID, &s.ChargerType, &s.StartBatteryLevel, &s.EndBatteryLevel,
		&s.EnergyAddedWh, &s.MaxPowerW, &s.CostCents, &s.FSMState, &s.SubFSMState,
		&s.ChargerConnected, &s.StartedAt, &s.CompletedAt, &s.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("charging session %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning charging session %s: %w", id, err)
	}
	return &s, nil
}

func (r *chargingRepository) GetByVehicleID(ctx context.Context, vehicleID string) ([]charging.ChargingSession, error) {
	rows, err := r.pool.Query(ctx, queries.GetChargingSessionsByVehicleID, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("querying charging sessions for vehicle %s: %w", vehicleID, err)
	}
	sessions, err := pgx.CollectRows(rows, pgx.RowToStructByName[charging.ChargingSession])
	if err != nil {
		return nil, fmt.Errorf("collecting charging sessions for vehicle %s: %w", vehicleID, err)
	}
	return sessions, nil
}

func (r *chargingRepository) ListByDateRange(ctx context.Context, vehicleID string, from, to time.Time) ([]charging.ChargingSession, error) {
	rows, err := r.pool.Query(ctx, queries.ListChargingSessionsByDateRange, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("listing charging sessions for vehicle %s: %w", vehicleID, err)
	}
	sessions, err := pgx.CollectRows(rows, pgx.RowToStructByName[charging.ChargingSession])
	if err != nil {
		return nil, fmt.Errorf("collecting charging sessions for vehicle %s: %w", vehicleID, err)
	}
	return sessions, nil
}

func (r *chargingRepository) GetByIDForUpdate(ctx context.Context, id string) (*charging.ChargingSession, error) {
	var s charging.ChargingSession
	err := r.pool.QueryRow(ctx, queries.GetChargingSessionByIDForUpdate, id).Scan(
		&s.ID, &s.VehicleID, &s.ChargerType, &s.StartBatteryLevel, &s.EndBatteryLevel,
		&s.EnergyAddedWh, &s.MaxPowerW, &s.CostCents, &s.FSMState, &s.SubFSMState,
		&s.ChargerConnected, &s.StartedAt, &s.CompletedAt, &s.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("charging session %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning charging session %s: %w", id, err)
	}
	return &s, nil
}

func (r *chargingRepository) Save(ctx context.Context, s *charging.ChargingSession) error {
	_, err := r.pool.Exec(ctx, queries.UpsertChargingSession,
		s.ID, s.VehicleID, s.ChargerType, s.StartBatteryLevel, s.EndBatteryLevel,
		s.EnergyAddedWh, s.MaxPowerW, s.CostCents, s.StartedAt, s.CompletedAt,
	)
	if err != nil {
		return fmt.Errorf("saving charging session %s: %w", s.ID, err)
	}
	return nil
}
