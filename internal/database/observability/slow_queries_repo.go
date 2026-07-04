package observability

// Slow query collection reads pg_stat_statements and snapshots.
//
// SlowQueriesRepo wraps two paths into pg_stat_statements + the
// historical slow_query_snapshot table (mig 000212). The live path
// returns the current top-N by mean_exec_time or total_exec_time;
// the historical path returns the 5-min snapshots so an operator
// can see "was query X slow yesterday?".
//
// All methods degrade gracefully when pg_stat_statements is not
// installed: TopLive returns ErrPgStatStatementsUnavailable and the
// admin handler maps that to a 503 with a clear message rather than
// a 500. The historical path is unaffected by the extension being
// absent (the worker simply writes no new snapshots).

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrPgStatStatementsUnavailable is returned by TopLive when the
// extension is missing or the role lacks pg_read_all_stats.
var ErrPgStatStatementsUnavailable = errors.New("pg_stat_statements extension is not available")

// SlowQuery is the wire shape for both live and historical results.
type SlowQuery struct {
	QueryID        int64   `json:"query_id"`
	Fingerprint    string  `json:"fingerprint"`
	Calls          int64   `json:"calls"`
	TotalTimeMs    float64 `json:"total_time_ms"`
	MeanTimeMs     float64 `json:"mean_time_ms"`
	MaxTimeMs      float64 `json:"max_time_ms"`
	RowsReturned   int64   `json:"rows_returned"`
	SharedBlksHit  *int64  `json:"shared_blks_hit,omitempty"`
	SharedBlksRead *int64  `json:"shared_blks_read,omitempty"`
}

// SlowQueriesRepo is the read+snapshot path for slow query analytics.
type SlowQueriesRepo struct {
	exec database.DBTX
}

// NewSlowQueriesRepo constructs the repo. Returns nil when db is nil.
func NewSlowQueriesRepo(db *database.DB) *SlowQueriesRepo {
	if db == nil || db.Pool == nil {
		return nil
	}
	return &SlowQueriesRepo{exec: db.Pool}
}

// OrderBy is the canonical sort key for TopLive. A future TopSnapshot
// (planned but not implemented) will accept the same enum; for now
// the snapshot-side ordering is handled by HistoricalForQuery's
// (queryid, ts DESC) index.
type SlowQueryOrderBy string

const (
	OrderByMeanTime  SlowQueryOrderBy = "mean_time"
	OrderByTotalTime SlowQueryOrderBy = "total_time"
	OrderByCalls     SlowQueryOrderBy = "calls"
)

// Validate returns nil for known values.
func (o SlowQueryOrderBy) Validate() error {
	switch o {
	case OrderByMeanTime, OrderByTotalTime, OrderByCalls:
		return nil
	default:
		return fmt.Errorf("unknown order_by %q", o)
	}
}

func orderByColumnLive(o SlowQueryOrderBy) string {
	switch o {
	case OrderByMeanTime:
		return "mean_exec_time"
	case OrderByTotalTime:
		return "total_exec_time"
	case OrderByCalls:
		return "calls"
	default:
		return "mean_exec_time"
	}
}

// TopLive queries pg_stat_statements directly. limit is clamped to
// [1, 200]. Returns ErrPgStatStatementsUnavailable when the
// extension is not installed.
func (r *SlowQueriesRepo) TopLive(ctx context.Context, orderBy SlowQueryOrderBy, limit int) ([]SlowQuery, error) {
	if r == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 25
	}
	if limit > 200 {
		limit = 200
	}
	if err := orderBy.Validate(); err != nil {
		return nil, err
	}

	// The query is intentionally generic enough to work with both
	// pg_stat_statements 1.10 (mean_exec_time / max_exec_time) and
	// 1.11+ (mean_exec_time / max_exec_time stayed the same; new
	// columns added below those). When the extension is missing,
	// pgx returns SQLSTATE 42P01 (relation does not exist) which
	// we map to ErrPgStatStatementsUnavailable.
	sql := fmt.Sprintf(`
SELECT queryid::bigint, query, calls,
       total_exec_time, mean_exec_time, max_exec_time,
       rows, shared_blks_hit, shared_blks_read
  FROM pg_stat_statements
 WHERE query NOT LIKE 'SET %%' AND query NOT LIKE 'COMMIT%%' AND query NOT LIKE 'BEGIN%%'
 ORDER BY %s DESC NULLS LAST
 LIMIT $1`, orderByColumnLive(orderBy))

	rows, err := r.exec.Query(ctx, sql, limit)
	if err != nil {
		if isMissingRelationError(err) {
			return nil, ErrPgStatStatementsUnavailable
		}
		return nil, fmt.Errorf("slow_queries: live query: %w", err)
	}
	defer rows.Close()

	var out []SlowQuery
	for rows.Next() {
		var q SlowQuery
		var rawQuery string
		var hit, read *int64
		if err := rows.Scan(&q.QueryID, &rawQuery, &q.Calls,
			&q.TotalTimeMs, &q.MeanTimeMs, &q.MaxTimeMs,
			&q.RowsReturned, &hit, &read); err != nil {
			return nil, fmt.Errorf("slow_queries: scan: %w", err)
		}
		q.Fingerprint = normaliseFingerprint(rawQuery)
		q.SharedBlksHit = hit
		q.SharedBlksRead = read
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		// pgx defers preload/preparation errors to rows.Err(); a
		// missing or unloaded pg_stat_statements surfaces here too.
		if isMissingRelationError(err) {
			return nil, ErrPgStatStatementsUnavailable
		}
		return nil, fmt.Errorf("slow_queries: rows.Err: %w", err)
	}
	if out == nil {
		out = []SlowQuery{}
	}
	return out, nil
}

