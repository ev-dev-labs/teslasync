package signal

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	livestate "github.com/ev-dev-labs/teslasync/internal/signal"
)

const maxDrivePowerEvents = 200000

// DriveAggregates computes average speed, max speed, and average power during
// a time window from signal_log entries. Speed is filtered to >0 samples only
// for the average (excluding stationary readings). Power is the signed
// time-weighted mean of paired pack readings, returned in kW.
//
// signal_log stores numeric samples in float_value or int_value; the
// legacy created_at/signal/value_num columns no longer exist. COALESCE
// resolves whichever typed numeric column is populated for a row.
func (r *SignalLogReader) DriveAggregates(ctx context.Context, vehicleID int64, from, to time.Time) (avgSpeed, maxSpeed, avgPower float64) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	const numCol = "COALESCE(float_value, int_value::float8)"
	query := `SELECT
		AVG(` + numCol + `) FILTER (WHERE field = 'VehicleSpeed' AND ` + numCol + ` > 0),
		MAX(` + numCol + `) FILTER (WHERE field = 'VehicleSpeed')
	FROM signal_log
	WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3
	  AND field = 'VehicleSpeed'`

	var pAvgSpeed, pMaxSpeed *float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&pAvgSpeed, &pMaxSpeed,
	)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("drive speed aggregation failed")
		return 0, 0, 0
	}
	if pAvgSpeed != nil {
		avgSpeed = *pAvgSpeed
	}
	if pMaxSpeed != nil {
		maxSpeed = *pMaxSpeed
	}
	energy, err := r.DriveEnergy(ctx, vehicleID, from, to)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("drive power aggregation failed")
	} else if meanW, ok := energy.MeanPowerW(); ok {
		avgPower = meanW / 1000
	}
	return avgSpeed, maxSpeed, avgPower
}

// RegenEnergy integrates negative signed pack power over elapsed intervals,
// returning recovered kWh. A change-event count is never a duration estimate.
func (r *SignalLogReader) RegenEnergy(ctx context.Context, vehicleID int64, from, to time.Time) float64 {
	energy, err := r.DriveEnergy(ctx, vehicleID, from, to)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("drive recovered-energy aggregation failed")
		return 0
	}
	return energy.RegenWh / 1000
}

// DriveEnergy uses the canonical state reader to pair asynchronous voltage
// and current changes before integrating. Missing/invalid power is not zero.
func (r *SignalLogReader) DriveEnergy(ctx context.Context, vehicleID int64, from, to time.Time) (livestate.PowerIntegral, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	state := livestate.NewLogStateReader(r.db.Pool, log.Logger)
	seed, err := state.State(ctx, vehicleID, from)
	if err != nil {
		return livestate.PowerIntegral{}, fmt.Errorf("seed drive power: %w", err)
	}
	rows, err := state.Timeline(ctx, vehicleID, []livestate.FieldMapping{
		{Signal: "PackVoltage", Field: "voltage"},
		{Signal: "PackCurrent", Field: "current"},
	}, from, to, livestate.TimelineOptions{MaxEvents: maxDrivePowerEvents})
	if err != nil {
		return livestate.PowerIntegral{}, fmt.Errorf("read drive power intervals: %w", err)
	}
	pair := func(voltage, current any) *float64 {
		if _, ok := voltage.(bool); ok {
			return nil
		}
		if _, ok := current.(bool); ok {
			return nil
		}
		v, vok := livestate.Float64(voltage)
		c, cok := livestate.Float64(current)
		if !vok || !cok {
			return nil
		}
		w := v * c
		return &w
	}
	samples := make([]livestate.PowerSample, 0, len(rows)+1)
	samples = append(samples, livestate.PowerSample{Time: from, PowerW: pair(seed["PackVoltage"], seed["PackCurrent"])})
	for _, row := range rows {
		samples = append(samples, livestate.PowerSample{Time: row.Timestamp, PowerW: pair(row.Fields["voltage"], row.Fields["current"])})
	}
	return livestate.IntegratePower(samples, from, to), nil
}

