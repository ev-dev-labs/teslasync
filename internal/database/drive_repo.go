package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// DriveRepo provides drive session data access.
type DriveRepo struct {
	db *DB
}

// driveColumns is the full SELECT column list for drives including all enhanced fields.
const driveColumns = `id, vehicle_id, start_date, end_date, start_position_id, end_position_id,
	start_address_id, end_address_id, distance, duration_min, start_range_km, end_range_km,
	speed_max, power_max, power_min, start_battery_level, end_battery_level,
	inside_temp_avg, outside_temp_avg,
	start_odometer, end_odometer, speed_avg, speed_min,
	start_rated_range_km, end_rated_range_km, rated_range_avg, rated_range_max, rated_range_min,
	start_ideal_range_km, end_ideal_range_km, ideal_range_avg, ideal_range_max, ideal_range_min,
	start_est_range_km, end_est_range_km, est_range_avg, est_range_max, est_range_min,
	soc_start, soc_end, soc_avg, soc_max, soc_min,
	usable_soc_start, usable_soc_end, usable_soc_avg, usable_soc_max, usable_soc_min,
	elevation_start, elevation_end, elevation_gain, elevation_loss,
	driver_temp_avg, passenger_temp_avg, battery_heater_on,
	start_address, end_address,
	start_latitude, start_longitude, end_latitude, end_longitude`

// scanDrive scans all drive columns into a Drive model.
func scanDrive(row interface{ Scan(dest ...any) error }) (*models.Drive, error) {
	d := &models.Drive{}
	err := row.Scan(
		&d.ID, &d.VehicleID, &d.StartDate, &d.EndDate, &d.StartPositionID, &d.EndPositionID,
		&d.StartAddressID, &d.EndAddressID, &d.Distance, &d.DurationMin, &d.StartRangeKm,
		&d.EndRangeKm, &d.SpeedMax, &d.PowerMax, &d.PowerMin, &d.StartBatteryLvl,
		&d.EndBatteryLvl, &d.InsideTempAvg, &d.OutsideTempAvg,
		&d.StartOdometer, &d.EndOdometer, &d.SpeedAvg, &d.SpeedMin,
		&d.StartRatedRangeKm, &d.EndRatedRangeKm, &d.RatedRangeAvg, &d.RatedRangeMax, &d.RatedRangeMin,
		&d.StartIdealRangeKm, &d.EndIdealRangeKm, &d.IdealRangeAvg, &d.IdealRangeMax, &d.IdealRangeMin,
		&d.StartEstRangeKm, &d.EndEstRangeKm, &d.EstRangeAvg, &d.EstRangeMax, &d.EstRangeMin,
		&d.SocStart, &d.SocEnd, &d.SocAvg, &d.SocMax, &d.SocMin,
		&d.UsableSocStart, &d.UsableSocEnd, &d.UsableSocAvg, &d.UsableSocMax, &d.UsableSocMin,
		&d.ElevationStart, &d.ElevationEnd, &d.ElevationGain, &d.ElevationLoss,
		&d.DriverTempAvg, &d.PassengerTempAvg, &d.BatteryHeaterOn,
		&d.StartAddress, &d.EndAddress,
		&d.StartLatitude, &d.StartLongitude, &d.EndLatitude, &d.EndLongitude,
	)
	return d, err
}

func NewDriveRepo(db *DB) *DriveRepo {
	return &DriveRepo{db: db}
}

func (r *DriveRepo) Create(ctx context.Context, d *models.Drive) error {
	query := `
		INSERT INTO drives (vehicle_id, start_date, start_position_id, start_address_id, start_range_km, start_battery_level)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		d.VehicleID, d.StartDate, d.StartPositionID, d.StartAddressID, d.StartRangeKm, d.StartBatteryLvl,
	).Scan(&d.ID)
}

func (r *DriveRepo) Complete(ctx context.Context, id int64, endDate time.Time, endPosID, endAddrID *int64,
	distance, duration float64, endRange *float64, endBattery *int, speedMax, powerMax, powerMin, insideAvg, outsideAvg *float64) error {
	query := `
		UPDATE drives SET end_date=$2, end_position_id=$3, end_address_id=$4,
		distance=$5, duration_min=$6, end_range_km=$7, end_battery_level=$8,
		speed_max=$9, power_max=$10, power_min=$11, inside_temp_avg=$12, outside_temp_avg=$13
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endDate, endPosID, endAddrID,
		distance, duration, endRange, endBattery, speedMax, powerMax, powerMin, insideAvg, outsideAvg)
	return err
}

