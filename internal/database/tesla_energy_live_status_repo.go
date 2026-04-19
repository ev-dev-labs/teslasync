package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TeslaEnergyLiveStatusRepo provides data access for Tesla energy site live status snapshots.
type TeslaEnergyLiveStatusRepo struct {
	db *DB
}

// NewTeslaEnergyLiveStatusRepo creates a new repository.
func NewTeslaEnergyLiveStatusRepo(db *DB) *TeslaEnergyLiveStatusRepo {
	return &TeslaEnergyLiveStatusRepo{db: db}
}

// Create inserts a new live status snapshot.
func (r *TeslaEnergyLiveStatusRepo) Create(ctx context.Context, s *models.TeslaEnergyLiveStatus) error {
	query := `INSERT INTO tesla_energy_live_status (
		energy_site_id, solar_power, battery_power, load_power,
		grid_power, grid_services_power, energy_left, total_pack_energy,
		percentage_charged, grid_status, backup_capable, storm_mode_active,
		raw_json, timestamp, fetched_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
	RETURNING id`

	now := time.Now().UTC()
	if s.Timestamp.IsZero() {
		s.Timestamp = now
	}
	rawJSON := validJSON(s.RawJSON)

	return r.db.Pool.QueryRow(ctx, query,
		s.EnergySiteID, s.SolarPower, s.BatteryPower, s.LoadPower,
		s.GridPower, s.GridServicesPower, s.EnergyLeft, s.TotalPackEnergy,
		s.PercentageCharged, s.GridStatus, s.BackupCapable, s.StormModeActive,
		rawJSON, s.Timestamp, now,
	).Scan(&s.ID)
}

// GetLatest returns the most recent live status snapshot for a site.
func (r *TeslaEnergyLiveStatusRepo) GetLatest(ctx context.Context, energySiteID int64) (*models.TeslaEnergyLiveStatus, error) {
	query := `SELECT id, energy_site_id, solar_power, battery_power, load_power,
		grid_power, grid_services_power, energy_left, total_pack_energy,
		percentage_charged, grid_status, backup_capable, storm_mode_active,
		raw_json, timestamp, fetched_at
		FROM tesla_energy_live_status
		WHERE energy_site_id = $1
		ORDER BY timestamp DESC
		LIMIT 1`

	s := &models.TeslaEnergyLiveStatus{}
	err := r.db.Pool.QueryRow(ctx, query, energySiteID).Scan(
		&s.ID, &s.EnergySiteID, &s.SolarPower, &s.BatteryPower, &s.LoadPower,
		&s.GridPower, &s.GridServicesPower, &s.EnergyLeft, &s.TotalPackEnergy,
		&s.PercentageCharged, &s.GridStatus, &s.BackupCapable, &s.StormModeActive,
		&s.RawJSON, &s.Timestamp, &s.FetchedAt,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("get latest energy live status: %w", err)
	}
	return s, nil
}

// GetHistory returns live status snapshots for a site within a time range.
func (r *TeslaEnergyLiveStatusRepo) GetHistory(ctx context.Context, energySiteID int64, since, until time.Time, limit int) ([]*models.TeslaEnergyLiveStatus, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	query := `SELECT id, energy_site_id, solar_power, battery_power, load_power,
		grid_power, grid_services_power, energy_left, total_pack_energy,
		percentage_charged, grid_status, backup_capable, storm_mode_active,
		raw_json, timestamp, fetched_at
		FROM tesla_energy_live_status
		WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3
		ORDER BY timestamp ASC
		LIMIT $4`

	rows, err := r.db.Pool.Query(ctx, query, energySiteID, since, until, limit)
	if err != nil {
		return nil, fmt.Errorf("query energy live status history: %w", err)
	}
	defer rows.Close()

	var results []*models.TeslaEnergyLiveStatus
	for rows.Next() {
		s := &models.TeslaEnergyLiveStatus{}
		if err := rows.Scan(
			&s.ID, &s.EnergySiteID, &s.SolarPower, &s.BatteryPower, &s.LoadPower,
			&s.GridPower, &s.GridServicesPower, &s.EnergyLeft, &s.TotalPackEnergy,
			&s.PercentageCharged, &s.GridStatus, &s.BackupCapable, &s.StormModeActive,
			&s.RawJSON, &s.Timestamp, &s.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan energy live status: %w", err)
		}
		results = append(results, s)
	}
	return results, rows.Err()
}
