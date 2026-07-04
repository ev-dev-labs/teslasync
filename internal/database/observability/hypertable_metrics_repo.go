package observability

// Disk-usage forecaster.
//
// HypertableMetricsRepo reads chunks_detailed_size and projects when
// each hypertable will hit a configurable disk quota. The projection
// is a simple linear regression over the last 30 days of chunk
// snapshots (i.e. growth_per_day = (current - 30d_ago) / 30); good
// enough for a 7-day operator warning and avoids importing a
// regression library.

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	"github.com/jackc/pgx/v5/pgconn"
)

// HypertableSize is the per-hypertable summary returned by Forecast.
type HypertableSize struct {
	HypertableName    string  `json:"hypertable_name"`
	TotalBytes        int64   `json:"total_bytes"`
	UncompressedBytes int64   `json:"uncompressed_bytes"`
	CompressedBytes   int64   `json:"compressed_bytes"`
	ChunkCount        int64   `json:"chunk_count"`
	GrowthBytesPerDay float64 `json:"growth_bytes_per_day"`
	EstDaysToQuota    *int    `json:"est_days_to_quota,omitempty"`
	Severity          string  `json:"severity"`
}

// HypertableMetricsRepo is the disk-usage read path.
type HypertableMetricsRepo struct {
	exec database.DBTX
}

// NewHypertableMetricsRepo constructs the repo. Returns nil when db
// is nil so the handler can degrade to a 503 cleanly.
func NewHypertableMetricsRepo(db *database.DB) *HypertableMetricsRepo {
	if db == nil || db.Pool == nil {
		return nil
	}
	return &HypertableMetricsRepo{exec: db.Pool}
}

// ErrTimescaleUnavailable is returned when the timescaledb extension
// is missing — i.e. an installation running on vanilla postgres.
var ErrTimescaleUnavailable = errors.New("timescaledb extension is not available")

// CurrentSizes returns the current per-hypertable size summary. Does
// NOT compute growth; that's Forecast's job (which calls this twice).
func (r *HypertableMetricsRepo) CurrentSizes(ctx context.Context) ([]HypertableSize, error) {
	if r == nil {
		return nil, nil
	}
	// hypertable_size() (Timescale 2.x) returns total bytes including
	// indexes/toast for the hypertable. Compression byte breakdown is
	// optionally pulled from hypertable_compression_stats — that
	// function returns NULL columns when no chunks are compressed,
	// which COALESCE folds to 0. The LEFT JOIN keeps the row even
	// when compression is disabled entirely.
	const sql = `
SELECT h.hypertable_name,
       COALESCE(hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass), 0)::bigint AS total_bytes,
       COALESCE(cs.before_compression_total_bytes, 0)::bigint AS uncompressed_bytes,
       COALESCE(cs.after_compression_total_bytes, 0)::bigint  AS compressed_bytes,
       COALESCE(cc.chunk_count, 0)::bigint AS chunk_count
  FROM timescaledb_information.hypertables h
  LEFT JOIN LATERAL hypertable_compression_stats(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) cs ON TRUE
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS chunk_count
          FROM timescaledb_information.chunks c
         WHERE c.hypertable_schema = h.hypertable_schema
           AND c.hypertable_name   = h.hypertable_name
       ) cc ON TRUE
 WHERE h.hypertable_schema = 'public'
 ORDER BY total_bytes DESC NULLS LAST`
	rows, err := r.exec.Query(ctx, sql)
	if err != nil {
		if isTimescaleMissing(err) {
			return nil, ErrTimescaleUnavailable
		}
		return nil, fmt.Errorf("hypertable_metrics: query: %w", err)
	}
	defer rows.Close()
	var out []HypertableSize
	for rows.Next() {
		var s HypertableSize
		if err := rows.Scan(&s.HypertableName, &s.TotalBytes,
			&s.UncompressedBytes, &s.CompressedBytes, &s.ChunkCount); err != nil {
			return nil, fmt.Errorf("hypertable_metrics: scan: %w", err)
		}
		out = append(out, s)
	}
	if out == nil {
		out = []HypertableSize{}
	}
	return out, rows.Err()
}

