package drive

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/jackc/pgx/v5"
)

// SI canonical schema (migration 000185_drives_si). The drives table is
// forward-only SI:
//   - duration_s (BIGINT, seconds)
//   - distance_m (DOUBLE PRECISION, meters)
//   - start_soc_pct / end_soc_pct (REAL, percent of pack capacity 0-100)
//   - energy_used_wh / regen_energy_wh (DOUBLE PRECISION, Watt-hours)
//   - avg_speed_mps / max_speed_mps (DOUBLE PRECISION, meters per second)
//   - avg_power_w / peak_power_w (DOUBLE PRECISION, Watts)
//   - ambient_temp_c_avg (DOUBLE PRECISION, Celsius — already SI)
//   - started_at / ended_at (TIMESTAMPTZ)
//   - start_lat / start_lng / end_lat / end_lng (DOUBLE PRECISION, WGS84°)
//   - start_place / end_place (TEXT, geocoded place names)
//
// drivemodel.Drive is SI canonical, so this repo performs no unit conversion.
// The frontend converts at the display boundary using useUnits() and
// lib/unitConversion's SI-floor formatters.
//
// Migration 000185 dropped these columns (forward-only per ADR-004 #2). The
// fields survive on drivemodel.Drive for JSON shape stability and surface
// nil/derived:
//   - InsideTempAvgC, Score, EndedStatus → always nil
//   - CreatedAt → started_at; UpdatedAt → ended_at-or-started_at

// DriveRepo provides drive session data access against the SI canonical
// drives table (migration 000185_drives_si).
type DriveRepo struct {
	db *database.DB
}

// driveColumns is the SI canonical SELECT column list (migration 000185).
const driveColumns = `id, vehicle_id, started_at, ended_at, duration_s, distance_m,
	start_place, end_place, start_lat, start_lng, end_lat, end_lng,
	start_soc_pct, end_soc_pct,
	energy_used_wh, regen_energy_wh, avg_speed_mps, max_speed_mps, avg_power_w,
	ambient_temp_c_avg`

// scanDrive scans the SI canonical column list into a drivemodel.Drive. No unit
// conversion is performed — both struct and DB are SI canonical.
func scanDrive(row interface{ Scan(dest ...any) error }) (*drivemodel.Drive, error) {
	d := &drivemodel.Drive{}
	var (
		durationSec *int64
		distanceM   *float64
		startSocPct *float32
		endSocPct   *float32
	)
	err := row.Scan(
		&d.ID, &d.VehicleID, &d.StartTs, &d.EndTs, &durationSec, &distanceM,
		&d.StartAddress, &d.EndAddress, &d.StartLat, &d.StartLon, &d.EndLat, &d.EndLon,
		&startSocPct, &endSocPct,
		&d.EnergyUsedWh, &d.RegenEnergyWh, &d.AvgSpeedMps, &d.MaxSpeedMps, &d.AvgPowerW,
		&d.OutsideTempAvgC,
	)
	if err != nil {
		return nil, err
	}

	if distanceM != nil {
		d.DistanceM = *distanceM
	}
	if durationSec != nil {
		d.DurationS = *durationSec
	}
	d.StartBatteryPct = socPctToInt16(startSocPct)
	d.EndBatteryPct = socPctToInt16(endSocPct)

	// Migration 000185 dropped these columns; surface nil so the JSON shape
	// stays stable while the value is honestly absent.
	d.InsideTempAvgC = nil
	d.Score = nil
	d.EndedStatus = nil

	// Migration 000185 has no created_at / updated_at columns; derive from
	// started_at / ended_at so the model fields (non-pointer time.Time) stay
	// populated for marshalers that emit them unconditionally.
	d.CreatedAt = d.StartTs
	if d.EndTs != nil {
		d.UpdatedAt = *d.EndTs
	} else {
		d.UpdatedAt = d.StartTs
	}
	return d, nil
}

// socPctToInt16 rounds a REAL percent value (0-100) to the int16 form
// exposed by drivemodel.Drive.StartBatteryPct / EndBatteryPct.
func socPctToInt16(p *float32) *int16 {
	if p == nil {
		return nil
	}
	v := int16(math.Round(float64(*p)))
	return &v
}

