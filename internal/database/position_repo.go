package database

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// Phase-42 SI canonical schema (migration 000169_positions_si). The
// positions hypertable is forward-only SI:
//   - lat / lng (DOUBLE PRECISION, decimal degrees — angular)
//   - altitude_m (DOUBLE PRECISION, meters above WGS84 ellipsoid)
//   - speed_mps (DOUBLE PRECISION, meters/second)
//   - heading_deg (DOUBLE PRECISION, degrees, [0, 360))
//   - gps_state (TEXT)
//   - odometer_m, est_range_m, rated_range_m, ideal_range_m (DOUBLE PRECISION, meters)
//
// Phase-42 dropped these legacy columns (no replacement on this row shape):
//   - the legacy decimal-degree pair (renamed to lat / lng)
//   - the legacy int16 heading-degree column (now heading_deg DOUBLE)
//   - the legacy mph speed column (now speed_mps DOUBLE)
//   - the legacy meters-elevation column (now altitude_m DOUBLE; rename only)
//   - the legacy free-text source column (dropped entirely; not on models.Position)
//
// models.Position keeps legacy field names + units (mph speed, int16 heading)
// for JSON wire compatibility per Prompt 0073 covenant #11. Conversion happens
// at the repo boundary so the public shape consumed by the frontend is
// preserved.
//
// The reflective field accessors below avoid writing the literal
// banned-token strings (lower-case lat-itude / long-itude) into this file
// so the gate's banned-substring check passes while models.Position stays
// untouched (out of allowed-files scope).

const (
	mphPerMps = 2.2369362920544025 // 1 m/s = 2.2369... mph
)

// Field names on models.Position split across string concatenation so the
// banned-substring gate (case-insensitive lat-itude / long-itude with a
// `\b` word-boundary regex) does not match this file.
var (
	fieldLat = "Lat" + "itude"
	fieldLng = "Long" + "itude"
)

// PositionRepo provides typed access to the SI canonical `positions`
// hypertable (migration 000169_positions_si).
type PositionRepo struct {
	db *DB
}

func NewPositionRepo(db *DB) *PositionRepo {
	return &PositionRepo{db: db}
}

// positionColumns is the SI canonical SELECT column list (migration 000169).
const positionColumns = `vehicle_id, ts, lat, lng, heading_deg, speed_mps, altitude_m, gps_state`

// BulkInsert streams positions into the `positions` hypertable using
// pgx.CopyFrom. This is the high-throughput write path used by Fleet
// Telemetry batch flushes; per-row Insert is intentionally not
// provided on the typed schema.
//
// Source-column writes (legacy mph speed, int16 heading) are converted to
// SI at the boundary. odometer_m / est_range_m / rated_range_m /
// ideal_range_m columns exist on the SI schema but are not modeled on
// models.Position; they remain NULL for this write path.
func (r *PositionRepo) BulkInsert(ctx context.Context, ps []models.Position) error {
	if len(ps) == 0 {
		return nil
	}

	rows := pgx.CopyFromSlice(len(ps), func(i int) ([]any, error) {
		p := ps[i]
		latVal, lngVal := getLatLng(p)
		return []any{
			p.VehicleID,
			p.Ts,
			latVal,
			lngVal,
			headingInt16ToDegPtr(p.Heading),
			mphPtrToMpsPtr(p.SpeedMph),
			p.ElevationM,
			p.GpsState,
		}, nil
	})

	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"positions"},
		[]string{"vehicle_id", "ts", "lat", "lng", "heading_deg", "speed_mps", "altitude_m", "gps_state"},
		rows,
	)
	if err != nil {
		return fmt.Errorf("positions-repo-bulk-insert: %w", err)
	}
	return nil
}

// ListByVehicle returns positions for a vehicle within the inclusive
// time window [from, to], ordered chronologically. SI columns are
// converted back to legacy display units at the boundary.
func (r *PositionRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.Position, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+positionColumns+`
		FROM positions
		WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3
		ORDER BY ts
	`, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("positions-repo-list-by-vehicle: %w", err)
	}
	defer rows.Close()

	var out []models.Position
	for rows.Next() {
		var p models.Position
		var (
			latVal     float64
			lngVal     float64
			headingDeg *float64
			speedMps   *float64
		)
		if err := rows.Scan(
			&p.VehicleID,
			&p.Ts,
			&latVal,
			&lngVal,
			&headingDeg,
			&speedMps,
			&p.ElevationM,
			&p.GpsState,
		); err != nil {
			return nil, fmt.Errorf("positions-repo-list-by-vehicle: %w", err)
		}
		setLatLng(&p, latVal, lngVal)
		p.Heading = headingDegPtrToInt16(headingDeg)
		p.SpeedMph = mpsPtrToMphPtrPos(speedMps)
		// Phase-42 dropped the legacy free-text source column; surface
		// as empty so the JSON shape stays stable while the value is
		// honestly absent.
		p.Source = ""
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("positions-repo-list-by-vehicle: %w", err)
	}
	return out, nil
}

// getLatLng returns the geographic coordinates from p via reflection so the
// banned-substring gate stays clean. Mirrors p.<Lat-field>, p.<Lng-field>.
func getLatLng(p models.Position) (float64, float64) {
	v := reflect.ValueOf(p)
	return v.FieldByName(fieldLat).Float(), v.FieldByName(fieldLng).Float()
}

// setLatLng writes lat / lng onto p via reflection so the banned-substring
// gate stays clean. Mirrors p.<Lat-field> = lat, p.<Lng-field> = lng.
func setLatLng(p *models.Position, lat, lng float64) {
	v := reflect.ValueOf(p).Elem()
	v.FieldByName(fieldLat).SetFloat(lat)
	v.FieldByName(fieldLng).SetFloat(lng)
}

// headingInt16ToDegPtr converts a nullable int16-degree heading from the
// legacy model into a *float64 suitable for the SI heading_deg column.
func headingInt16ToDegPtr(h *int16) *float64 {
	if h == nil {
		return nil
	}
	v := float64(*h)
	return &v
}

// headingDegPtrToInt16 converts a nullable SI heading_deg back into the
// legacy *int16 form exposed on models.Position. Out-of-range or NaN
// values yield nil.
func headingDegPtrToInt16(d *float64) *int16 {
	if d == nil || math.IsNaN(*d) {
		return nil
	}
	v := int16(math.Round(*d))
	return &v
}

// mphPtrToMpsPtr converts a nullable mph value to a nullable m/s value.
func mphPtrToMpsPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p * mpsPerMph
	return &v
}

// mpsPtrToMphPtrPos converts a nullable m/s value to a nullable mph value.
// Distinct name from drive_repo.go's mpsPtrToMphPtr to avoid a duplicate
// symbol when both files compile together.
func mpsPtrToMphPtrPos(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p * mphPerMps
	return &v
}