// ChargeAggregates computes max and average charger power during a charge
// window. Checks both ACChargingPower and DCChargingPower, returns whichever
// is active (DC takes precedence when present).
//
// signal_log stores numeric samples in float_value or int_value.
func (r *SignalLogReader) ChargeAggregates(ctx context.Context, vehicleID int64, from, to time.Time) (maxPower, avgPower float64) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	const numCol = "COALESCE(float_value, int_value::float8)"
	query := `SELECT
		MAX(` + numCol + `) FILTER (WHERE field = 'ACChargingPower'),
		AVG(` + numCol + `) FILTER (WHERE field = 'ACChargingPower' AND ` + numCol + ` > 0),
		MAX(` + numCol + `) FILTER (WHERE field = 'DCChargingPower'),
		AVG(` + numCol + `) FILTER (WHERE field = 'DCChargingPower' AND ` + numCol + ` > 0)
	FROM signal_log
	WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3
	  AND field IN ('ACChargingPower', 'DCChargingPower')`

	var pACMax, pACAvg, pDCMax, pDCAvg *float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&pACMax, &pACAvg, &pDCMax, &pDCAvg,
	)
	if err != nil {
		return 0, 0
	}

	// DC takes precedence when both AC and DC samples are present.
	if pDCMax != nil && *pDCMax > 0 {
		maxPower = *pDCMax
		if pDCAvg != nil {
			avgPower = *pDCAvg
		}
		return maxPower, avgPower
	}
	if pACMax != nil {
		maxPower = *pACMax
	}
	if pACAvg != nil {
		avgPower = *pACAvg
	}
	return maxPower, avgPower
}

// IntegrateDriveDistanceMeters integrates SI VehicleSpeed samples (m/s)
// over [from, to] with the trapezoidal rule and returns meters.
//
// This is a fallback for drive completion when neither the in-memory
// odometer accumulator nor the snapshot odometer pair yields a positive
// distance, even though VehicleSpeed samples exist in signal_log.
//
// Callers must write the returned value through the SI-native distance_m
// partial-update field. Passing meters through the legacy distance_mi path
// would multiply the distance by 1609.344.
//
// The SQL uses CTEs because Postgres rejects LAG nested directly inside
// SUM. The 30-second cap skips telemetry gaps; otherwise a 5-minute gap at
// highway speed would fabricate miles of phantom travel.
//
// Returns 0, nil when the window has fewer than two samples. Returns 0,
// err on query failure so the caller can log and continue with distance_m=0.
func (r *SignalLogReader) IntegrateDriveDistanceMeters(ctx context.Context, vehicleID int64, from, to time.Time) (float64, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	const numCol = "COALESCE(float_value, int_value::float8)"
	query := `
		WITH samples AS (
			SELECT ts, ` + numCol + ` AS speed_mps
			FROM signal_log
			WHERE vehicle_id = $1
			  AND ts >= $2
			  AND ts <= $3
			  AND field = 'VehicleSpeed'
			  AND ` + numCol + ` IS NOT NULL
			ORDER BY ts
		), pairs AS (
			SELECT
				speed_mps,
				LAG(speed_mps) OVER (ORDER BY ts) AS prev_speed,
				EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) AS dt_sec
			FROM samples
		)
		SELECT COALESCE(SUM(((speed_mps + prev_speed) * 0.5) * dt_sec) FILTER (
			WHERE prev_speed IS NOT NULL AND dt_sec > 0 AND dt_sec <= 30
		), 0)::DOUBLE PRECISION
		FROM pairs`

	var meters float64
	if err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(&meters); err != nil {
		return 0, fmt.Errorf("integrate drive distance for vehicle %d: %w", vehicleID, err)
	}
	if meters < 0 {
		// Speed should never be negative but guard against bad data.
		meters = 0
	}
	return meters, nil
}

// DriveEndpoints holds the first and last GPS fix recorded inside a drive's
// time window. Either side is nil when the window holds no usable fix.
type DriveEndpoints struct {
	StartLat, StartLon *float64
	EndLat, EndLon     *float64
}

