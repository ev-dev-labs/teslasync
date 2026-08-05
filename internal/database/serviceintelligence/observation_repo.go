package serviceintelligence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

const (
	minObservationSamples = 12
	minObservationZScore  = 3.0
)

const recentObservationsQuery = `
WITH bounded AS (
	SELECT
		field,
		ts,
		COALESCE(float_value, int_value::double precision) AS value
	FROM signal_log
	WHERE vehicle_id = $1
	  AND ts >= $2
	  AND ts <= $3
	  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
),
stats AS (
	SELECT
		field,
		AVG(value) AS mean,
		STDDEV_SAMP(value) AS stddev,
		COUNT(*) AS sample_count
	FROM bounded
	GROUP BY field
	HAVING COUNT(*) >= $4
	   AND STDDEV_SAMP(value) > 0
),
ranked AS (
	SELECT
		b.field,
		b.value,
		s.mean,
		ABS(b.value - s.mean) / s.stddev AS deviation,
		s.sample_count,
		b.ts,
		ROW_NUMBER() OVER (
			PARTITION BY b.field
			ORDER BY ABS(b.value - s.mean) / s.stddev DESC, b.ts DESC
		) AS rank
	FROM bounded b
	JOIN stats s ON s.field = b.field
)
SELECT field, value, mean, deviation, sample_count, ts
FROM ranked
WHERE rank = 1
  AND deviation >= $5
ORDER BY deviation DESC, ts DESC
LIMIT $6`

// Observation is a bounded aggregate over signal_log change events. It is
// evidence for service applicability review, not reconstructed vehicle state.
type Observation struct {
	Signal      string
	Value       float64
	Baseline    float64
	Deviation   float64
	SampleCount int
	ObservedAt  time.Time
}

// ObservationRepo owns the service-intelligence change-feed aggregation.
type ObservationRepo struct {
	q database.DBTX
}

func NewObservationRepo(db *database.DB) *ObservationRepo {
	if db == nil || db.Pool == nil {
		panic("serviceintelligence.NewObservationRepo: db and db.Pool must not be nil")
	}
	return &ObservationRepo{q: db.Pool}
}

func (r *ObservationRepo) RecentObservations(
	ctx context.Context,
	vehicleID int64,
	start, end time.Time,
	limit int,
) ([]Observation, error) {
	if r == nil || r.q == nil {
		return nil, errors.New("service intelligence observation repo is not configured")
	}
	if vehicleID <= 0 || start.IsZero() || end.IsZero() || !start.Before(end) || limit <= 0 {
		return nil, errors.New("invalid service intelligence observation query")
	}

	rows, err := r.q.Query(
		ctx,
		recentObservationsQuery,
		vehicleID,
		start.UTC(),
		end.UTC(),
		minObservationSamples,
		minObservationZScore,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query service observations for vehicle %d: %w", vehicleID, err)
	}
	defer rows.Close()

	observations := make([]Observation, 0, limit)
	for rows.Next() {
		var observation Observation
		if err := rows.Scan(
			&observation.Signal,
			&observation.Value,
			&observation.Baseline,
			&observation.Deviation,
			&observation.SampleCount,
			&observation.ObservedAt,
		); err != nil {
			return nil, fmt.Errorf("scan service observation for vehicle %d: %w", vehicleID, err)
		}
		observations = append(observations, observation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate service observations for vehicle %d: %w", vehicleID, err)
	}
	return observations, nil
}
