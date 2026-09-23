package teslausage

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TeslaUsageBucketStart anchors daily rows at UTC midnight and weekly rows at
// UTC Monday midnight. It is independent of the fixed 30-day cycle anchor.
func TeslaUsageBucketStart(at time.Time, bucket string) time.Time {
	utc := at.UTC()
	day := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
	if bucket == "week" {
		daysFromMonday := (int(day.Weekday()) + 6) % 7
		return day.AddDate(0, 0, -daysFromMonday)
	}
	return day
}

// Series returns only observed UTC buckets inside [start,end). Empty periods
// outside the known history are not fabricated as zero-usage records. The
// caller validates bucket and range before this repository method is invoked.
func (r *TeslaUsageRepo) Series(ctx context.Context, start, end time.Time, bucket string, limit, offset int) (*models.TeslaUsageSeriesResponse, error) {
	acc := newTeslaUsageSeriesAccumulator(bucket)

	// Both sinks are outbound client callbacks; proxy responses require more
	// conservative attribution than direct Fleet API responses.
	rows, err := r.db.Pool.Query(ctx, `SELECT ts, service, http_method, endpoint, status_code FROM api_call_logs
		WHERE service IN ($1, $2) AND ts >= $3 AND ts < $4 AND status_code > 0 AND status_code < 500`,
		"tesla-api", "tesla-command-proxy", start, end)
	if err != nil {
		return nil, fmt.Errorf("read Tesla outbound usage series: %w", err)
	}
	if err := func() error {
		defer rows.Close()
		for rows.Next() {
			var ts time.Time
			var service, method, endpoint string
			var status int
			if err := rows.Scan(&ts, &service, &method, &endpoint, &status); err != nil {
				return fmt.Errorf("scan Tesla outbound usage series: %w", err)
			}
			acc.addRequest(ts, service, method, endpoint, status)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate Tesla outbound usage series: %w", err)
		}
		return nil
	}(); err != nil {
		return nil, err
	}

	// PostgreSQL date_trunc on timestamptz with the UTC timezone handles
	// weeks crossing calendar years and days crossing local DST boundaries.
	// Only the validated literal "day" or "week" is passed as $3.
	rows, err = r.db.Pool.Query(ctx, `SELECT date_trunc($3, received_at, 'UTC'), count(*)
		FROM tesla_stream_usage WHERE received_at >= $1 AND received_at < $2 GROUP BY 1`, start, end, bucket)
	if err != nil {
		return nil, fmt.Errorf("read Tesla signal usage series: %w", err)
	}
	if err := func() error {
		defer rows.Close()
		for rows.Next() {
			var at time.Time
			var count int64
			if err := rows.Scan(&at, &count); err != nil {
				return fmt.Errorf("scan Tesla signal usage series: %w", err)
			}
			acc.addSignals(at, count)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate Tesla signal usage series: %w", err)
		}
		return nil
	}(); err != nil {
		return nil, err
	}

	return acc.build(start, end, limit, offset), nil
}

type teslaUsageSeriesAccumulator struct {
	bucket string
	points map[time.Time]*models.TeslaUsagePoint
}

func newTeslaUsageSeriesAccumulator(bucket string) *teslaUsageSeriesAccumulator {
	return &teslaUsageSeriesAccumulator{bucket: bucket, points: make(map[time.Time]*models.TeslaUsagePoint)}
}

func (a *teslaUsageSeriesAccumulator) pointAt(at time.Time) *models.TeslaUsagePoint {
	key := TeslaUsageBucketStart(at, a.bucket)
	if point, exists := a.points[key]; exists {
		return point
	}
	point := &models.TeslaUsagePoint{BucketStart: key}
	a.points[key] = point
	return point
}

func (a *teslaUsageSeriesAccumulator) addRequest(ts time.Time, service, method, endpoint string, status int) {
	switch billableTeslaAudit(service, method, endpoint, status) {
	case "command":
		a.pointAt(ts).Commands++
	case "data":
		a.pointAt(ts).DataRequests++
	case "wake":
		a.pointAt(ts).Wakes++
	}
}

func (a *teslaUsageSeriesAccumulator) addSignals(ts time.Time, count int64) {
	if count > 0 {
		a.pointAt(ts).Signals += count
	}
}

func (a *teslaUsageSeriesAccumulator) build(start, end time.Time, limit, offset int) *models.TeslaUsageSeriesResponse {
	sorted := make([]time.Time, 0, len(a.points))
	for key := range a.points {
		sorted = append(sorted, key)
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Before(sorted[j]) })
	result := &models.TeslaUsageSeriesResponse{
		Start: start, End: end, Bucket: a.bucket,
		Total:  models.TeslaUsageCycle{Start: start, End: end},
		Points: []models.TeslaUsagePoint{},
	}
	for i, key := range sorted {
		point := a.points[key]
		point.EstimatedUSD = estimateTeslaUSD(models.TeslaUsageCycle{
			Signals: point.Signals, Commands: point.Commands,
			DataRequests: point.DataRequests, Wakes: point.Wakes,
		})
		result.Total.Signals += point.Signals
		result.Total.Commands += point.Commands
		result.Total.DataRequests += point.DataRequests
		result.Total.Wakes += point.Wakes
		if i >= offset && i < offset+limit {
			result.Points = append(result.Points, *point)
		}
	}
	result.Total.EstimatedUSD = estimateTeslaUSD(result.Total)
	return result
}