// DriveEndpointCoordinates returns the earliest and latest GPS fix in a drive's
// window, read from the same signal_log rows the route map is drawn from.
//
// It exists because a drive's stored start_lat/end_lat cannot be trusted. When
// the boundary moment carries no Location sample, completion falls back to a
// point-in-time snapshot that can resolve to the same fix for both ends, so the
// row lands with end_lat/end_lng equal to start_lat/start_lng. The route map
// hides that — it renders the track, not the stored endpoints — but the place
// labels are geocoded from the stored columns, so both ends of a many-mile
// drive resolve to one address and Journey Details shows an identical Start and
// Destination.
//
// Latitude and longitude arrive as two separate signal_log rows sharing one
// timestamp, so they are pivoted per ts and only complete pairs are considered.
// A (0,0) fix is treated as absent: it is the null-island placeholder written
// when a decoder yields no position, never a real driven location.
func (r *SignalLogReader) DriveEndpointCoordinates(ctx context.Context, vehicleID int64, from, to time.Time) (*DriveEndpoints, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	const numCol = "COALESCE(float_value, int_value::float8)"
	query := `
		WITH fixes AS (
			SELECT ts,
			       MAX(` + numCol + `) FILTER (WHERE field = 'LocationLatitude')  AS lat,
			       MAX(` + numCol + `) FILTER (WHERE field = 'LocationLongitude') AS lon
			FROM signal_log
			WHERE vehicle_id = $1
			  AND ts >= $2
			  AND ts <= $3
			  AND field IN ('LocationLatitude', 'LocationLongitude')
			GROUP BY ts
		), valid AS (
			SELECT ts, lat, lon FROM fixes
			WHERE lat IS NOT NULL AND lon IS NOT NULL
			  AND NOT (lat = 0 AND lon = 0)
		)
		SELECT
			(SELECT lat FROM valid ORDER BY ts ASC  LIMIT 1),
			(SELECT lon FROM valid ORDER BY ts ASC  LIMIT 1),
			(SELECT lat FROM valid ORDER BY ts DESC LIMIT 1),
			(SELECT lon FROM valid ORDER BY ts DESC LIMIT 1)`

	e := &DriveEndpoints{}
	if err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&e.StartLat, &e.StartLon, &e.EndLat, &e.EndLon,
	); err != nil {
		return nil, fmt.Errorf("drive endpoint coordinates for vehicle %d: %w", vehicleID, err)
	}
	return e, nil
}

// BrickVoltageHistoryEntry represents one hourly-bucketed row of brick voltage data.
type BrickVoltageHistoryEntry struct {
	Bucket     time.Time
	MinVoltage *float64
	MaxVoltage *float64
	AvgMax     *float64
	AvgMin     *float64
}

// BrickVoltageHistory returns hourly brick voltage aggregates from signal_log
// for the given vehicle since the provided timestamp.
//
// BrickVoltage* signals are ValueKindFloat, so float_value is always
// populated and no COALESCE is needed.
func (r *SignalLogReader) BrickVoltageHistory(ctx context.Context, vehicleID int64, since time.Time) ([]BrickVoltageHistoryEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT
		time_bucket('1 hour', ts) AS bucket,
		MIN(float_value) FILTER (WHERE field = 'BrickVoltageMin') AS min_voltage,
		MAX(float_value) FILTER (WHERE field = 'BrickVoltageMax') AS max_voltage,
		AVG(float_value) FILTER (WHERE field = 'BrickVoltageMax') AS avg_max,
		AVG(float_value) FILTER (WHERE field = 'BrickVoltageMin') AS avg_min
	FROM signal_log
	WHERE vehicle_id = $1
	  AND field IN ('BrickVoltageMin', 'BrickVoltageMax')
	  AND ts >= $2
	GROUP BY bucket
	ORDER BY bucket`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, since)
	if err != nil {
		return nil, fmt.Errorf("brick voltage history for vehicle %d: %w", vehicleID, err)
	}
	defer rows.Close()

	var entries []BrickVoltageHistoryEntry
	for rows.Next() {
		var e BrickVoltageHistoryEntry
		if err := rows.Scan(&e.Bucket, &e.MinVoltage, &e.MaxVoltage, &e.AvgMax, &e.AvgMin); err != nil {
			return nil, fmt.Errorf("brick voltage history scan: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []BrickVoltageHistoryEntry{}
	}
	return entries, nil
}
