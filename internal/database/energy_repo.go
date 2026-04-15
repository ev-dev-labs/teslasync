package database

import (
	"context"
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

// BatterySnapshotRepo tracks battery health over time.
type BatterySnapshotRepo struct {
	db *DB
}

func NewBatterySnapshotRepo(db *DB) *BatterySnapshotRepo {
	return &BatterySnapshotRepo{db: db}
}

func (r *BatterySnapshotRepo) DB() *DB {
	return r.db
}

func (r *BatterySnapshotRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.BatterySnapshot, error) {
	query := `SELECT id, vehicle_id, health_score, capacity_kwh, degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at
		FROM battery_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.BatterySnapshot
	for rows.Next() {
		s := &models.BatterySnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.HealthScore, &s.CapacityKWh, &s.DegradationPct, &s.EstRangeKm, &s.CycleCount, &s.AvgCellTempC, &s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *BatterySnapshotRepo) Create(ctx context.Context, s *models.BatterySnapshot) error {
	query := `INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh, degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, s.VehicleID, s.HealthScore, s.CapacityKWh, s.DegradationPct, s.EstRangeKm, s.CycleCount, s.AvgCellTempC, now).Scan(&s.ID)
}

// EnergyStatsRepo computes energy statistics from charging sessions.
type EnergyStatsRepo struct {
	db *DB
}

func NewEnergyStatsRepo(db *DB) *EnergyStatsRepo {
	return &EnergyStatsRepo{db: db}
}

func (r *EnergyStatsRepo) GetDailyBreakdown(ctx context.Context, vehicleID int64, days int) ([]*models.EnergyStatsRow, error) {
	query := `SELECT
		TO_CHAR(mv.day, 'YYYY-MM-DD') AS date,
		mv.energy_kwh,
		mv.distance_km,
		mv.efficiency,
		mv.cost
	FROM mv_energy_daily mv
	WHERE mv.vehicle_id = $1
	  AND mv.day >= (NOW() - make_interval(days := $2))::date
	  AND (mv.energy_kwh > 0 OR mv.distance_km > 0)
	ORDER BY mv.day`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []*models.EnergyStatsRow
	for rows.Next() {
		s := &models.EnergyStatsRow{}
		if err := rows.Scan(&s.Date, &s.EnergyKWh, &s.DistanceKm, &s.Efficiency, &s.Cost); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (r *EnergyStatsRepo) GetTotalEnergy(ctx context.Context, vehicleID int64, days int) (float64, float64, float64, error) {
	query := `SELECT
		COALESCE(SUM(energy_kwh), 0),
		COALESCE(SUM(cost), 0),
		COALESCE(SUM(distance_km), 0)
	FROM mv_energy_daily
	WHERE vehicle_id = $1
	  AND day >= (NOW() - make_interval(days := $2))::date`
	var energy, cost, distance float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, days).Scan(&energy, &cost, &distance)
	return energy, cost, distance, err
}
