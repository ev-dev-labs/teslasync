package energy

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

const (
	teslaEnergyLiveStatusDefaultLimit = 500
	teslaEnergyLiveStatusMaxLimit     = 2000
)

const (
	teslaEnergyLiveStatusInsertSQL = `INSERT INTO tesla_energy_live_status (
		energy_site_id, solar_power, battery_power, load_power,
		grid_power, grid_services_power, energy_left, total_pack_energy,
		percentage_charged, grid_status, backup_capable, storm_mode_active,
		timestamp, fetched_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	RETURNING id`

	teslaEnergyLiveStatusLatestSQL = `SELECT id, energy_site_id, solar_power, battery_power, load_power,
		grid_power, grid_services_power, energy_left, total_pack_energy,
		percentage_charged, grid_status, backup_capable, storm_mode_active,
		timestamp, fetched_at
		FROM tesla_energy_live_status
		WHERE energy_site_id = $1
		ORDER BY timestamp DESC
		LIMIT 1`

	teslaEnergyLiveStatusHistorySQL = `SELECT id, energy_site_id, solar_power, battery_power, load_power,
		grid_power, grid_services_power, energy_left, total_pack_energy,
		percentage_charged, grid_status, backup_capable, storm_mode_active,
		timestamp, fetched_at
		FROM tesla_energy_live_status
		WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3
		ORDER BY timestamp ASC
		LIMIT $4`
)

// TeslaEnergyLiveStatusRepo provides data access for Tesla energy site live status snapshots.
type TeslaEnergyLiveStatusRepo struct {
	db *database.DB
}

// NewTeslaEnergyLiveStatusRepo creates a new repository, failing fast on a nil db.
func NewTeslaEnergyLiveStatusRepo(db *database.DB) *TeslaEnergyLiveStatusRepo {
	if db == nil {
		panic("energy.NewTeslaEnergyLiveStatusRepo: db must not be nil")
	}
	return &TeslaEnergyLiveStatusRepo{db: db}
}

// Create inserts a new live status snapshot.
func (r *TeslaEnergyLiveStatusRepo) Create(ctx context.Context, s *teslamodel.TeslaEnergyLiveStatus) error {
	if s == nil {
		return fmt.Errorf("create energy live status: nil snapshot")
	}

	now := time.Now().UTC()
	if s.Timestamp.IsZero() {
		s.Timestamp = now
	}

	if err := r.db.Pool.QueryRow(ctx, teslaEnergyLiveStatusInsertSQL,
		s.EnergySiteID, s.SolarPower, s.BatteryPower, s.LoadPower,
		s.GridPower, s.GridServicesPower, s.EnergyLeft, s.TotalPackEnergy,
		s.PercentageCharged, s.GridStatus, s.BackupCapable, s.StormModeActive,
		s.Timestamp, now,
	).Scan(&s.ID); err != nil {
		return fmt.Errorf("insert energy live status: %w", err)
	}
	return nil
}

// GetLatest returns the most recent live status snapshot for a site, or
// (nil, nil) when the site has no snapshots yet.
func (r *TeslaEnergyLiveStatusRepo) GetLatest(ctx context.Context, energySiteID int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
	s := &teslamodel.TeslaEnergyLiveStatus{}
	err := r.db.Pool.QueryRow(ctx, teslaEnergyLiveStatusLatestSQL, energySiteID).Scan(
		&s.ID, &s.EnergySiteID, &s.SolarPower, &s.BatteryPower, &s.LoadPower,
		&s.GridPower, &s.GridServicesPower, &s.EnergyLeft, &s.TotalPackEnergy,
		&s.PercentageCharged, &s.GridStatus, &s.BackupCapable, &s.StormModeActive,
		&s.Timestamp, &s.FetchedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get latest energy live status: %w", err)
	}
	return s, nil
}

// GetHistory returns live status snapshots for a site within a time range.
func (r *TeslaEnergyLiveStatusRepo) GetHistory(ctx context.Context, energySiteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyLiveStatus, error) {
	limit = clampLimit(limit, teslaEnergyLiveStatusDefaultLimit, teslaEnergyLiveStatusMaxLimit)
	rows, err := r.db.Pool.Query(ctx, teslaEnergyLiveStatusHistorySQL, energySiteID, since, until, limit)
	if err != nil {
		return nil, fmt.Errorf("query energy live status history: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaEnergyLiveStatus
	for rows.Next() {
		s := &teslamodel.TeslaEnergyLiveStatus{}
		if err := rows.Scan(
			&s.ID, &s.EnergySiteID, &s.SolarPower, &s.BatteryPower, &s.LoadPower,
			&s.GridPower, &s.GridServicesPower, &s.EnergyLeft, &s.TotalPackEnergy,
			&s.PercentageCharged, &s.GridStatus, &s.BackupCapable, &s.StormModeActive,
			&s.Timestamp, &s.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan energy live status: %w", err)
		}
		results = append(results, s)
	}
	return results, rows.Err()
}
