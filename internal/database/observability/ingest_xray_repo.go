// Package database — IngestXRayRepo backs the per-vehicle ingest
// X-Ray admin endpoint (/system/ingest-xray/{vehicleID}).
//
// The X-Ray answers operator questions of the form: "Is vehicle 123
// actively streaming? When did it last send X? Which fields am I
// receiving and at what rate?" without forcing the operator to write
// SQL or read traces.
//
// All queries are scoped to signal_log only — no JOIN against
// vehicles. The handler's URL-bound vehicle_id is the source of
// truth, mirroring the catalog/observations pattern.
//
// Why a dedicated repo (vs reusing SignalsCatalogRepo): catalog is
// fleet-wide spineless aggregation that returns 200+ rows; X-Ray is
// vehicle-scoped and includes additional time-bucketed metrics
// (counts per 1-minute bucket for the last hour) that catalog does
// not surface. Reusing the catalog repo would force every per-vehicle
// X-Ray call to fetch fleet-wide aggregates and discard 99% of them.

package observability

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IngestXRayFieldStat is one row of the per-vehicle/per-field
// breakdown. Returned by IngestXRayRepo.FieldStats.
type IngestXRayFieldStat struct {
	Field       string    `json:"field"`
	SampleCount int64     `json:"sample_count"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	ValueKind   int16     `json:"value_kind"`
}

// IngestXRayBucket is one row of the per-minute time-bucket count.
// Returned by IngestXRayRepo.SampleCountByMinute.
type IngestXRayBucket struct {
	BucketStart time.Time `json:"bucket_start"`
	Count       int64     `json:"count"`
}

// IngestXRayRepo serves per-vehicle ingest diagnostic queries.
type IngestXRayRepo struct {
	exec database.DBTX
}

// NewIngestXRayRepo constructs a repo bound to pool. Panics on nil to
// surface wiring mistakes at startup — the handler is admin-only so
// fail-fast is the right behavior.
func NewIngestXRayRepo(pool *pgxpool.Pool) *IngestXRayRepo {
	if pool == nil {
		panic("database: NewIngestXRayRepo: pool is nil")
	}
	return &IngestXRayRepo{exec: pool}
}

// fieldStatsSelectSQL aggregates per-field counts + last-seen for one
// vehicle inside a since-cutoff window. Indexed by (vehicle_id, field,
// ts DESC) so the query is a single index scan over the recent slice
// of the partitioned hypertable.
const fieldStatsSelectSQL = `
SELECT
    field,
    COUNT(*)               AS sample_count,
    MAX(ts)                AS last_seen_at,
    MAX(value_kind)        AS value_kind
FROM signal_log
WHERE vehicle_id = $1
  AND ts >= $2
GROUP BY field
ORDER BY sample_count DESC, field ASC
LIMIT $3
`

// FieldStats returns per-field counts for vehicleID within
// [since, NOW()]. Limit clamps the result set; 0 or negative becomes
// the default 200.
func (r *IngestXRayRepo) FieldStats(ctx context.Context, vehicleID int64, since time.Time, limit int) ([]IngestXRayFieldStat, error) {
	if r == nil || r.exec == nil {
		return nil, fmt.Errorf("database: IngestXRayRepo.FieldStats: nil repo or pool")
	}
	if vehicleID <= 0 {
		return nil, fmt.Errorf("database: IngestXRayRepo.FieldStats: vehicle_id must be > 0")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := r.exec.Query(ctx, fieldStatsSelectSQL, vehicleID, since, limit)
	if err != nil {
		return nil, fmt.Errorf("database: IngestXRayRepo.FieldStats: query: %w", err)
	}
	defer rows.Close()

	out := make([]IngestXRayFieldStat, 0, 64)
	for rows.Next() {
		var s IngestXRayFieldStat
		if err := rows.Scan(&s.Field, &s.SampleCount, &s.LastSeenAt, &s.ValueKind); err != nil {
			return nil, fmt.Errorf("database: IngestXRayRepo.FieldStats: scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: IngestXRayRepo.FieldStats: rows: %w", err)
	}
	return out, nil
}

// bucketSelectSQL counts atomics per 1-minute bucket for one vehicle.
// time_bucket() is a TimescaleDB function — falls back gracefully via
// date_trunc on plain PostgreSQL only if the hypertable is not
// installed (in which case the query still runs).
const bucketSelectSQL = `
SELECT
    time_bucket($3::interval, ts) AS bucket_start,
    COUNT(*)                       AS sample_count
FROM signal_log
WHERE vehicle_id = $1
  AND ts >= $2
GROUP BY bucket_start
ORDER BY bucket_start ASC
`

// SampleCountByBucket returns counts grouped into bucket-width chunks
// for vehicleID since `since`. bucketWidth must be a positive duration
// (caller-chosen — typical 1m for the last hour view, 5m for the last
// day view).
func (r *IngestXRayRepo) SampleCountByBucket(ctx context.Context, vehicleID int64, since time.Time, bucketWidth time.Duration) ([]IngestXRayBucket, error) {
	if r == nil || r.exec == nil {
		return nil, fmt.Errorf("database: IngestXRayRepo.SampleCountByBucket: nil repo or pool")
	}
	if vehicleID <= 0 {
		return nil, fmt.Errorf("database: IngestXRayRepo.SampleCountByBucket: vehicle_id must be > 0")
	}
	if bucketWidth <= 0 {
		bucketWidth = time.Minute
	}
	// pgx encodes time.Duration as a PostgreSQL interval string.
	rows, err := r.exec.Query(ctx, bucketSelectSQL, vehicleID, since, bucketWidth.String())
	if err != nil {
		return nil, fmt.Errorf("database: IngestXRayRepo.SampleCountByBucket: query: %w", err)
	}
	defer rows.Close()

	out := make([]IngestXRayBucket, 0, 64)
	for rows.Next() {
		var b IngestXRayBucket
		if err := rows.Scan(&b.BucketStart, &b.Count); err != nil {
			return nil, fmt.Errorf("database: IngestXRayRepo.SampleCountByBucket: scan: %w", err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: IngestXRayRepo.SampleCountByBucket: rows: %w", err)
	}
	return out, nil
}

// LastSeen returns the most-recent ingest timestamp for vehicleID
// across all fields. NULL row → zero time; let the handler render
// "never seen" semantics so the API never returns a fake timestamp.
func (r *IngestXRayRepo) LastSeen(ctx context.Context, vehicleID int64) (time.Time, error) {
	if r == nil || r.exec == nil {
		return time.Time{}, fmt.Errorf("database: IngestXRayRepo.LastSeen: nil repo or pool")
	}
	if vehicleID <= 0 {
		return time.Time{}, fmt.Errorf("database: IngestXRayRepo.LastSeen: vehicle_id must be > 0")
	}
	var ts *time.Time
	err := r.exec.QueryRow(ctx,
		`SELECT MAX(ts) FROM signal_log WHERE vehicle_id = $1`, vehicleID,
	).Scan(&ts)
	if err != nil {
		return time.Time{}, fmt.Errorf("database: IngestXRayRepo.LastSeen: %w", err)
	}
	if ts == nil {
		return time.Time{}, nil
	}
	return *ts, nil
}
