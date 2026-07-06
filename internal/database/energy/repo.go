package energy

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	energymodel "github.com/ev-dev-labs/teslasync/internal/models/energy"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// clampLimit normalises a caller-supplied LIMIT. Any value outside
// (0, max] collapses to def, so a malformed or hostile limit can never
// produce an unbounded scan or a negative bind parameter. Extracted so
// the five list endpoints in this package share one audited rule and it
// can be table-tested without a live database.
func clampLimit(limit, def, max int) int {
	if limit <= 0 || limit > max {
		return def
	}
	return limit
}

// SQL is pinned to package-level constants so the shape (columns, WHERE
// keys, ORDER BY, ON CONFLICT targets) can be asserted in _test.go
// without a live Postgres — this package has no pgxmock/testcontainers
// harness, mirroring the drive/trip/vehicle repos.
const (
	commandLogInsertSQL = `INSERT INTO command_logs (vehicle_id, command, params, status, error, created_at)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`

	commandLogLatestByVehicleSQL = `SELECT DISTINCT ON (command) id, vehicle_id, command, params, status, error, created_at
		FROM command_logs
		WHERE vehicle_id = $1
		ORDER BY command, created_at DESC`

	commandLogHistorySQL = `SELECT id, vehicle_id, command, params, status, error, created_at
		FROM command_logs
		WHERE vehicle_id = $1
		ORDER BY created_at DESC
		LIMIT $2`

	// Migration 000188 made cagg_fleet_stats canonical SI: energy in Wh and
	// distance in meters. Keep those units at this boundary so the API/FE
	// display layer owns presentation conversion.
	energyDailyBreakdownSQL = `SELECT
		TO_CHAR(day, 'YYYY-MM-DD') AS date,
		COALESCE(total_energy_wh, 0) AS energy_wh,
		COALESCE(total_distance_m, 0) AS distance_m,
		CASE WHEN COALESCE(total_distance_m, 0) > 0
			THEN COALESCE(total_energy_wh, 0) / total_distance_m
			ELSE 0
		END AS efficiency_wh_per_m,
		0 AS cost
	FROM cagg_fleet_stats
	WHERE vehicle_id = $1
	  AND day >= (NOW() - make_interval(days := $2))::date
	  AND (COALESCE(total_energy_wh, 0) > 0 OR COALESCE(total_distance_m, 0) > 0)
	ORDER BY day`

	energyTotalSQL = `SELECT
		COALESCE(SUM(total_energy_wh), 0),
		0,
		COALESCE(SUM(total_distance_m), 0)
	FROM cagg_fleet_stats
	WHERE vehicle_id = $1
	  AND day >= (NOW() - make_interval(days := $2))::date`
)

// commandLogHistoryDefaultLimit / commandLogHistoryMaxLimit bound the
// /commands history endpoint.
const (
	commandLogHistoryDefaultLimit = 50
	commandLogHistoryMaxLimit     = 100
)

// CommandLogRepo provides command log data access.
type CommandLogRepo struct {
	db *database.DB
}

// NewCommandLogRepo constructs the repo. A nil db is a wiring bug, not a
// runtime condition, so fail fast at construction — mirrors the
// NewVehicleStatesRepo / NewMileageRepo precedent.
func NewCommandLogRepo(db *database.DB) *CommandLogRepo {
	if db == nil {
		panic("energy.NewCommandLogRepo: db must not be nil")
	}
	return &CommandLogRepo{db: db}
}

func (r *CommandLogRepo) Create(ctx context.Context, cl *vehiclemodel.CommandLog) error {
	if cl == nil {
		return fmt.Errorf("create command log: nil command log")
	}
	now := time.Now().UTC()
	if err := r.db.Pool.QueryRow(ctx, commandLogInsertSQL,
		cl.VehicleID, cl.Command, cl.Params, cl.Status, cl.Error, now,
	).Scan(&cl.ID); err != nil {
		return fmt.Errorf("insert command log: %w", err)
	}
	return nil
}

// GetLatestByVehicle returns the most recent command log entry per command name
// for a given vehicle, ordered by most recent first.
func (r *CommandLogRepo) GetLatestByVehicle(ctx context.Context, vehicleID int64) ([]*vehiclemodel.CommandLog, error) {
	rows, err := r.db.Pool.Query(ctx, commandLogLatestByVehicleSQL, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("query latest command logs: %w", err)
	}
	defer rows.Close()
	var results []*vehiclemodel.CommandLog
	for rows.Next() {
		cl := &vehiclemodel.CommandLog{}
		if err := rows.Scan(&cl.ID, &cl.VehicleID, &cl.Command, &cl.Params, &cl.Status, &cl.Error, &cl.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan command log: %w", err)
		}
		results = append(results, cl)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate command logs: %w", err)
	}
	return results, nil
}

// GetHistoryByVehicle returns the N most recent command logs for a vehicle.
func (r *CommandLogRepo) GetHistoryByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*vehiclemodel.CommandLog, error) {
	limit = clampLimit(limit, commandLogHistoryDefaultLimit, commandLogHistoryMaxLimit)
	rows, err := r.db.Pool.Query(ctx, commandLogHistorySQL, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("query command log history: %w", err)
	}
	defer rows.Close()
	var results []*vehiclemodel.CommandLog
	for rows.Next() {
		cl := &vehiclemodel.CommandLog{}
		if err := rows.Scan(&cl.ID, &cl.VehicleID, &cl.Command, &cl.Params, &cl.Status, &cl.Error, &cl.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan command log: %w", err)
		}
		results = append(results, cl)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate command logs: %w", err)
	}
	return results, nil
}

// EnergyStatsRepo computes energy statistics from charging sessions.
type EnergyStatsRepo struct {
	db *database.DB
}

// NewEnergyStatsRepo constructs the repo, failing fast on a nil db.
func NewEnergyStatsRepo(db *database.DB) *EnergyStatsRepo {
	if db == nil {
		panic("energy.NewEnergyStatsRepo: db must not be nil")
	}
	return &EnergyStatsRepo{db: db}
}

// isNotPopulated detects the Postgres error raised when querying a
// materialized view that was created WITH NO DATA and never refreshed.
func isNotPopulated(err error) bool {
	return err != nil && strings.Contains(err.Error(), "has not been populated")
}

func (r *EnergyStatsRepo) GetDailyBreakdown(ctx context.Context, vehicleID int64, days int) ([]*energymodel.EnergyStatsRow, error) {
	rows, err := r.db.Pool.Query(ctx, energyDailyBreakdownSQL, vehicleID, days)
	if err != nil {
		if isNotPopulated(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("query energy daily breakdown: %w", err)
	}
	defer rows.Close()

	var stats []*energymodel.EnergyStatsRow
	for rows.Next() {
		s := &energymodel.EnergyStatsRow{}
		if err := rows.Scan(&s.Date, &s.EnergyWh, &s.DistanceM, &s.EfficiencyWhPerM, &s.Cost); err != nil {
			return nil, fmt.Errorf("scan energy stats row: %w", err)
		}
		stats = append(stats, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate energy stats rows: %w", err)
	}
	return stats, nil
}

func (r *EnergyStatsRepo) GetTotalEnergy(ctx context.Context, vehicleID int64, days int) (float64, float64, float64, error) {
	var energy, cost, distance float64
	err := r.db.Pool.QueryRow(ctx, energyTotalSQL, vehicleID, days).Scan(&energy, &cost, &distance)
	if err != nil {
		if isNotPopulated(err) {
			return 0, 0, 0, nil
		}
		return 0, 0, 0, fmt.Errorf("query energy total: %w", err)
	}
	return energy, cost, distance, nil
}
