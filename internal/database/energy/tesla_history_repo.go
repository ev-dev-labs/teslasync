package energy

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// Shared list-limit bounds for the Tesla energy history endpoints.
const (
	teslaEnergyHistoryDefaultLimit = 500
	teslaEnergyHistoryMaxLimit     = 1000
)

const (
	teslaEnergyHistorySelectSQL = `SELECT id, energy_site_id, period, timestamp,
		solar_energy_wh, battery_energy_in_wh, battery_energy_out_wh,
		grid_energy_in_wh, grid_energy_out_wh, consumer_energy_wh,
		fetched_at
		FROM tesla_energy_history
		WHERE energy_site_id = $1 AND period = $2 AND timestamp >= $3 AND timestamp <= $4
		ORDER BY timestamp ASC
		LIMIT $5`

	teslaEnergyHistoryUpsertSQL = `INSERT INTO tesla_energy_history (
		energy_site_id, period, timestamp,
		solar_energy_wh, battery_energy_in_wh, battery_energy_out_wh,
		grid_energy_in_wh, grid_energy_out_wh, consumer_energy_wh,
		fetched_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	ON CONFLICT (energy_site_id, period, timestamp) DO UPDATE SET
		solar_energy_wh = EXCLUDED.solar_energy_wh,
		battery_energy_in_wh = EXCLUDED.battery_energy_in_wh,
		battery_energy_out_wh = EXCLUDED.battery_energy_out_wh,
		grid_energy_in_wh = EXCLUDED.grid_energy_in_wh,
		grid_energy_out_wh = EXCLUDED.grid_energy_out_wh,
		consumer_energy_wh = EXCLUDED.consumer_energy_wh,
		fetched_at = EXCLUDED.fetched_at`

	teslaEnergyBackupSelectSQL = `SELECT id, energy_site_id, period, timestamp, duration_seconds, fetched_at
		FROM tesla_energy_backup_events
		WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3
		ORDER BY timestamp ASC
		LIMIT $4`

	teslaEnergyBackupUpsertSQL = `INSERT INTO tesla_energy_backup_events (
		energy_site_id, period, timestamp, duration_seconds, fetched_at
	) VALUES ($1,$2,$3,$4,$5)
	ON CONFLICT (energy_site_id, period, timestamp) DO UPDATE SET
		duration_seconds = EXCLUDED.duration_seconds,
		fetched_at = EXCLUDED.fetched_at`

	teslaEnergyWCSelectSQL = `SELECT id, energy_site_id, din, timestamp, energy_wh, fetched_at
		FROM tesla_energy_wc_charging
		WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3
		ORDER BY timestamp ASC
		LIMIT $4`

	teslaEnergyWCUpsertSQL = `INSERT INTO tesla_energy_wc_charging (
		energy_site_id, din, timestamp, energy_wh, fetched_at
	) VALUES ($1,$2,$3,$4,$5)
	ON CONFLICT (energy_site_id, COALESCE(din, ''), timestamp) DO UPDATE SET
		energy_wh = EXCLUDED.energy_wh,
		fetched_at = EXCLUDED.fetched_at`
)

// ---------------------------------------------------------------------------
// TeslaEnergyHistoryRepo — energy measurements (kind=energy)
// ---------------------------------------------------------------------------

// TeslaEnergyHistoryRepo provides data access for Tesla energy calendar history.
type TeslaEnergyHistoryRepo struct {
	db *database.DB
}

func NewTeslaEnergyHistoryRepo(db *database.DB) *TeslaEnergyHistoryRepo {
	if db == nil {
		panic("energy.NewTeslaEnergyHistoryRepo: db must not be nil")
	}
	return &TeslaEnergyHistoryRepo{db: db}
}

// GetByRange returns energy history for a site filtered by period and date range.
func (r *TeslaEnergyHistoryRepo) GetByRange(ctx context.Context, siteID int64, period string, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyHistory, error) {
	limit = clampLimit(limit, teslaEnergyHistoryDefaultLimit, teslaEnergyHistoryMaxLimit)
	rows, err := r.db.Pool.Query(ctx, teslaEnergyHistorySelectSQL, siteID, period, since, until, limit)
	if err != nil {
		return nil, fmt.Errorf("query tesla energy history: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaEnergyHistory
	for rows.Next() {
		e := &teslamodel.TeslaEnergyHistory{}
		if err := rows.Scan(
			&e.ID, &e.EnergySiteID, &e.Period, &e.Timestamp,
			&e.SolarEnergyWh, &e.BatteryEnergyInWh, &e.BatteryEnergyOutWh,
			&e.GridEnergyInWh, &e.GridEnergyOutWh, &e.ConsumerEnergyWh,
			&e.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tesla energy history: %w", err)
		}
		results = append(results, e)
	}
	return results, rows.Err()
}

// UpsertBatch inserts or updates energy history entries by (site_id, period, timestamp).
func (r *TeslaEnergyHistoryRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyHistory) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}

	now := time.Now().UTC()
	upserted := 0
	for _, e := range entries {
		if e == nil {
			return upserted, fmt.Errorf("upsert tesla energy history: nil entry at index %d", upserted)
		}
		_, err := r.db.Pool.Exec(ctx, teslaEnergyHistoryUpsertSQL,
			e.EnergySiteID, e.Period, e.Timestamp,
			e.SolarEnergyWh, e.BatteryEnergyInWh, e.BatteryEnergyOutWh,
			e.GridEnergyInWh, e.GridEnergyOutWh, e.ConsumerEnergyWh,
			now,
		)
		if err != nil {
			return upserted, fmt.Errorf("upsert tesla energy history: %w", err)
		}
		upserted++
	}
	return upserted, nil
}