func (r *DriveRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_date >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_date <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_date DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
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
	query := `SELECT ` + driveColumns + ` FROM drives WHERE id=$1`
	d, err := scanDrive(r.db.Pool.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return d, err
}

// GetStale returns drives that have no end_date and started before the cutoff time.
func (r *DriveRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*models.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives WHERE end_date IS NULL AND start_date < $1
		ORDER BY start_date DESC`
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

// PartialUpdate updates only the provided fields on a drive.
func (r *DriveRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	allowed := map[string]string{
		"end_date":           "end_date",
		"distance":           "distance",
		"duration_min":       "duration_min",
		"end_range_km":       "end_range_km",
		"end_battery_level":  "end_battery_level",
		"speed_max":          "speed_max",
		"power_max":          "power_max",
		"power_min":          "power_min",
		"inside_temp_avg":    "inside_temp_avg",
		"outside_temp_avg":   "outside_temp_avg",
		"start_battery_level":"start_battery_level",
		"start_odometer":       "start_odometer",
		"end_odometer":         "end_odometer",
		"speed_avg":            "speed_avg",
		"speed_min":            "speed_min",
		"start_rated_range_km": "start_rated_range_km",
		"end_rated_range_km":   "end_rated_range_km",
		"rated_range_avg":      "rated_range_avg",
		"rated_range_max":      "rated_range_max",
		"rated_range_min":      "rated_range_min",
		"start_ideal_range_km": "start_ideal_range_km",
		"end_ideal_range_km":   "end_ideal_range_km",
		"ideal_range_avg":      "ideal_range_avg",
		"ideal_range_max":      "ideal_range_max",
		"ideal_range_min":      "ideal_range_min",
		"start_est_range_km":   "start_est_range_km",
		"end_est_range_km":     "end_est_range_km",
		"est_range_avg":        "est_range_avg",
		"est_range_max":        "est_range_max",
		"est_range_min":        "est_range_min",
		"soc_start":            "soc_start",
		"soc_end":              "soc_end",
		"soc_avg":              "soc_avg",
		"soc_max":              "soc_max",
		"soc_min":              "soc_min",
		"usable_soc_start":     "usable_soc_start",
		"usable_soc_end":       "usable_soc_end",
		"usable_soc_avg":       "usable_soc_avg",
		"usable_soc_max":       "usable_soc_max",
		"usable_soc_min":       "usable_soc_min",
		"elevation_start":      "elevation_start",
		"elevation_end":        "elevation_end",
		"elevation_gain":       "elevation_gain",
		"elevation_loss":       "elevation_loss",
		"driver_temp_avg":      "driver_temp_avg",
		"passenger_temp_avg":   "passenger_temp_avg",
		"battery_heater_on":    "battery_heater_on",
		"start_address":        "start_address",
		"end_address":          "end_address",
		"start_latitude":       "start_latitude",
		"start_longitude":      "start_longitude",
		"end_latitude":         "end_latitude",
		"end_longitude":        "end_longitude",
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1
	for jsonKey, col := range allowed {
		if val, ok := fields[jsonKey]; ok {
			setClauses = append(setClauses, fmt.Sprintf("%s=$%d", col, argIdx))
			args = append(args, val)
			argIdx++
		}
	}
	if len(setClauses) == 0 {
		return nil
	}

	query := "UPDATE drives SET "
	for i, c := range setClauses {
		if i > 0 {
			query += ", "
		}
		query += c
	}
	query += fmt.Sprintf(" WHERE id=$%d", argIdx)
	args = append(args, id)

	_, err := r.db.Pool.Exec(ctx, query, args...)
	return err
}

// Delete removes a drive by ID.
func (r *DriveRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, "DELETE FROM drives WHERE id=$1", id)
	return err
}
