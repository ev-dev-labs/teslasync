package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.BackupChargingRepository = (*Repository)(nil)

const activeBackupWatch = `
	FROM smart_backup_charging_watches w
	JOIN vehicles v ON v.id=w.vehicle_id AND v.archived_at IS NULL
	JOIN geofences g ON g.id=w.place_id AND g.enabled AND NOT g.needs_review
	  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at=w.place_updated_at
	JOIN smart_solar_energy_connections c ON c.subject=w.subject AND c.energy_site_id=w.energy_site_id AND c.state_hash IS NULL
	JOIN smart_push_devices d ON d.id=w.device_id AND d.subject=w.subject
	  AND d.verified_at=w.device_verified_at AND d.charging_enabled`

const backupWatchColumns = `w.id,w.subject,w.vehicle_id,w.energy_site_id,w.place_id,w.place_updated_at,w.device_id,
	w.consented_at,w.next_check_at,w.outage_started_at,w.watch_until,w.qualified_from,
	w.qualified_at,w.qualified_until,w.vehicle_power_w,w.vehicle_power_at,w.minimum_battery_to_load_w`

func scanBackupWatch(row pgx.Row) (domain.BackupChargingWatch, error) {
	var watch domain.BackupChargingWatch
	var at, until, powerAt *time.Time
	var power, draw *float64
	err := row.Scan(&watch.ID, &watch.Subject, &watch.VehicleID, &watch.EnergySiteID, &watch.PlaceID, &watch.PlaceUpdatedAt,
		&watch.DeviceID, &watch.ConsentedAt, &watch.NextCheckAt, &watch.OutageStart, &watch.WatchUntil, &watch.QualifiedFrom,
		&at, &until, &power, &powerAt, &draw)
	if at != nil && until != nil && power != nil && powerAt != nil && draw != nil {
		watch.Sample = &domain.BackupChargingSample{
			ObservedAt: *at, ExpiresAt: *until, VehiclePowerW: *power, VehiclePowerAt: *powerAt, MinimumBatteryToLoadW: *draw,
		}
	}
	return watch, err
}

func (r *Repository) FindBackupConnectionID(ctx context.Context, subject string) (int64, error) {
	var id int64
	err := r.db.Pool.QueryRow(ctx, `SELECT id FROM smart_solar_energy_connections WHERE subject=$1 AND state_hash IS NULL`, subject).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("find backup charging connection revision: %w", err)
	}
	return id, nil
}

func (r *Repository) ListQualifiedBackupWatchVehicles(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]int64, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT w.vehicle_id `+activeBackupWatch+`
		WHERE w.subject=$1 AND ($2::bigint IS NULL OR w.vehicle_id=$2) AND w.watch_until>$3
		  AND w.qualified_until>$3 AND w.qualified_at>=w.qualified_from+INTERVAL '30 seconds'
		ORDER BY w.qualified_until,w.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list qualified backup charging watches: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, fmt.Errorf("scan qualified backup charging watches: %w", err)
	}
	return ids, nil
}

