package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// DriveRepo provides drive session data access.
type DriveRepo struct {
	db *DB
}

// driveColumns is the full SELECT column list for drives.
const driveColumns = `id, vehicle_id, start_ts, end_ts, duration_min, distance_mi,
	start_address, end_address, start_lat, start_lon, end_lat, end_lon,
	start_battery_pct, end_battery_pct,
	energy_used_kwh, regen_kwh, avg_speed_mph, max_speed_mph, avg_power_kw,
	outside_temp_avg_c, inside_temp_avg_c,
	score, ended_status,
	created_at, updated_at`

// scanDrive scans all drive columns into a Drive model.
func scanDrive(row interface{ Scan(dest ...any) error }) (*models.Drive, error) {
	d := &models.Drive{}
	err := row.Scan(
		&d.ID, &d.VehicleID, &d.StartTs, &d.EndTs, &d.DurationMin, &d.DistanceMi,
		&d.StartAddress, &d.EndAddress, &d.StartLat, &d.StartLon, &d.EndLat, &d.EndLon,
		&d.StartBatteryPct, &d.EndBatteryPct,
		&d.EnergyUsedKwh, &d.RegenKwh, &d.AvgSpeedMph, &d.MaxSpeedMph, &d.AvgPowerKw,
		&d.OutsideTempAvgC, &d.InsideTempAvgC,
		&d.Score, &d.EndedStatus,
		&d.CreatedAt, &d.UpdatedAt,
	)
	return d, err
}

func NewDriveRepo(db *DB) *DriveRepo {
	return &DriveRepo{db: db}
}

func (r *DriveRepo) Create(ctx context.Context, d *models.Drive) error {
	ctx, span := tracing.DBSpan(ctx, "insert", "drives", tracing.VehicleID(d.VehicleID))
	defer span.End()
	query := `
		INSERT INTO drives (vehicle_id, start_ts, start_battery_pct)
		VALUES ($1, $2, $3)
		RETURNING id`
	err := r.db.Pool.QueryRow(ctx, query,
		d.VehicleID, d.StartTs, d.StartBatteryPct,
	).Scan(&d.ID)
	tracing.EndSpan(span, err)
	return err
}

func (r *DriveRepo) Complete(ctx context.Context, id int64, endTs time.Time,
	distanceMi, duration float64, endBatteryPct *int16, maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC *float64) error {
	query := `
		UPDATE drives SET end_ts=$2,
		distance_mi=$3, duration_min=$4, end_battery_pct=$5,
		max_speed_mph=$6, avg_power_kw=$7, inside_temp_avg_c=$8, outside_temp_avg_c=$9
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endTs,
		distanceMi, duration, endBatteryPct, maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC)
	return err
}

func (r *DriveRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.Drive, error) {
	ctx, span := tracing.DBSpan(ctx, "select", "drives", tracing.VehicleID(vehicleID))
	defer span.End()
	query := `SELECT ` + driveColumns + ` FROM drives WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_ts DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*models.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

func (r *DriveRepo) GetByID(ctx context.Context, id int64) (*models.Drive, error) {
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

// GetStale returns drives that have no end_date and started before the cutoff time.
func (r *DriveRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*models.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives WHERE end_ts IS NULL AND start_ts < $1
		ORDER BY start_ts DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*models.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

// drivePartialAllowed maps JSON field names to database columns for drive partial updates.
var drivePartialAllowed = map[string]string{
	"end_ts":             "end_ts",
	"distance_mi":        "distance_mi",
	"duration_min":       "duration_min",
	"end_battery_pct":    "end_battery_pct",
	"start_battery_pct":  "start_battery_pct",
	"max_speed_mph":      "max_speed_mph",
	"avg_speed_mph":      "avg_speed_mph",
	"avg_power_kw":       "avg_power_kw",
	"inside_temp_avg_c":  "inside_temp_avg_c",
	"outside_temp_avg_c": "outside_temp_avg_c",
	"energy_used_kwh":    "energy_used_kwh",
	"regen_kwh":          "regen_kwh",
	"start_address":      "start_address",
	"end_address":        "end_address",
	"start_lat":          "start_lat",
	"start_lon":          "start_lon",
	"end_lat":            "end_lat",
	"end_lon":            "end_lon",
	"score":              "score",
	"ended_status":       "ended_status",
}

// PartialUpdate updates only the provided fields on a drive.
func (r *DriveRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	query, args := buildPartialUpdate("drives", id, fields, drivePartialAllowed)
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

// CompleteWithTx is like Complete but uses the provided transaction.
func (r *DriveRepo) CompleteWithTx(ctx context.Context, tx DBTX, id int64, endTs time.Time,
	distanceMi, duration float64, endBatteryPct *int16, maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC *float64) error {
	query := `
		UPDATE drives SET end_ts=$2,
		distance_mi=$3, duration_min=$4, end_battery_pct=$5,
		max_speed_mph=$6, avg_power_kw=$7, inside_temp_avg_c=$8, outside_temp_avg_c=$9
		WHERE id=$1`
	_, err := tx.Exec(ctx, query, id, endTs,
		distanceMi, duration, endBatteryPct, maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC)
	return err
}

// FindMissingAddresses returns drives that have coordinates but no geocoded address name.
// Used for backfilling addresses on startup for drives created before geocoding was added.
func (r *DriveRepo) FindMissingAddresses(ctx context.Context) ([]*models.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives
		WHERE (start_lat IS NOT NULL AND start_lon IS NOT NULL AND (start_address IS NULL OR start_address = ''))
		   OR (end_lat IS NOT NULL AND end_lon IS NOT NULL AND (end_address IS NULL OR end_address = ''))
		ORDER BY id DESC`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*models.Drive
	for rows.Next() {
		d, err := scanDrive(rows)
		if err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

// PartialUpdateWithTx is like PartialUpdate but uses the provided transaction.
func (r *DriveRepo) PartialUpdateWithTx(ctx context.Context, tx DBTX, id int64, fields map[string]interface{}) error {
	query, args := buildPartialUpdate("drives", id, fields, drivePartialAllowed)
	if query == "" {
		return nil
	}
	_, err := tx.Exec(ctx, query, args...)
	return err
}