// ---------------------------------------------------------------------------
// TeslaEnergyBackupEventRepo — backup/off-grid events (kind=backup)
// ---------------------------------------------------------------------------

// TeslaEnergyBackupEventRepo provides data access for Tesla energy backup events.
type TeslaEnergyBackupEventRepo struct {
	db *database.DB
}

func NewTeslaEnergyBackupEventRepo(db *database.DB) *TeslaEnergyBackupEventRepo {
	if db == nil {
		panic("energy.NewTeslaEnergyBackupEventRepo: db must not be nil")
	}
	return &TeslaEnergyBackupEventRepo{db: db}
}

// GetByRange returns backup events for a site filtered by date range.
func (r *TeslaEnergyBackupEventRepo) GetByRange(ctx context.Context, siteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyBackupEvent, error) {
	limit = clampLimit(limit, teslaEnergyHistoryDefaultLimit, teslaEnergyHistoryMaxLimit)
	rows, err := r.db.Pool.Query(ctx, teslaEnergyBackupSelectSQL, siteID, since, until, limit)
	if err != nil {
		return nil, fmt.Errorf("query tesla energy backup events: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaEnergyBackupEvent
	for rows.Next() {
		e := &teslamodel.TeslaEnergyBackupEvent{}
		if err := rows.Scan(
			&e.ID, &e.EnergySiteID, &e.Period, &e.Timestamp,
			&e.DurationSeconds, &e.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tesla energy backup event: %w", err)
		}
		results = append(results, e)
	}
	return results, rows.Err()
}

// UpsertBatch inserts or updates backup events by (site_id, period, timestamp).
func (r *TeslaEnergyBackupEventRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyBackupEvent) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}

	now := time.Now().UTC()
	upserted := 0
	for _, e := range entries {
		if e == nil {
			return upserted, fmt.Errorf("upsert tesla energy backup event: nil entry at index %d", upserted)
		}
		_, err := r.db.Pool.Exec(ctx, teslaEnergyBackupUpsertSQL,
			e.EnergySiteID, e.Period, e.Timestamp,
			e.DurationSeconds, now,
		)
		if err != nil {
			return upserted, fmt.Errorf("upsert tesla energy backup event: %w", err)
		}
		upserted++
	}
	return upserted, nil
}

// ---------------------------------------------------------------------------
// TeslaEnergyWCChargingRepo — wall connector charging (telemetry_history kind=charge)
// ---------------------------------------------------------------------------

// TeslaEnergyWCChargingRepo provides data access for Tesla wall connector charging history.
type TeslaEnergyWCChargingRepo struct {
	db *database.DB
}

func NewTeslaEnergyWCChargingRepo(db *database.DB) *TeslaEnergyWCChargingRepo {
	if db == nil {
		panic("energy.NewTeslaEnergyWCChargingRepo: db must not be nil")
	}
	return &TeslaEnergyWCChargingRepo{db: db}
}

// GetByRange returns wall connector charging history for a site filtered by date range.
func (r *TeslaEnergyWCChargingRepo) GetByRange(ctx context.Context, siteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyWCCharging, error) {
	limit = clampLimit(limit, teslaEnergyHistoryDefaultLimit, teslaEnergyHistoryMaxLimit)
	rows, err := r.db.Pool.Query(ctx, teslaEnergyWCSelectSQL, siteID, since, until, limit)
	if err != nil {
		return nil, fmt.Errorf("query tesla energy wc charging: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaEnergyWCCharging
	for rows.Next() {
		e := &teslamodel.TeslaEnergyWCCharging{}
		if err := rows.Scan(
			&e.ID, &e.EnergySiteID, &e.DIN, &e.Timestamp,
			&e.EnergyWh, &e.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tesla energy wc charging: %w", err)
		}
		results = append(results, e)
	}
	return results, rows.Err()
}

// UpsertBatch inserts or updates WC charging entries by (site_id, din, timestamp).
func (r *TeslaEnergyWCChargingRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyWCCharging) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}

	now := time.Now().UTC()
	upserted := 0
	for _, e := range entries {
		if e == nil {
			return upserted, fmt.Errorf("upsert tesla energy wc charging: nil entry at index %d", upserted)
		}
		_, err := r.db.Pool.Exec(ctx, teslaEnergyWCUpsertSQL,
			e.EnergySiteID, e.DIN, e.Timestamp,
			e.EnergyWh, now,
		)
		if err != nil {
			return upserted, fmt.Errorf("upsert tesla energy wc charging: %w", err)
		}
		upserted++
	}
	return upserted, nil
}
