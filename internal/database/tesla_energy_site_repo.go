package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TeslaEnergySiteRepo provides data access for Tesla energy site records.
type TeslaEnergySiteRepo struct {
	db *DB
}

// NewTeslaEnergySiteRepo creates a new repository.
func NewTeslaEnergySiteRepo(db *DB) *TeslaEnergySiteRepo {
	return &TeslaEnergySiteRepo{db: db}
}

// GetAll returns all stored energy sites ordered by site name.
func (r *TeslaEnergySiteRepo) GetAll(ctx context.Context) ([]*models.TeslaEnergySite, error) {
	query := `SELECT id, energy_site_id, resource_type, site_name,
		gateway_id, total_pack_energy, percentage_charged, battery_type,
		backup_capable, storm_mode_enabled,
		has_solar, has_battery, has_grid, has_load_meter,
		tou_capable, storm_mode_capable,
		raw_json, fetched_at, created_at, updated_at
		FROM tesla_energy_sites
		ORDER BY site_name ASC`

	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query energy sites: %w", err)
	}
	defer rows.Close()

	var results []*models.TeslaEnergySite
	for rows.Next() {
		s := &models.TeslaEnergySite{}
		if err := rows.Scan(
			&s.ID, &s.EnergySiteID, &s.ResourceType, &s.SiteName,
			&s.GatewayID, &s.TotalPackEnergy, &s.PercentageCharged, &s.BatteryType,
			&s.BackupCapable, &s.StormModeEnabled,
			&s.HasSolar, &s.HasBattery, &s.HasGrid, &s.HasLoadMeter,
			&s.TOUCapable, &s.StormModeCapable,
			&s.RawJSON, &s.FetchedAt, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan energy site: %w", err)
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// ReplaceAll deletes all existing energy sites and inserts the given batch
// in a single transaction, ensuring an atomic refresh.
func (r *TeslaEnergySiteRepo) ReplaceAll(ctx context.Context, sites []*models.TeslaEnergySite) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, "DELETE FROM tesla_energy_sites"); err != nil {
		return fmt.Errorf("delete energy sites: %w", err)
	}

	now := time.Now().UTC()

	for _, s := range sites {
		rawJSON := s.RawJSON
		if rawJSON == "" {
			rawJSON = "{}"
		}
		_, err := tx.Exec(ctx, `INSERT INTO tesla_energy_sites (
			energy_site_id, resource_type, site_name,
			gateway_id, total_pack_energy, percentage_charged, battery_type,
			backup_capable, storm_mode_enabled,
			has_solar, has_battery, has_grid, has_load_meter,
			tou_capable, storm_mode_capable,
			raw_json, fetched_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
			s.EnergySiteID, s.ResourceType, s.SiteName,
			s.GatewayID, s.TotalPackEnergy, s.PercentageCharged, s.BatteryType,
			s.BackupCapable, s.StormModeEnabled,
			s.HasSolar, s.HasBattery, s.HasGrid, s.HasLoadMeter,
			s.TOUCapable, s.StormModeCapable,
			rawJSON, now, now, now,
		)
		if err != nil {
			return fmt.Errorf("insert energy site %d: %w", s.EnergySiteID, err)
		}
	}

	return tx.Commit(ctx)
}