func NewDriveRepo(db *database.DB) *DriveRepo {
	return &DriveRepo{db: db}
}

func (r *DriveRepo) Create(ctx context.Context, d *drivemodel.Drive) error {
	ctx, span := tracing.DBSpan(ctx, "insert", "drives", tracing.VehicleID(d.VehicleID))
	defer span.End()
	var startSoc *float32
	if d.StartBatteryPct != nil {
		v := float32(*d.StartBatteryPct)
		startSoc = &v
	}
	query := `
		INSERT INTO drives (vehicle_id, started_at, start_soc_pct)
		VALUES ($1, $2, $3)
		RETURNING id`
	err := r.db.Pool.QueryRow(ctx, query,
		d.VehicleID, d.StartTs, startSoc,
	).Scan(&d.ID)
	tracing.EndSpan(span, err)
	return err
}

// pctInt16ToFloat32 converts a nullable percent int16 (0-100) to the
// float32 form persisted by start_soc_pct / end_soc_pct.
func pctInt16ToFloat32(p *int16) *float32 {
	if p == nil {
		return nil
	}
	v := float32(*p)
	return &v
}

// Complete finalizes a drive with end-of-drive aggregates. All arguments are
// SI canonical: distance in meters, duration in seconds, max speed in m/s,
// avg power in Watts, outside temp in °C. The drive's
// inside cabin temp column was dropped in migration 000185 (forward-only)
// and is no longer accepted.
func (r *DriveRepo) Complete(ctx context.Context, id int64, endTs time.Time,
	distanceM float64, durationS int64, endBatteryPct *int16,
	maxSpeedMps, avgPowerW, outsideTempAvgC *float64) error {
	endSoc := pctInt16ToFloat32(endBatteryPct)
	query := `
		UPDATE drives SET ended_at=$2,
		distance_m=$3, duration_s=$4, end_soc_pct=$5,
		max_speed_mps=$6, avg_power_w=$7, ambient_temp_c_avg=$8
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endTs,
		distanceM, durationS, endSoc, maxSpeedMps, avgPowerW, outsideTempAvgC)
	return err
}

func (r *DriveRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*drivemodel.Drive, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "drives", tracing.VehicleID(vehicleID))
	defer span.End()
	query := `SELECT ` + driveColumns + ` FROM drives WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND started_at >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND started_at <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY started_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*drivemodel.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

func (r *DriveRepo) GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "drives", tracing.DriveID(id))
	defer span.End()
	query := `SELECT ` + driveColumns + ` FROM drives WHERE id=$1`
	d, err := scanDrive(r.db.Pool.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	tracing.EndSpan(span, err)
	return d, err
}

