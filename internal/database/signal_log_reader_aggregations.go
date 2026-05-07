package database

import (
	"context"
	"fmt"
	"time"
)

// DriveAggregates computes average speed, max speed, and average power during
// a time window from signal_log entries. Speed is filtered to >0 samples only
// for the average (excluding stationary readings). Power is computed from
// AVG(PackVoltage) × AVG(PackCurrent) / 1000.
//
// Phase-42 schema: ts/field/float_value/int_value (the legacy
// created_at/signal/value_num columns no longer exist). Numeric kinds in
// signal_log can be Float64 (kind=5) or Int64 (kind=4); the COALESCE
// resolves to whichever is populated for a given row.
func (r *SignalLogReader) DriveAggregates(ctx context.Context, vehicleID int64, from, to time.Time) (avgSpeed, maxSpeed, avgPower float64) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	const numCol = "COALESCE(float_value, int_value::float8)"
	query := `SELECT
		AVG(` + numCol + `) FILTER (WHERE field = 'VehicleSpeed' AND ` + numCol + ` > 0),
		MAX(` + numCol + `) FILTER (WHERE field = 'VehicleSpeed'),
		AVG(` + numCol + `) FILTER (WHERE field = 'PackCurrent'),
		AVG(` + numCol + `) FILTER (WHERE field = 'PackVoltage')
	FROM signal_log
	WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3
	  AND field IN ('VehicleSpeed', 'PackCurrent', 'PackVoltage')`

	var pAvgSpeed, pMaxSpeed, pAvgCurrent, pAvgVoltage *float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&pAvgSpeed, &pMaxSpeed, &pAvgCurrent, &pAvgVoltage,
	)
	if err != nil {
		return 0, 0, 0
	}
	if pAvgSpeed != nil {
		avgSpeed = *pAvgSpeed
	}
	if pMaxSpeed != nil {
		maxSpeed = *pMaxSpeed
	}
	if pAvgCurrent != nil && pAvgVoltage != nil {
		avgPower = (*pAvgVoltage) * (*pAvgCurrent) / 1000.0 // kW
	}
	return avgSpeed, maxSpeed, avgPower
}

// RegenEnergy estimates regenerative braking energy recovered during a time
// window. Uses negative PackCurrent samples (regen = charging the battery)
// paired with PackVoltage readings to compute approximate kWh.
//
// Falls back to 0 when no negative-current samples exist.
func (r *SignalLogReader) RegenEnergy(ctx context.Context, vehicleID int64, from, to time.Time) float64 {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	// Estimate regen energy: sum of (|negative current| × avg voltage) × avg sample interval.
	// We approximate by using AVG(|negative current|) × AVG(voltage) × duration.
	// More accurate would be per-sample integration, but this is sufficient for drive summary.
	//
	// Phase-42 schema: ts/field/float_value/int_value.
	const numCol = "COALESCE(float_value, int_value::float8)"
	query := `SELECT
		AVG(ABS(` + numCol + `)) FILTER (WHERE field = 'PackCurrent' AND ` + numCol + ` < 0),
		COUNT(*) FILTER (WHERE field = 'PackCurrent' AND ` + numCol + ` < 0),
		COUNT(*) FILTER (WHERE field = 'PackCurrent'),
		AVG(` + numCol + `) FILTER (WHERE field = 'PackVoltage')
	FROM signal_log
	WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3
	  AND field IN ('PackCurrent', 'PackVoltage')`

	var pAvgRegenCurrent *float64
	var regenCount, totalCount int64
	var pAvgVoltage *float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&pAvgRegenCurrent, &regenCount, &totalCount, &pAvgVoltage,
	)
	if err != nil || pAvgRegenCurrent == nil || pAvgVoltage == nil || totalCount == 0 {
		return 0
	}

	// Fraction of drive time spent in regen
	regenFraction := float64(regenCount) / float64(totalCount)
	durationHours := to.Sub(from).Hours()

	// Energy = avg_regen_current × avg_voltage × regen_time_fraction × duration / 1000
	kwh := (*pAvgRegenCurrent) * (*pAvgVoltage) * regenFraction * durationHours / 1000.0
	if kwh < 0 {
		kwh = 0
	}
	return kwh
}

// ChargeAggregates computes max and average charger power during a charge
// window. Checks both ACChargingPower and DCChargingPower, returns whichever
// is active (DC takes precedence when present).
//
// Phase-42 schema: ts/field/float_value/int_value.
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

	// DC takes precedence when present
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
// Phase-42 schema: ts/field/float_value (BrickVoltage* signals are
// ValueKindFloat so float_value is always populated; no COALESCE needed).
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
