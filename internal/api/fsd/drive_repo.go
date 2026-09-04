package fsd

import (
	"context"
	"fmt"
	"time"
)

const analyticsCounterSamplesSQL = `
WITH baseline AS (
    SELECT DISTINCT ON (field)
           field,
           ts,
           COALESCE(float_value, int_value::float8) AS value,
           normalization_version
      FROM signal_log
     WHERE vehicle_id = $1
       AND field = ANY($2)
       AND ts < $3
     ORDER BY field, ts DESC
),
raw_values AS (
    SELECT field,
           ts,
           COALESCE(float_value, int_value::float8) AS value,
           normalization_version
      FROM signal_log
     WHERE vehicle_id = $1
       AND field = ANY($2)
       AND ts >= $3
       AND ts < $5
),
timestamped AS (
    SELECT *,
           COUNT(*) OVER (PARTITION BY ts) = 2 AS paired_at
      FROM raw_values
),
bucketed AS (
    SELECT *,
           CASE WHEN ts < $4 THEN 0 ELSE 1 END AS period_side,
           date_bin(
               INTERVAL '1 minute',
               ts,
               TIMESTAMPTZ '2001-01-01 00:00:00+00'
           ) AS sample_bucket,
           (
               normalization_version IS NULL
               OR normalization_version < $6
               OR value IS NULL
               OR value < 0
               OR value IN (
                   'NaN'::double precision,
                   'Infinity'::double precision,
                   '-Infinity'::double precision
               )
           ) AS continuity_barrier,
           (
               normalization_version >= $6
               AND value >= 0
               AND value NOT IN (
                   'NaN'::double precision,
                   'Infinity'::double precision,
                   '-Infinity'::double precision
               )
           ) AS trusted_valid,
           (
               normalization_version >= $6
               AND (
                   value IS NULL
                   OR value < 0
                   OR value IN (
                       'NaN'::double precision,
                       'Infinity'::double precision,
                       '-Infinity'::double precision
                   )
               )
           ) AS trusted_invalid
      FROM timestamped
),
annotated AS (
    SELECT *,
           LAG(value) OVER field_order AS previous_value,
           LEAD(value) OVER field_order AS next_value,
           LAG(continuity_barrier, 1, FALSE) OVER field_order AS previous_barrier,
           LEAD(continuity_barrier, 1, FALSE) OVER field_order AS next_barrier,
           MIN(ts) OVER bucket_partition AS bucket_first_at,
           MAX(ts) OVER bucket_partition AS bucket_last_at,
           MIN(ts) FILTER (
               WHERE paired_at
           ) OVER timestamp_bucket_partition AS paired_bucket_first_at,
           MAX(ts) FILTER (
               WHERE paired_at
           ) OVER timestamp_bucket_partition AS paired_bucket_last_at,
           COUNT(*) FILTER (
               WHERE trusted_valid
           ) OVER bucket_partition AS valid_observation_count,
           COUNT(*) FILTER (
               WHERE trusted_invalid
           ) OVER bucket_partition AS invalid_observation_count,
           COUNT(*) FILTER (
               WHERE normalization_version IS NULL
                  OR normalization_version < $6
           ) OVER bucket_partition AS untrusted_observation_count,
           MIN(ts) FILTER (
               WHERE trusted_valid
           ) OVER bucket_partition AS first_valid_observation_at,
           MAX(ts) FILTER (
               WHERE trusted_valid
           ) OVER bucket_partition AS last_valid_observation_at
      FROM bucketed
    WINDOW
        field_order AS (PARTITION BY field, period_side ORDER BY ts ASC),
        bucket_partition AS (PARTITION BY field, period_side, sample_bucket),
         timestamp_bucket_partition AS (PARTITION BY period_side, sample_bucket)
),
selected_timestamps AS (
    SELECT DISTINCT ts
       FROM annotated
      WHERE ts = bucket_first_at
         OR ts = bucket_last_at
         OR ts = paired_bucket_first_at
         OR ts = paired_bucket_last_at
         OR previous_value IS NULL
         OR continuity_barrier
         OR previous_barrier
         OR next_barrier
        OR (
            field = $7
            AND (
                value IS DISTINCT FROM previous_value
                OR value IS DISTINCT FROM next_value
            )
        )
        OR value < previous_value
        OR next_value < value
),
range_samples AS (
    SELECT annotated.field,
           annotated.ts,
           annotated.value,
           annotated.normalization_version,
           TRUE AS compacted,
           CASE WHEN ts = bucket_last_at THEN valid_observation_count ELSE 0 END
               AS valid_observation_count,
           CASE WHEN ts = bucket_last_at THEN invalid_observation_count ELSE 0 END
               AS invalid_observation_count,
           CASE WHEN ts = bucket_last_at THEN untrusted_observation_count ELSE 0 END
               AS untrusted_observation_count,
           CASE WHEN ts = bucket_last_at THEN first_valid_observation_at END
               AS first_valid_observation_at,
           CASE WHEN ts = bucket_last_at THEN last_valid_observation_at END
               AS last_valid_observation_at
      FROM annotated
      JOIN selected_timestamps USING (ts)
)
SELECT field,
       ts,
       value,
       normalization_version,
       FALSE AS compacted,
       0 AS valid_observation_count,
       0 AS invalid_observation_count,
       0 AS untrusted_observation_count,
       NULL::timestamptz AS first_valid_observation_at,
       NULL::timestamptz AS last_valid_observation_at
  FROM baseline
UNION ALL
SELECT field,
       ts,
       value,
       normalization_version,
       compacted,
       valid_observation_count,
       invalid_observation_count,
       untrusted_observation_count,
       first_valid_observation_at,
       last_valid_observation_at
  FROM range_samples
 ORDER BY ts ASC, field ASC`