func (r *Repository) CreateBackupChargingWatch(ctx context.Context, w domain.BackupChargingWatch) error {
	tag, err := r.db.Pool.Exec(ctx, `
		INSERT INTO smart_backup_charging_watches
		  (subject,vehicle_id,energy_site_id,place_id,place_updated_at,device_id,device_verified_at,
		   consented_at,next_check_at,outage_started_at,watch_until)
		SELECT c.subject,v.id,c.energy_site_id,g.id,g.updated_at,d.id,d.verified_at,$8,$8,$8,$9
		FROM vehicles v JOIN geofences g ON g.id=$4 AND g.enabled AND g.archived_at IS NULL
		  AND NOT g.needs_review AND g.is_charging_location AND g.updated_at=$5
		JOIN smart_solar_energy_connections c ON c.subject=$1 AND c.id=$3 AND c.state_hash IS NULL
		JOIN smart_push_devices d ON d.id=$6 AND d.subject=c.subject
		  AND d.updated_at=$7 AND d.verified_at IS NOT NULL AND d.charging_enabled
		WHERE v.id=$2 AND v.archived_at IS NULL
		FOR SHARE OF d,c,g,v
		ON CONFLICT (subject,vehicle_id) DO NOTHING`,
		w.Subject, w.VehicleID, w.ConnectionID, w.PlaceID, w.PlaceUpdatedAt, w.DeviceID, w.DeviceUpdatedAt, w.ConsentedAt, w.WatchUntil)
	if err != nil {
		return fmt.Errorf("save backup charging consent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *Repository) DeleteBackupChargingWatch(ctx context.Context, subject string, vehicleID, watchID int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_backup_charging_watches WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		subject, vehicleID, watchID)
	if err != nil {
		return fmt.Errorf("delete backup charging watch: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *Repository) FindBackupChargingWatch(ctx context.Context, subject string, vehicleID int64) (*domain.BackupChargingWatch, error) {
	// Show a saved watch even if its device or place is no longer valid so
	// the owner can remove it. Only the worker and delivery use activeBackupWatch.
	return r.findBackupWatch(ctx, `FROM smart_backup_charging_watches w
		WHERE w.subject=$1 AND w.vehicle_id=$2`, subject, vehicleID)
}

func (r *Repository) FindActiveBackupChargingWatch(ctx context.Context, subject string, vehicleID int64, now time.Time) (*domain.BackupChargingWatch, error) {
	return r.findBackupWatch(ctx, activeBackupWatch+` WHERE w.subject=$1 AND w.vehicle_id=$2 AND w.watch_until>$3`, subject, vehicleID, now)
}

func (r *Repository) findBackupWatch(ctx context.Context, scope string, args ...any) (*domain.BackupChargingWatch, error) {
	watch, err := scanBackupWatch(r.db.Pool.QueryRow(ctx, `SELECT `+backupWatchColumns+` `+scope, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get backup charging watch: %w", err)
	}
	return &watch, nil
}

func (r *Repository) ClaimBackupChargingWatches(ctx context.Context, now, next time.Time, limit int) ([]domain.BackupChargingWatch, error) {
	rows, err := r.db.Pool.Query(ctx, `
		WITH due AS (
		  SELECT w.id `+activeBackupWatch+`
		  WHERE w.next_check_at<=$1 AND w.watch_until>$1 AND w.subject<>$4 ORDER BY w.next_check_at,w.id
		  LIMIT $3 FOR UPDATE OF w SKIP LOCKED
		)
		UPDATE smart_backup_charging_watches w SET next_check_at=$2 FROM due WHERE w.id=due.id
		RETURNING `+backupWatchColumns, now, next, limit, personal.OpenSubject)
	if err != nil {
		return nil, fmt.Errorf("claim backup charging checks: %w", err)
	}
	watches, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.BackupChargingWatch, error) {
		return scanBackupWatch(row)
	})
	if err != nil {
		return nil, fmt.Errorf("scan backup charging checks: %w", err)
	}
	return watches, nil
}

func (r *Repository) RecordBackupChargingCheck(ctx context.Context, w domain.BackupChargingWatch, reading domain.BackupSiteReading,
	sample *domain.BackupChargingSample, now time.Time,
) (bool, error) {
	var observed, qualified, until, vehicle, powerAt, draw any
	if !reading.ObservedAt.IsZero() {
		observed = reading.ObservedAt
	}
	if sample != nil {
		qualified, until = sample.ObservedAt, sample.ExpiresAt
		vehicle, powerAt, draw = sample.VehiclePowerW, sample.VehiclePowerAt, sample.MinimumBatteryToLoadW
	}
	endWatch := reading.Grid == domain.BackupGridConnected || reading.Grid == domain.BackupGridIntentional
	tag, err := r.db.Pool.Exec(ctx, `
		WITH active AS (
		  SELECT w.id `+activeBackupWatch+`
		  WHERE w.id=$1 AND w.subject=$2 AND w.consented_at=$3 AND w.next_check_at=$4 AND w.next_check_at>$5 AND w.watch_until>$5
		    AND ($6::timestamptz IS NULL OR ($6>=w.consented_at AND $6<=$5
		      AND (w.last_observed_at IS NULL OR $6>w.last_observed_at OR ($7 AND $6=w.last_observed_at))))
		  FOR UPDATE OF w
		)
		UPDATE smart_backup_charging_watches w SET
		  last_observed_at=COALESCE($6,w.last_observed_at),
		  watch_until=CASE WHEN $7 THEN GREATEST($5, w.outage_started_at + INTERVAL '1 microsecond') ELSE w.watch_until END,
		  qualified_from=CASE WHEN $8::timestamptz IS NULL THEN NULL
		    WHEN w.qualified_until>$8 AND w.vehicle_power_at<$12 THEN w.qualified_from ELSE $8 END,
		  qualified_at=$8,qualified_until=$9,vehicle_power_w=$10,minimum_battery_to_load_w=$11,vehicle_power_at=$12
		FROM active WHERE w.id=active.id`,
		w.ID, w.Subject, w.ConsentedAt, w.NextCheckAt, now, observed, endWatch,
		qualified, until, vehicle, draw, powerAt)
	if err != nil {
		return false, fmt.Errorf("record consent-bound backup charging evidence: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