// GetStale returns drives that have no end timestamp and started before the
// cutoff time.
func (r *DriveRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*drivemodel.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives WHERE ended_at IS NULL AND started_at < $1
		ORDER BY started_at DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*drivemodel.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

// FindRecentEndedForMerge returns the most recent ended drive for a vehicle
// whose ended_at falls within `window` before the candidate startTs. Returns
// (nil, nil) when no eligible drive is found. This merges spurious
// back-to-back drives caused by transient Gear=P frames within a longer trip.
// The merge target's ended_at is
// cleared by ResumeForMerge so the live tracker can extend it to the true
// end timestamp.
func (r *DriveRepo) FindRecentEndedForMerge(ctx context.Context, vehicleID int64, startTs time.Time, window time.Duration) (*drivemodel.Drive, error) {
	if window <= 0 {
		return nil, nil
	}
	query := `SELECT ` + driveColumns + `
		FROM drives
		WHERE vehicle_id = $1
		  AND ended_at IS NOT NULL
		  AND ended_at <= $2
		  AND ended_at >= $3
		ORDER BY ended_at DESC
		LIMIT 1`
	cutoff := startTs.Add(-window)
	d, err := scanDrive(r.db.Pool.QueryRow(ctx, query, vehicleID, startTs, cutoff))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return d, nil
}

// ResumeForMerge clears ended_at + drive-end aggregate columns on an
// already-completed drive so a subsequent Complete() call extends it
// instead of treating it as a new drive. Distance, duration and end_*
// aggregates are NOT zeroed — they will be overwritten by the next
// Complete() with values that include the gap+continuation segment.
func (r *DriveRepo) ResumeForMerge(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE drives SET ended_at = NULL WHERE id = $1`, id)
	return err
}

// DrivePartialAllowed enumerates the SI canonical columns that PartialUpdate
// is allowed to mutate. Callers MUST pass SI canonical keys directly;
// display-unit aliases are not accepted.
var DrivePartialAllowed = map[string]string{
	"ended_at":           "ended_at",
	"distance_m":         "distance_m",
	"duration_s":         "duration_s",
	"end_soc_pct":        "end_soc_pct",
	"start_soc_pct":      "start_soc_pct",
	"max_speed_mps":      "max_speed_mps",
	"avg_speed_mps":      "avg_speed_mps",
	"avg_power_w":        "avg_power_w",
	"ambient_temp_c_avg": "ambient_temp_c_avg",
	"energy_used_wh":     "energy_used_wh",
	"regen_energy_wh":    "regen_energy_wh",
	"start_place":        "start_place",
	"end_place":          "end_place",
	"start_lat":          "start_lat",
	"start_lng":          "start_lng",
	"end_lat":            "end_lat",
	"end_lng":            "end_lng",
	// SI-canonical odometer columns are persistable via PartialUpdate so
	// completeDriveLocked can write authoritative drive boundary odometer
	// values in meters directly.
	"start_odometer_m": "start_odometer_m",
	"end_odometer_m":   "end_odometer_m",
}

// PartialUpdate updates only the provided fields on a drive. The fields map
// MUST be keyed by SI canonical column names; display-unit aliases are not
// accepted.
func (r *DriveRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	query, args := database.BuildPartialUpdate("drives", id, fields, DrivePartialAllowed)
	if query == "" {
		return nil
	}
	_, err := r.db.Pool.Exec(ctx, query, args...)
	return err
}

// Delete removes a drive by ID.
func (r *DriveRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, "DELETE FROM drives WHERE id=$1", id)
	return err
}

// FilterExistingIDs returns the subset of `ids` that exist in the drives
// table, in arbitrary order. Used by bulk handlers to surface
// {id, "not_found"} per-id failures without round-tripping per id.
func (r *DriveRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM drives WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkDelete removes drives whose IDs are in `ids`, all inside a single
// transaction. Returns the actual rows-affected count. Callers should
// pre-validate which ids exist via FilterExistingIDs to surface failed ids
// to the client; this method itself is idempotent for missing ids.
func (r *DriveRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM drives WHERE id = ANY($1)`, ids)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("bulk delete drives: %w", err)
	}
	return deleted, nil
}

// CompleteWithTx is like Complete but uses the provided transaction.
// All arguments are SI canonical: distance in meters, duration in seconds,
// max speed in m/s, avg power in Watts, outside temp in °C.
func (r *DriveRepo) CompleteWithTx(ctx context.Context, tx database.DBTX, id int64, endTs time.Time,
	distanceM float64, durationS int64, endBatteryPct *int16,
	maxSpeedMps, avgPowerW, outsideTempAvgC *float64) error {
	endSoc := pctInt16ToFloat32(endBatteryPct)
	query := `
		UPDATE drives SET ended_at=$2,
		distance_m=$3, duration_s=$4, end_soc_pct=$5,
		max_speed_mps=$6, avg_power_w=$7, ambient_temp_c_avg=$8
		WHERE id=$1`
	_, err := tx.Exec(ctx, query, id, endTs,
		distanceM, durationS, endSoc, maxSpeedMps, avgPowerW, outsideTempAvgC)
	return err
}