const analyticsDrivesSQL = `
SELECT id,
       started_at,
       ended_at,
       NULLIF(BTRIM(start_place), ''),
       NULLIF(BTRIM(end_place), ''),
       start_geofence_id,
       end_geofence_id,
       distance_m,
       energy_used_wh
  FROM drives
 WHERE vehicle_id = $1
   AND started_at < $3
   AND COALESCE(ended_at, $3) > $2
 ORDER BY started_at ASC, id ASC`

const analyticsVersionSamplesSQL = `
WITH baseline AS (
    SELECT ts, str_value, normalization_version
      FROM signal_log
     WHERE vehicle_id = $1
       AND field = 'Version'
       AND ts < $2
     ORDER BY ts DESC
     LIMIT 1
),
range_samples AS (
    SELECT ts, str_value, normalization_version
      FROM signal_log
     WHERE vehicle_id = $1
       AND field = 'Version'
       AND ts >= $2
       AND ts < $3
)
SELECT ts, str_value, normalization_version FROM baseline
UNION ALL
SELECT ts, str_value, normalization_version FROM range_samples
ORDER BY ts ASC`

// LoadAnalyticsInput loads a bounded range in three set-based queries. The
// raw synchronized counter feed is compacted to one snapshot per minute while
// preserving every barrier, reset, FSD value change, and exact quality count.
// No query is issued per drive.
func (r *Repo) LoadAnalyticsInput(
	ctx context.Context,
	vehicleID int64,
	from, split, to time.Time,
) (AnalyticsInput, error) {
	input := AnalyticsInput{
		PreviousCounterSamples: make([]Sample, 0),
		CounterSamples:         make([]Sample, 0),
		VersionSamples:         make([]VersionSample, 0),
		Drives:                 make([]DriveRecord, 0),
	}
	if r == nil || r.pool == nil {
		return input, fmt.Errorf("load FSD analytics for vehicle %d: database pool is nil", vehicleID)
	}

	fields := counterFields()
	counterRows, err := r.pool.Query(
		ctx,
		analyticsCounterSamplesSQL,
		vehicleID,
		fields,
		from,
		split,
		to,
		trustedSignalLogNormalizationVersion,
		SignalFSDDistance,
	)
	if err != nil {
		return input, fmt.Errorf("query FSD analytics counters for vehicle %d: %w", vehicleID, err)
	}
	currentBaselines := make(map[string]Sample, len(fields))
	currentInitialized := false
	for counterRows.Next() {
		var sample Sample
		if err := counterRows.Scan(
			&sample.Field,
			&sample.TS,
			&sample.Value,
			&sample.NormalizationVersion,
			&sample.Compacted,
			&sample.ValidObservationCount,
			&sample.InvalidObservationCount,
			&sample.UntrustedObservationCount,
			&sample.FirstValidObservationAt,
			&sample.LastValidObservationAt,
		); err != nil {
			counterRows.Close()
			return input, fmt.Errorf("scan FSD analytics counter for vehicle %d: %w", vehicleID, err)
		}
		if sample.TS.Before(split) {
			input.PreviousCounterSamples = append(input.PreviousCounterSamples, sample)
			currentBaselines[sample.Field] = sample
			continue
		}
		if !currentInitialized {
			estimatedCurrentRows := min(max(len(input.PreviousCounterSamples), 64), 4096)
			input.CounterSamples = make(
				[]Sample,
				len(fields),
				len(fields)+estimatedCurrentRows,
			)
			currentInitialized = true
		}
		input.CounterSamples = append(input.CounterSamples, sample)
	}
	if err := counterRows.Err(); err != nil {
		counterRows.Close()
		return input, fmt.Errorf("iterate FSD analytics counters for vehicle %d: %w", vehicleID, err)
	}
	counterRows.Close()
	if !currentInitialized {
		input.CounterSamples = make([]Sample, len(fields))
	}
	baselineCount := 0
	for _, field := range fields {
		if baseline, ok := currentBaselines[field]; ok {
			input.CounterSamples[baselineCount] = baseline
			baselineCount++
		}
	}
	rangeCount := len(input.CounterSamples) - len(fields)
	if baselineCount != len(fields) && rangeCount > 0 {
		copy(
			input.CounterSamples[baselineCount:baselineCount+rangeCount],
			input.CounterSamples[len(fields):],
		)
	}
	input.CounterSamples = input.CounterSamples[:baselineCount+rangeCount]

	driveRows, err := r.pool.Query(ctx, analyticsDrivesSQL, vehicleID, from, to)
	if err != nil {
		return input, fmt.Errorf("query FSD analytics drives for vehicle %d: %w", vehicleID, err)
	}
	for driveRows.Next() {
		var drive DriveRecord
		if err := driveRows.Scan(
			&drive.ID,
			&drive.StartedAt,
			&drive.EndedAt,
			&drive.StartPlace,
			&drive.EndPlace,
			&drive.StartGeofenceID,
			&drive.EndGeofenceID,
			&drive.DistanceM,
			&drive.EnergyUsedWh,
		); err != nil {
			driveRows.Close()
			return input, fmt.Errorf("scan FSD analytics drive for vehicle %d: %w", vehicleID, err)
		}
		input.Drives = append(input.Drives, drive)
	}
	if err := driveRows.Err(); err != nil {
		driveRows.Close()
		return input, fmt.Errorf("iterate FSD analytics drives for vehicle %d: %w", vehicleID, err)
	}
	driveRows.Close()

	versionRows, err := r.pool.Query(
		ctx,
		analyticsVersionSamplesSQL,
		vehicleID,
		split,
		to,
	)
	if err != nil {
		return input, fmt.Errorf("query FSD analytics firmware for vehicle %d: %w", vehicleID, err)
	}
	for versionRows.Next() {
		var sample VersionSample
		var version *string
		if err := versionRows.Scan(
			&sample.TS,
			&version,
			&sample.NormalizationVersion,
		); err != nil {
			versionRows.Close()
			return input, fmt.Errorf("scan FSD analytics firmware for vehicle %d: %w", vehicleID, err)
		}
		if version != nil {
			sample.Version = *version
		}
		input.VersionSamples = append(input.VersionSamples, sample)
	}
	if err := versionRows.Err(); err != nil {
		versionRows.Close()
		return input, fmt.Errorf("iterate FSD analytics firmware for vehicle %d: %w", vehicleID, err)
	}
	versionRows.Close()

	return input, nil
}
