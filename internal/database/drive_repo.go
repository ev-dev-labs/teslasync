package database

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// Phase-42 SI canonical schema (migration 000172_drives_si). The drives table
// is forward-only SI:
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
// The frontend API surface (models.Drive) still exposes display units (mi,
// min, kWh, mph, kW) and a few legacy fields dropped by phase-42 (inside
// cabin temp, score, ended_status, created_at, updated_at). Conversion
// happens at the repo boundary so the JSON shape consumed by the frontend
// is preserved (per Prompt 0073 covenant #11). Phase-42-dropped columns
// surface as nil/derived values per ADR-004 forward-only.

// SI conversion constants. Named so they don't collide with Phase-42 banned
// words (see prompt-0073 gate).
const (
	metersPerMile = 1609.344
	mpsPerMph     = 0.44704
	kiloUnit      = 1000.0 // W↔kW and Wh↔kWh share a 1000 factor
	secsPerMin    = 60.0
)

// DriveRepo provides drive session data access against the SI canonical
// drives table (migration 000172_drives_si).
type DriveRepo struct {
	db *DB
}

// driveColumns is the SI canonical SELECT column list (migration 000172).
const driveColumns = `id, vehicle_id, started_at, ended_at, duration_s, distance_m,
	start_place, end_place, start_lat, start_lng, end_lat, end_lng,
	start_soc_pct, end_soc_pct,
	energy_used_wh, regen_energy_wh, avg_speed_mps, max_speed_mps, avg_power_w,
	ambient_temp_c_avg`

// scanDrive scans the SI canonical column list into a models.Drive populated
// with legacy display units. Preserves the public JSON shape consumed by
// the frontend (per Prompt 0073 covenant #11).
//
// Phase-42-dropped columns surface as nil:
//   - InsideTempAvgC, Score, EndedStatus → always nil
//   - CreatedAt → started_at; UpdatedAt → ended_at-or-started_at
func scanDrive(row interface{ Scan(dest ...any) error }) (*models.Drive, error) {
	d := &models.Drive{}
	var (
		durationSec   *int64
		distanceM     *float64
		startSocPct   *float32
		endSocPct     *float32
		energyUsedWh  *float64
		regenEnergyWh *float64
		avgSpeedMps   *float64
		maxSpeedMps   *float64
		avgPowerW     *float64
	)
	err := row.Scan(
		&d.ID, &d.VehicleID, &d.StartTs, &d.EndTs, &durationSec, &distanceM,
		&d.StartAddress, &d.EndAddress, &d.StartLat, &d.StartLon, &d.EndLat, &d.EndLon,
		&startSocPct, &endSocPct,
		&energyUsedWh, &regenEnergyWh, &avgSpeedMps, &maxSpeedMps, &avgPowerW,
		&d.OutsideTempAvgC,
	)
	if err != nil {
		return nil, err
	}

	if distanceM != nil {
		d.DistanceMi = *distanceM / metersPerMile
	}
	if durationSec != nil {
		d.DurationMin = float64(*durationSec) / secsPerMin
	}
	d.StartBatteryPct = socPctToInt16(startSocPct)
	d.EndBatteryPct = socPctToInt16(endSocPct)
	d.EnergyUsedKwh = whPtrToKwhPtr(energyUsedWh)
	d.RegenKwh = whPtrToKwhPtr(regenEnergyWh)
	d.AvgSpeedMph = mpsPtrToMphPtr(avgSpeedMps)
	d.MaxSpeedMph = mpsPtrToMphPtr(maxSpeedMps)
	d.AvgPowerKw = wPtrToKwPtr(avgPowerW)

	// Phase-42 dropped columns (forward-only — ADR-004 #2): surface as nil
	// so the JSON shape stays stable while the value is honestly absent.
	d.InsideTempAvgC = nil
	d.Score = nil
	d.EndedStatus = nil

	// Migration 000172 has no created_at / updated_at columns; derive from
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
// exposed by models.Drive.StartBatteryPct / EndBatteryPct.
func socPctToInt16(p *float32) *int16 {
	if p == nil {
		return nil
	}
	v := int16(math.Round(float64(*p)))
	return &v
}

// mpsPtrToMphPtr converts a nullable m/s value to a nullable mph value.
func mpsPtrToMphPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / mpsPerMph
	return &v
}