// FindMissingAddresses returns drives that have coordinates but no geocoded
// place name. Used for backfilling place names on startup for drives created
// before geocoding was added.
func (r *DriveRepo) FindMissingAddresses(ctx context.Context) ([]*drivemodel.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives
		WHERE (start_lat IS NOT NULL AND start_lng IS NOT NULL AND (start_place IS NULL OR start_place = ''))
		   OR (end_lat IS NOT NULL AND end_lng IS NOT NULL AND (end_place IS NULL OR end_place = ''))
		ORDER BY id DESC`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*drivemodel.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

// PlaceLabelVersion is the current revision of the start_place / end_place
// labelling logic (see geocoding.GeoResult.ShortName). Rows written by an
// older revision carry a lower drives.place_label_version and are re-resolved
// once by the startup repair. Bump this whenever a change to ShortName would
// produce a materially better label for already-stored rows.
const PlaceLabelVersion = 2

// FindStalePlaceLabels returns drives whose place names were produced by an
// older labelling revision and that still have the coordinates needed to
// re-resolve them, newest first. Bounded by limit so a single pass over a large
// backlog stays predictable.
func (r *DriveRepo) FindStalePlaceLabels(ctx context.Context, limit int) ([]*drivemodel.Drive, error) {
	if limit <= 0 {
		return nil, nil
	}
	query := `SELECT ` + driveColumns + ` FROM drives
		WHERE place_label_version < $1
		  AND ((start_lat IS NOT NULL AND start_lng IS NOT NULL)
		    OR (end_lat IS NOT NULL AND end_lng IS NOT NULL))
		ORDER BY id DESC
		LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, PlaceLabelVersion, limit)
	if err != nil {
		return nil, fmt.Errorf("drives find_stale_place_labels: %w", err)
	}
	defer rows.Close()

	var drives []*drivemodel.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, fmt.Errorf("drives find_stale_place_labels scan: %w", err)
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

// MarkPlaceLabelVersion records that a drive's place names were produced by the
// current labelling revision, removing it from the repair backlog.
func (r *DriveRepo) MarkPlaceLabelVersion(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE drives SET place_label_version = $2 WHERE id = $1`, id, PlaceLabelVersion)
	if err != nil {
		return fmt.Errorf("drives mark_place_label_version: %w", err)
	}
	return nil
}

// PartialUpdateWithTx is like PartialUpdate but uses the provided transaction.
// The fields map MUST be keyed by SI canonical column names.
func (r *DriveRepo) PartialUpdateWithTx(ctx context.Context, tx database.DBTX, id int64, fields map[string]interface{}) error {
	query, args := database.BuildPartialUpdate("drives", id, fields, DrivePartialAllowed)
	if query == "" {
		return nil
	}
	_, err := tx.Exec(ctx, query, args...)
	return err
}

// BackfillDriveTelemetryDriveIDInTx attaches the supplied driveID to every
// drive_telemetry row whose (vehicle_id, ts) falls within the inclusive
// [startTs, endTs] window AND whose drive_id is currently NULL.
//
// Idempotent: rows already attributed to a different drive are NOT
// overwritten — the WHERE clause skips them via `drive_id IS NULL`.
//
// This MUST be invoked inside the same transaction as DriveRepo.CompleteWithTx
// so a partial
// failure cannot leave a drive marked complete with orphaned per-tick rows
// (the bug reproduced as drive_telemetry.drive_id IS NULL on every row).
//
// The startTs/endTs bound MUST be the canonical-leg start (in particular,
// when a merge has resumed an earlier drive via tryMergeDriveLocked the
// bound is the ORIGINAL start, not the resume point) so all per-tick
// readings within the merged window get attributed.
func (r *DriveRepo) BackfillDriveTelemetryDriveIDInTx(ctx context.Context, tx database.DBTX, driveID, vehicleID int64, startTs, endTs time.Time) (int64, error) {
	const sql = `
		UPDATE drive_telemetry
		   SET drive_id = $1
		 WHERE vehicle_id = $2
		   AND ts >= $3
		   AND ts <= $4
		   AND drive_id IS NULL`
	tag, err := tx.Exec(ctx, sql, driveID, vehicleID, startTs, endTs)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
