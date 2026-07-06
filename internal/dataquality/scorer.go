// Package dataquality computes per-signal freshness, gap, and duplicate
// scores from signal_log + telemetry counters. Surfaced via
// /admin/observability/data-quality so operators can spot a degraded
// signal field before downstream consumers notice.
//
// Two primitives:
//
//   - Scorer queries signal_log via a narrow Querier interface and
//     produces a per-field FieldScore (freshness/gap/duplicate plus a
//     composite 0..100 quality score).
//   - LineageGraph reads routing.yaml at boot and exposes the static
//     pipeline graph (source field → router → writer → table) so the
//     SPA can render a Sankey/DAG that shows which tables a slow field
//     would impact.
//
// The package is read-only and side-effect free. Scorer queries are
// bounded by context timeout so a slow Postgres doesn't stall the
// admin dashboard.
package dataquality

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

// Querier is the narrow read interface the Scorer needs. Mirrors the
// pgxpool.Pool API surface used by every other read-only repo so the
// app can pass *database.DB.Pool directly.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
}

// Rows mirrors pgx.Rows with the minimal surface area we need.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}

// FieldScore is the per-signal quality summary returned by Scorer.
// Composite ranges 0..100 where 100 = perfect (zero gaps, no dupes,
// fresh < 60s). 0 = stale, gaps everywhere, every other sample is a
// duplicate of the previous.
type FieldScore struct {
	Field            string    `json:"field"`
	SampleCount      int64     `json:"sample_count"`
	LastSeenAt       time.Time `json:"last_seen_at"`
	FreshnessSeconds float64   `json:"freshness_seconds"`
	MaxGapSeconds    float64   `json:"max_gap_seconds"`
	DuplicateRatio   float64   `json:"duplicate_ratio"` // 0..1 fraction of consecutive samples whose value matches the previous
	CompositeScore   float64   `json:"composite_score"` // 0..100, higher = healthier
	Severity         string    `json:"severity"`        // ok | warn | critical
}

// Snapshot is the full board response.
type Snapshot struct {
	GeneratedAt time.Time    `json:"generated_at"`
	WindowMins  int          `json:"window_mins"`
	Fields      []FieldScore `json:"fields"`
}

// Scorer is the read-side primitive. Construct via NewScorer.
type Scorer struct {
	pool       Querier
	now        func() time.Time
	queryTime  time.Duration
	windowMins int
}

// NewScorer wires the scorer against a pgx pool. windowMins is the
// look-back window used by all per-field aggregates; default 60 when
// passed <=0.
func NewScorer(pool Querier, windowMins int) *Scorer {
	if windowMins <= 0 {
		windowMins = 60
	}
	return &Scorer{
		pool:       pool,
		now:        time.Now,
		queryTime:  10 * time.Second,
		windowMins: windowMins,
	}
}

// ErrNotConfigured is returned by Snapshot when the scorer was
// constructed without a pool — the admin handler surfaces this as 503
// SUBSYSTEM_NOT_CONFIGURED.
var ErrNotConfigured = errors.New("dataquality: signal_log pool not configured")

// Snapshot pulls the per-field score for every field that has shipped
// at least one sample in the configured window. Results are sorted by
// composite score ascending so the worst fields appear first.
func (s *Scorer) Snapshot(ctx context.Context) (*Snapshot, error) {
	if s == nil || s.pool == nil {
		return nil, ErrNotConfigured
	}
	qctx, cancel := context.WithTimeout(ctx, s.queryTime)
	defer cancel()

	// Composite query:
	//   - sample_count = number of rows in the window
	//   - last_seen = max(ts) in the window
	//   - max_gap_seconds = largest gap between consecutive ts
	//   - duplicate_ratio = fraction of rows where value_float =
	//     previous value_float (or value_text matches)
	//
	// All three derived columns ride a single window scan with
	// LAG() so the query stays O(N) per field. signal_log is
	// hypertable-partitioned by ts so the WHERE clause is chunk-
	// excluded.
	const query = `
WITH window_rows AS (
  SELECT field, ts,
         value_float,
         value_text,
         LAG(value_float) OVER (PARTITION BY field ORDER BY ts) AS prev_float,
         LAG(value_text)  OVER (PARTITION BY field ORDER BY ts) AS prev_text,
         LAG(ts)          OVER (PARTITION BY field ORDER BY ts) AS prev_ts
    FROM signal_log
   WHERE ts >= now() - ($1 || ' minutes')::interval
), agg AS (
  SELECT field,
         count(*) AS sample_count,
         max(ts)  AS last_seen,
         COALESCE(max(EXTRACT(EPOCH FROM (ts - prev_ts))), 0) AS max_gap_seconds,
         COALESCE(
           sum(CASE
                 WHEN prev_ts IS NULL THEN 0
                 WHEN value_float IS NOT NULL AND prev_float IS NOT NULL AND value_float = prev_float THEN 1
                 WHEN value_text IS NOT NULL AND prev_text IS NOT NULL AND value_text = prev_text THEN 1
                 ELSE 0
               END)::numeric / NULLIF(count(*) - 1, 0),
           0
         ) AS duplicate_ratio
    FROM window_rows
   GROUP BY field
)
SELECT field, sample_count, last_seen, max_gap_seconds, duplicate_ratio
  FROM agg
 ORDER BY field`

	rows, err := s.pool.Query(qctx, query, fmt.Sprintf("%d", s.windowMins))
	if err != nil {
		return nil, fmt.Errorf("signal_log score query: %w", err)
	}
	defer rows.Close()

	now := s.now()
	out := &Snapshot{
		GeneratedAt: now,
		WindowMins:  s.windowMins,
		Fields:      []FieldScore{},
	}
	for rows.Next() {
		var fs FieldScore
		if err := rows.Scan(&fs.Field, &fs.SampleCount, &fs.LastSeenAt, &fs.MaxGapSeconds, &fs.DuplicateRatio); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		fs.FreshnessSeconds = now.Sub(fs.LastSeenAt).Seconds()
		fs.CompositeScore = compositeScore(fs)
		fs.Severity = severity(fs)
		out.Fields = append(out.Fields, fs)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err: %w", err)
	}
	// Worst scores first.
	sort.Slice(out.Fields, func(i, j int) bool { return out.Fields[i].CompositeScore < out.Fields[j].CompositeScore })
	return out, nil
}

// compositeScore turns the three sub-scores into a single 0..100
// quality score. Each axis contributes a third; the contributions are
// independent so a field can be fresh but full of duplicates.
//
//   - freshness: 100 for <60s, decays linearly to 0 at >=600s
//   - gap:      100 for <30s max gap, linearly to 0 at >=300s
//   - duplicates: 100 for <1%, linearly to 0 at >=50%
func compositeScore(fs FieldScore) float64 {
	freshness := linearScore(fs.FreshnessSeconds, 60, 600)
	gap := linearScore(fs.MaxGapSeconds, 30, 300)
	dupe := linearScore(fs.DuplicateRatio*100, 1, 50)
	score := (freshness + gap + dupe) / 3
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

// linearScore returns 100 when x <= ok, 0 when x >= bad, and a linear
// interpolation between.
func linearScore(x, ok, bad float64) float64 {
	if x <= ok {
		return 100
	}
	if x >= bad {
		return 0
	}
	return 100 * (1 - (x-ok)/(bad-ok))
}

func severity(fs FieldScore) string {
	switch {
	case fs.CompositeScore >= 80:
		return "ok"
	case fs.CompositeScore >= 50:
		return "warn"
	default:
		return "critical"
	}
}
