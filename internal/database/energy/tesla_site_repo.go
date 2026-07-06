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
	teslaEnergySiteSelectAllSQL = `SELECT id, energy_site_id, resource_type, site_name,
		gateway_id, total_pack_energy, percentage_charged, battery_type,
		backup_capable, storm_mode_enabled,
		has_solar, has_battery, has_grid, has_load_meter,
		tou_capable, storm_mode_capable,
		site_info_fetched_at,
		fetched_at, created_at, updated_at
		FROM tesla_energy_sites
		ORDER BY site_name ASC`

	// Upsert preserves site_info_json and site_info_fetched_at across
	// refreshes — those columns are deliberately absent from the UPDATE SET.
	teslaEnergySiteUpsertSQL = `INSERT INTO tesla_energy_sites (
			energy_site_id, resource_type, site_name,
			gateway_id, total_pack_energy, percentage_charged, battery_type,
			backup_capable, storm_mode_enabled,
			has_solar, has_battery, has_grid, has_load_meter,
			tou_capable, storm_mode_capable,
			fetched_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (energy_site_id) DO UPDATE SET
			resource_type = EXCLUDED.resource_type,
			site_name = EXCLUDED.site_name,
			gateway_id = EXCLUDED.gateway_id,
			total_pack_energy = EXCLUDED.total_pack_energy,
			percentage_charged = EXCLUDED.percentage_charged,
			battery_type = EXCLUDED.battery_type,
			backup_capable = EXCLUDED.backup_capable,
			storm_mode_enabled = EXCLUDED.storm_mode_enabled,
			has_solar = EXCLUDED.has_solar,
			has_battery = EXCLUDED.has_battery,
			has_grid = EXCLUDED.has_grid,
			has_load_meter = EXCLUDED.has_load_meter,
			tou_capable = EXCLUDED.tou_capable,
			storm_mode_capable = EXCLUDED.storm_mode_capable,
			fetched_at = EXCLUDED.fetched_at,
			updated_at = EXCLUDED.updated_at`

	teslaEnergySiteDeleteStaleSQL = `DELETE FROM tesla_energy_sites WHERE energy_site_id != ALL($1)`
	teslaEnergySiteDeleteAllSQL   = `DELETE FROM tesla_energy_sites`

	teslaEnergySiteGetSiteInfoSQL = `SELECT site_info_json, site_info_fetched_at
		 FROM tesla_energy_sites WHERE energy_site_id = $1`

	teslaEnergySiteUpdateSiteInfoSQL = `UPDATE tesla_energy_sites
		 SET site_info_json = $1, site_info_fetched_at = $2, updated_at = $3
		 WHERE energy_site_id = $4`
)

// TeslaEnergySiteRepo provides data access for Tesla energy site records.
type TeslaEnergySiteRepo struct {
	db *database.DB
}

// NewTeslaEnergySiteRepo creates a new repository, failing fast on a nil db.
func NewTeslaEnergySiteRepo(db *database.DB) *TeslaEnergySiteRepo {
	if db == nil {
		panic("energy.NewTeslaEnergySiteRepo: db must not be nil")
	}
	return &TeslaEnergySiteRepo{db: db}
}

// GetAll returns all stored energy sites ordered by site name.
func (r *TeslaEnergySiteRepo) GetAll(ctx context.Context) ([]*teslamodel.TeslaEnergySite, error) {
	rows, err := r.db.Pool.Query(ctx, teslaEnergySiteSelectAllSQL)
	if err != nil {
		return nil, fmt.Errorf("query energy sites: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaEnergySite
	for rows.Next() {
		s := &teslamodel.TeslaEnergySite{}
		if err := rows.Scan(
			&s.ID, &s.EnergySiteID, &s.ResourceType, &s.SiteName,
			&s.GatewayID, &s.TotalPackEnergy, &s.PercentageCharged, &s.BatteryType,
			&s.BackupCapable, &s.StormModeEnabled,
			&s.HasSolar, &s.HasBattery, &s.HasGrid, &s.HasLoadMeter,
			&s.TOUCapable, &s.StormModeCapable,
			&s.SiteInfoFetchedAt,
			&s.FetchedAt, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan energy site: %w", err)
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// ReplaceAll upserts incoming sites and removes any that are no longer present,
// preserving site_info_json and site_info_fetched_at across refreshes.
func (r *TeslaEnergySiteRepo) ReplaceAll(ctx context.Context, sites []*teslamodel.TeslaEnergySite) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	// Collect energy_site_ids that are still present from Tesla
	incomingIDs := make([]int64, 0, len(sites))

	for _, s := range sites {
		if s == nil {
			return fmt.Errorf("replace energy sites: nil site in batch")
		}
		incomingIDs = append(incomingIDs, s.EnergySiteID)

		// Upsert: insert or update product fields, preserving site_info columns
		_, err := tx.Exec(ctx, teslaEnergySiteUpsertSQL,
			s.EnergySiteID, s.ResourceType, s.SiteName,
			s.GatewayID, s.TotalPackEnergy, s.PercentageCharged, s.BatteryType,
			s.BackupCapable, s.StormModeEnabled,
			s.HasSolar, s.HasBattery, s.HasGrid, s.HasLoadMeter,
			s.TOUCapable, s.StormModeCapable,
			now, now, now,
		)
		if err != nil {
			return fmt.Errorf("upsert energy site %d: %w", s.EnergySiteID, err)
		}
	}

	// Delete sites no longer returned by Tesla
	if len(incomingIDs) > 0 {
		_, err = tx.Exec(ctx, teslaEnergySiteDeleteStaleSQL, incomingIDs)
	} else {
		_, err = tx.Exec(ctx, teslaEnergySiteDeleteAllSQL)
	}
	if err != nil {
		return fmt.Errorf("delete stale energy sites: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit energy sites: %w", err)
	}
	return nil
}

// GetSiteInfo returns the stored site_info JSON and fetch timestamp for a given energy site.
// Returns (nil, nil, nil) if the site exists but has no site_info yet.
// Returns (nil, nil, nil) if the site doesn't exist (caller should check separately).
func (r *TeslaEnergySiteRepo) GetSiteInfo(ctx context.Context, energySiteID int64) (*string, *time.Time, error) {
	var siteInfoJSON *string
	var fetchedAt *time.Time
	err := r.db.Pool.QueryRow(ctx, teslaEnergySiteGetSiteInfoSQL, energySiteID).Scan(&siteInfoJSON, &fetchedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("get site info for %d: %w", energySiteID, err)
	}
	return siteInfoJSON, fetchedAt, nil
}

// UpdateSiteInfo stores the site_info JSON payload for a given energy site.
// Returns an error if the energy site does not exist in the database.
func (r *TeslaEnergySiteRepo) UpdateSiteInfo(ctx context.Context, energySiteID int64, siteInfoJSON string) error {
	now := time.Now().UTC()
	tag, err := r.db.Pool.Exec(ctx, teslaEnergySiteUpdateSiteInfoSQL, siteInfoJSON, now, now, energySiteID)
	if err != nil {
		return fmt.Errorf("update site info for %d: %w", energySiteID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("energy site %d not found", energySiteID)
	}
	return nil
}
