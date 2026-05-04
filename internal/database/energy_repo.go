package database

import (
	"context"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// CommandLogRepo provides command log data access.
type CommandLogRepo struct {
	db *DB
}

func NewCommandLogRepo(db *DB) *CommandLogRepo {
	return &CommandLogRepo{db: db}
}

func (r *CommandLogRepo) Create(ctx context.Context, cl *models.CommandLog) error {
	query := `INSERT INTO command_logs (vehicle_id, command, params, status, error, created_at)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, cl.VehicleID, cl.Command, cl.Params, cl.Status, cl.Error, now).Scan(&cl.ID)
}

// GetLatestByVehicle returns the most recent command log entry per command name
// for a given vehicle, ordered by most recent first.
func (r *CommandLogRepo) GetLatestByVehicle(ctx context.Context, vehicleID int64) ([]*models.CommandLog, error) {
	query := `SELECT DISTINCT ON (command) id, vehicle_id, command, params, status, error, created_at
		FROM command_logs
		WHERE vehicle_id = $1
		ORDER BY command, created_at DESC`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []*models.CommandLog
	for rows.Next() {
		cl := &models.CommandLog{}
		if err := rows.Scan(&cl.ID, &cl.VehicleID, &cl.Command, &cl.Params, &cl.Status, &cl.Error, &cl.CreatedAt); err != nil {
			return nil, err
		}
		results = append(results, cl)
	}
	return results, rows.Err()
}

// GetHistoryByVehicle returns the N most recent command logs for a vehicle.
func (r *CommandLogRepo) GetHistoryByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.CommandLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `SELECT id, vehicle_id, command, params, status, error, created_at
		FROM command_logs
		WHERE vehicle_id = $1
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []*models.CommandLog
	for rows.Next() {
		cl := &models.CommandLog{}
		if err := rows.Scan(&cl.ID, &cl.VehicleID, &cl.Command, &cl.Params, &cl.Status, &cl.Error, &cl.CreatedAt); err != nil {
			return nil, err
		}
		results = append(results, cl)
	}
	return results, rows.Err()
}

// EnergyStatsRepo computes energy statistics from charging sessions.
type EnergyStatsRepo struct {
	db *DB
}

func NewEnergyStatsRepo(db *DB) *EnergyStatsRepo {
	return &EnergyStatsRepo{db: db}
}

// isNotPopulated detects the Postgres error raised when querying a
// materialized view that was created WITH NO DATA and never refreshed.
func isNotPopulated(err error) bool {
	return err != nil && strings.Contains(err.Error(), "has not been populated")
}

// Phase-42 (prompt 0077, migration 000175): cagg_fleet_stats now stores
// energy in Wh (total_energy_wh) and distance in meters (total_distance_m).
// We convert to legacy units (kWh / miles) at the SELECT boundary so the
// downstream models.EnergyStatsRow contract (kWh / miles / Wh-per-mile) is
// unchanged.

func (r *EnergyStatsRepo) GetDailyBreakdown(ctx context.Context, vehicleID int64, days int) ([]*models.EnergyStatsRow, error) {
	query := `SELECT
		TO_CHAR(day, 'YYYY-MM-DD') AS date,
		COALESCE(total_energy_wh, 0) * 0.001 AS energy_kwh,
		COALESCE(total_distance_m, 0) * 0.000621371 AS distance_mi,
		CASE WHEN COALESCE(total_distance_m, 0) > 0
			THEN COALESCE(total_energy_wh, 0) / (total_distance_m * 0.000621371)
			ELSE 0
		END AS efficiency_wh_per_mi,
		0 AS cost
	FROM cagg_fleet_stats
	WHERE vehicle_id = $1
	  AND day >= (NOW() - make_interval(days := $2))::date
	  AND (COALESCE(total_energy_wh, 0) > 0 OR COALESCE(total_distance_m, 0) > 0)
	ORDER BY day`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, days)
	if err != nil {
		if isNotPopulated(err) {
			return nil, nil
		}
		return nil, err
	}
	defer rows.Close()

	var stats []*models.EnergyStatsRow
	for rows.Next() {
		s := &models.EnergyStatsRow{}
		if err := rows.Scan(&s.Date, &s.EnergyKWh, &s.DistanceMi, &s.EfficiencyWhPerMi, &s.Cost); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (r *EnergyStatsRepo) GetTotalEnergy(ctx context.Context, vehicleID int64, days int) (float64, float64, float64, error) {
	query := `SELECT
		COALESCE(SUM(total_energy_wh), 0) * 0.001,
		0,
		COALESCE(SUM(total_distance_m), 0) * 0.000621371
	FROM cagg_fleet_stats
	WHERE vehicle_id = $1
	  AND day >= (NOW() - make_interval(days := $2))::date`
	var energy, cost, distance float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, days).Scan(&energy, &cost, &distance)
	if err != nil {
		if isNotPopulated(err) {
			return 0, 0, 0, nil
		}
	}
	return energy, cost, distance, err
}