// Forecast projects when each hypertable will hit `quotaBytes`. It
// uses chunk-creation timestamps as the "size 30d ago" proxy: we sum
// the bytes of chunks whose range_end is older than 30d ago and treat
// that as the historical size. This avoids needing a stored
// time-series of total size.
func (r *HypertableMetricsRepo) Forecast(ctx context.Context, quotaBytes int64) ([]HypertableSize, error) {
	if r == nil {
		return nil, nil
	}
	sizes, err := r.CurrentSizes(ctx)
	if err != nil {
		return nil, err
	}

	thirtyDaysAgo := time.Now().Add(-30 * 24 * time.Hour)
	histBytes, err := r.bytesAtCutoff(ctx, thirtyDaysAgo)
	if err != nil && !errors.Is(err, ErrTimescaleUnavailable) {
		return nil, err
	}

	for i := range sizes {
		s := &sizes[i]
		prev := histBytes[s.HypertableName]
		delta := float64(s.TotalBytes - prev)
		if delta < 0 {
			delta = 0
		}
		s.GrowthBytesPerDay = delta / 30.0
		if quotaBytes > 0 && s.GrowthBytesPerDay > 0 && s.TotalBytes < quotaBytes {
			days := int(math.Round(float64(quotaBytes-s.TotalBytes) / s.GrowthBytesPerDay))
			s.EstDaysToQuota = &days
			switch {
			case days <= 7:
				s.Severity = "critical"
			case days <= 30:
				s.Severity = "warn"
			default:
				s.Severity = "ok"
			}
		} else if quotaBytes > 0 && s.TotalBytes >= quotaBytes {
			zero := 0
			s.EstDaysToQuota = &zero
			s.Severity = "critical"
		} else {
			s.Severity = "ok"
		}
	}
	return sizes, nil
}

// bytesAtCutoff returns the total per-hypertable bytes attributable
// to chunks whose range_end is BEFORE cutoff. This is the
// time-travel proxy for "size at that point in time".
//
// timescaledb_information.chunks exposes range_end + chunk relation
// path; pg_total_relation_size returns CURRENT bytes for that chunk.
// We accept the small inaccuracy that the per-chunk byte count is the
// current size (chunks are immutable in steady state, so this is
// usually exact for chunks closed >30d ago).
func (r *HypertableMetricsRepo) bytesAtCutoff(ctx context.Context, cutoff time.Time) (map[string]int64, error) {
	const sql = `
SELECT c.hypertable_name,
       COALESCE(SUM(pg_total_relation_size(format('%I.%I', c.chunk_schema, c.chunk_name)::regclass)), 0)::bigint
  FROM timescaledb_information.chunks c
 WHERE c.hypertable_schema = 'public'
   AND c.range_end < $1
 GROUP BY c.hypertable_name`
	rows, err := r.exec.Query(ctx, sql, cutoff)
	if err != nil {
		if isTimescaleMissing(err) {
			return nil, ErrTimescaleUnavailable
		}
		return nil, fmt.Errorf("hypertable_metrics: bytes_at_cutoff: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var name string
		var bytes int64
		if err := rows.Scan(&name, &bytes); err != nil {
			return nil, fmt.Errorf("hypertable_metrics: bytes_at_cutoff scan: %w", err)
		}
		out[name] = bytes
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hypertable_metrics: bytes_at_cutoff rows: %w", err)
	}
	return out, nil
}

// isTimescaleMissing maps the common pg errors that indicate the
// timescaledb extension is absent.
func isTimescaleMissing(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 42P01 = relation does not exist (e.g. timescaledb_information.*).
		// 42883 = function does not exist (e.g. chunks_detailed_size).
		// 42704 = undefined object.
		return pgErr.Code == "42P01" || pgErr.Code == "42883" || pgErr.Code == "42704"
	}
	return false
}