// Snapshot inserts a row per pg_stat_statements query into
// slow_query_snapshot. Called by a 5-minute ticker; idempotent in
// the sense that the same query at the same second produces a PK
// conflict and is silently skipped.
func (r *SlowQueriesRepo) Snapshot(ctx context.Context) (int, error) {
	if r == nil {
		return 0, nil
	}
	const sql = `
INSERT INTO slow_query_snapshot
  (ts, queryid, query_fingerprint, calls, total_time_ms, mean_time_ms,
   max_time_ms, rows_returned, shared_blks_hit, shared_blks_read)
SELECT now(), queryid::bigint,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 400),
       calls, total_exec_time, mean_exec_time, max_exec_time,
       rows, shared_blks_hit, shared_blks_read
  FROM pg_stat_statements
 WHERE calls > 0
ON CONFLICT (ts, queryid) DO NOTHING`
	tag, err := r.exec.Exec(ctx, sql)
	if err != nil {
		if isMissingRelationError(err) {
			return 0, ErrPgStatStatementsUnavailable
		}
		return 0, fmt.Errorf("slow_queries: snapshot: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// HistoricalForQuery returns the most recent N snapshot rows for a
// single queryid. Used by the admin UI's "query over time" chart.
func (r *SlowQueriesRepo) HistoricalForQuery(ctx context.Context, queryID int64, limit int) ([]SlowQuery, error) {
	if r == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	const sql = `
SELECT queryid, query_fingerprint, calls, total_time_ms, mean_time_ms,
       max_time_ms, rows_returned, shared_blks_hit, shared_blks_read
  FROM slow_query_snapshot
 WHERE queryid = $1
 ORDER BY ts DESC LIMIT $2`
	rows, err := r.exec.Query(ctx, sql, queryID, limit)
	if err != nil {
		return nil, fmt.Errorf("slow_queries: historical: %w", err)
	}
	defer rows.Close()
	var out []SlowQuery
	for rows.Next() {
		var q SlowQuery
		var hit, read *int64
		if err := rows.Scan(&q.QueryID, &q.Fingerprint, &q.Calls,
			&q.TotalTimeMs, &q.MeanTimeMs, &q.MaxTimeMs,
			&q.RowsReturned, &hit, &read); err != nil {
			return nil, fmt.Errorf("slow_queries: scan historical: %w", err)
		}
		q.SharedBlksHit = hit
		q.SharedBlksRead = read
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("slow_queries: historical rows: %w", err)
	}
	if out == nil {
		out = []SlowQuery{}
	}
	return out, nil
}

// normaliseFingerprint compresses whitespace and trims to 400 chars
// so the wire response stays compact and the same query always has
// the same fingerprint regardless of formatting.
func normaliseFingerprint(s string) string {
	out := strings.Join(strings.Fields(s), " ")
	if len(out) > 400 {
		return out[:400]
	}
	return out
}

// isMissingRelationError detects errors that mean pg_stat_statements
// is not usable: SQLSTATE 42P01 (relation/view missing — extension
// not installed), 42883 (function missing), 42704 (object missing),
// or 55000 ("object_not_in_prerequisite_state" — extension installed
// but not loaded via shared_preload_libraries). All four are mapped
// to ErrPgStatStatementsUnavailable so the handler can surface a
// stable 503 SUBSYSTEM_NOT_CONFIGURED to the SPA.
func isMissingRelationError(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "42P01", "42883", "42704", "55000":
			return true
		}
	}
	return false
}

var _ = pgx.ErrNoRows