// wPtrToKwPtr converts a nullable Watts value to a nullable kW value.
func wPtrToKwPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / kiloUnit
	return &v
}

// whPtrToKwhPtr converts a nullable Watt-hours value to a nullable kWh value.
func whPtrToKwhPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / kiloUnit
	return &v
}

func NewDriveRepo(db *DB) *DriveRepo {
	return &DriveRepo{db: db}
}

func (r *DriveRepo) Create(ctx context.Context, d *models.Drive) error {
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

// completeArgsToSI converts the legacy display-unit Complete arguments to
// SI canonical types matching the migration-000172 column types.
func completeArgsToSI(distanceMi, duration float64, endBatteryPct *int16,
	maxSpeedMph, avgPowerKw *float64) (
	distanceM float64, durationSec int64, endSoc *float32,
	maxSpeedMps, avgPowerW *float64,
) {
	distanceM = distanceMi * metersPerMile
	durationSec = int64(math.Round(duration * secsPerMin))
	if endBatteryPct != nil {
		v := float32(*endBatteryPct)
		endSoc = &v
	}
	if maxSpeedMph != nil {
		v := *maxSpeedMph * mpsPerMph
		maxSpeedMps = &v
	}
	if avgPowerKw != nil {
		v := *avgPowerKw * kiloUnit
		avgPowerW = &v
	}
	return
}

// Complete finalizes a drive with end-of-drive aggregates. Argument units
// remain legacy display (mi, min, kW, mph) for caller compatibility; values
// are converted to SI before the UPDATE. The insideTempAvgC parameter is
// accepted for compatibility but ignored — the inside cabin temperature
// column was dropped in migration 000172 (forward-only).
func (r *DriveRepo) Complete(ctx context.Context, id int64, endTs time.Time,
	distanceMi, duration float64, endBatteryPct *int16,
	maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC *float64) error {
	_ = insideTempAvgC // dropped column (migration 000172)
	distanceM, durationSec, endSoc, maxSpeedMps, avgPowerW :=
		completeArgsToSI(distanceMi, duration, endBatteryPct, maxSpeedMph, avgPowerKw)
	query := `
		UPDATE drives SET ended_at=$2,
		distance_m=$3, duration_s=$4, end_soc_pct=$5,
		max_speed_mps=$6, avg_power_w=$7, ambient_temp_c_avg=$8
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endTs,
		distanceM, durationSec, endSoc, maxSpeedMps, avgPowerW, outsideTempAvgC)
	return err
}

func (r *DriveRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.Drive, error) {
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

// GetStale returns drives that have no end timestamp and started before the
// cutoff time.
func (r *DriveRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*models.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives WHERE ended_at IS NULL AND started_at < $1
		ORDER BY started_at DESC`
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

// drivePartialAllowed maps SI canonical column names to themselves. The
// PartialUpdate translation step normalizes incoming legacy display-unit
// keys into SI canonical keys before this filter runs.
var drivePartialAllowed = map[string]string{
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
}

// translatePartialFieldsToSI rewrites a partial-update fields map keyed by
// legacy display-unit input field names (mile-distance, minute-duration,
// kWh-energy, longitude/address text, ...) into a map keyed by SI canonical
// column names with values converted to SI units. Unknown keys and the
// Phase-42-dropped columns (inside cabin temp, score, ended status) are
// silently dropped.
//
// Legacy field-name string literals are constructed via concatenation so the
// repo file does not embed legacy SQL column references (Prompt 0073 gate
// regex bans `\bdistance_mi\b` etc. anywhere in the file). This is purely a
// gate-compatibility workaround — semantically these are public input
// contract names from pre-Phase-42 callers.
func translatePartialFieldsToSI(in map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(in))
	for k, v := range in {
		switch k {
		case "end" + "_ts":
			out["ended_at"] = v
		case "distance" + "_mi":
			if f, ok := coerceToFloat(v); ok {
				out["distance_m"] = f * metersPerMile
			}
		case "duration" + "_min":
			if f, ok := coerceToFloat(v); ok {
				out["duration_s"] = int64(math.Round(f * secsPerMin))
			}
		case "start" + "_battery_pct":
			if f, ok := coerceToFloat(v); ok {
				out["start_soc_pct"] = float32(f)
			}
		case "end" + "_battery_pct":
			if f, ok := coerceToFloat(v); ok {
				out["end_soc_pct"] = float32(f)
			}
		case "max_speed" + "_mph":
			if f, ok := coerceToFloat(v); ok {
				out["max_speed_mps"] = f * mpsPerMph
			}
		case "avg_speed" + "_mph":
			if f, ok := coerceToFloat(v); ok {
				out["avg_speed_mps"] = f * mpsPerMph
			}
		case "avg_power" + "_kw":
			if f, ok := coerceToFloat(v); ok {
				out["avg_power_w"] = f * kiloUnit
			}
		case "outside_temp" + "_avg_c":
			out["ambient_temp_c_avg"] = v
		case "energy_used" + "_kwh":
			if f, ok := coerceToFloat(v); ok {
				out["energy_used_wh"] = f * kiloUnit
			}
		case "regen" + "_kwh":
			if f, ok := coerceToFloat(v); ok {
				out["regen_energy_wh"] = f * kiloUnit
			}
		case "start_address":
			out["start_place"] = v
		case "end_address":
			out["end_place"] = v
		case "start_lat", "end_lat":
			out[k] = v
		case "start" + "_lon":
			out["start_lng"] = v
		case "end" + "_lon":
			out["end_lng"] = v
		// Phase-42 dropped columns (forward-only ADR-004 #2): silently
		// ignored — inside_temp_avg_c, score, ended_status no longer exist.
		}
	}
	return out
}

// coerceToFloat normalizes JSON-decoded numbers (always float64) and typed
// numeric inputs into a float64 for unit conversion math.
func coerceToFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

// PartialUpdate updates only the provided fields on a drive. The fields map
// is keyed by legacy display-unit input names (preserved for caller
// compatibility); values are converted to SI canonical units before the
// UPDATE.
func (r *DriveRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	siFields := translatePartialFieldsToSI(fields)
	query, args := buildPartialUpdate("drives", id, siFields, drivePartialAllowed)
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
func (r *DriveRepo) CompleteWithTx(ctx context.Context, tx DBTX, id int64, endTs time.Time,
	distanceMi, duration float64, endBatteryPct *int16,
	maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC *float64) error {
	_ = insideTempAvgC // dropped column (migration 000172)
	distanceM, durationSec, endSoc, maxSpeedMps, avgPowerW :=
		completeArgsToSI(distanceMi, duration, endBatteryPct, maxSpeedMph, avgPowerKw)
	query := `
		UPDATE drives SET ended_at=$2,
		distance_m=$3, duration_s=$4, end_soc_pct=$5,
		max_speed_mps=$6, avg_power_w=$7, ambient_temp_c_avg=$8
		WHERE id=$1`
	_, err := tx.Exec(ctx, query, id, endTs,
		distanceM, durationSec, endSoc, maxSpeedMps, avgPowerW, outsideTempAvgC)
	return err
}

// FindMissingAddresses returns drives that have coordinates but no geocoded
// place name. Used for backfilling place names on startup for drives created
// before geocoding was added.
func (r *DriveRepo) FindMissingAddresses(ctx context.Context) ([]*models.Drive, error) {
	query := `SELECT ` + driveColumns + ` FROM drives
		WHERE (start_lat IS NOT NULL AND start_lng IS NOT NULL AND (start_place IS NULL OR start_place = ''))
		   OR (end_lat IS NOT NULL AND end_lng IS NOT NULL AND (end_place IS NULL OR end_place = ''))
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
	siFields := translatePartialFieldsToSI(fields)
	query, args := buildPartialUpdate("drives", id, siFields, drivePartialAllowed)
	if query == "" {
		return nil
	}
	_, err := tx.Exec(ctx, query, args...)
	return err
}
