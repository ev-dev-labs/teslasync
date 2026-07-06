package audit

// AuditLogQueryRepo is the audit log read path and the read-side companion to internal/audit's
// Recorder. The recorder writes; this repo serves the admin audit
// viewer page with filtering + pagination.

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AuditLogQuery is the parameterised filter for List.
type AuditLogQuery struct {
	Since      time.Time
	Until      time.Time
	Categories []string
	Actors     []string
	Actions    []string
	EntityType string
	EntityID   *int64
	Limit      int
	Offset     int
}

// AuditLogRow is the wire shape returned to the admin UI. before/after
// are kept as raw JSON so the UI can render them as a tree without a
// Go-side schema.
type AuditLogRow struct {
	ID          int64     `json:"id"`
	Ts          time.Time `json:"ts"`
	Actor       string    `json:"actor"`
	Category    *string   `json:"category,omitempty"`
	Action      string    `json:"action"`
	EntityType  string    `json:"entity_type"`
	EntityID    *int64    `json:"entity_id,omitempty"`
	Detail      *string   `json:"detail,omitempty"`
	IP          *string   `json:"ip,omitempty"`
	UserAgent   *string   `json:"user_agent,omitempty"`
	Before      []byte    `json:"before,omitempty"`
	After       []byte    `json:"after,omitempty"`
	TraceID     *string   `json:"trace_id,omitempty"`
	PrevRowHash *string   `json:"prev_row_hash,omitempty"`
	RowHash     *string   `json:"row_hash,omitempty"`
	Success     *bool     `json:"success,omitempty"`
}

// AuditLogQueryRepo is the read-side repo.
//
// exec is the database.DBTX execution seam (satisfied by *pgxpool.Pool
// in production). Holding the interface rather than the concrete pool
// lets List/DistinctCategories/DistinctActions be unit tested against
// the in-repo DBTX fake.
type AuditLogQueryRepo struct {
	exec database.DBTX
}

// NewAuditLogQueryRepo constructs the repo. Returns nil when db is nil.
func NewAuditLogQueryRepo(db *database.DB) *AuditLogQueryRepo {
	if db == nil || db.Pool == nil {
		return nil
	}
	return &AuditLogQueryRepo{exec: db.Pool}
}

// List returns audit rows matching the filter ordered by ts DESC.
func (r *AuditLogQueryRepo) List(ctx context.Context, q AuditLogQuery) ([]AuditLogRow, error) {
	if r == nil {
		return nil, nil
	}
	if q.Limit <= 0 || q.Limit > 1000 {
		q.Limit = 100
	}
	if q.Offset < 0 {
		q.Offset = 0
	}

	var (
		whereParts []string
		args       []any
	)
	add := func(clause string, val any) {
		args = append(args, val)
		whereParts = append(whereParts, fmt.Sprintf(clause, len(args)))
	}
	if !q.Since.IsZero() {
		add("ts >= $%d", q.Since)
	}
	if !q.Until.IsZero() {
		add("ts < $%d", q.Until)
	}
	if len(q.Categories) > 0 {
		add("category = ANY($%d::text[])", q.Categories)
	}
	if len(q.Actors) > 0 {
		add("actor = ANY($%d::text[])", q.Actors)
	}
	if len(q.Actions) > 0 {
		add("action = ANY($%d::text[])", q.Actions)
	}
	if q.EntityType != "" {
		add("entity_type = $%d", q.EntityType)
	}
	if q.EntityID != nil {
		add("entity_id = $%d", *q.EntityID)
	}

	where := ""
	if len(whereParts) > 0 {
		where = "WHERE " + strings.Join(whereParts, " AND ")
	}
	args = append(args, q.Limit, q.Offset)

	sql := fmt.Sprintf(`
SELECT id, ts, actor, category, action, entity_type, entity_id, detail,
       ip, user_agent, before_value, after_value, trace_id,
       prev_row_hash, row_hash, success
  FROM audit_logs
 %s
 ORDER BY ts DESC, id DESC
 LIMIT $%d OFFSET $%d`, where, len(args)-1, len(args))

	rows, err := r.exec.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("audit_log_query: list: %w", err)
	}
	defer rows.Close()

	var out []AuditLogRow
	for rows.Next() {
		var row AuditLogRow
		if err := rows.Scan(&row.ID, &row.Ts, &row.Actor, &row.Category, &row.Action,
			&row.EntityType, &row.EntityID, &row.Detail, &row.IP, &row.UserAgent,
			&row.Before, &row.After, &row.TraceID, &row.PrevRowHash, &row.RowHash,
			&row.Success); err != nil {
			return nil, fmt.Errorf("audit_log_query: scan: %w", err)
		}
		out = append(out, row)
	}
	if out == nil {
		out = []AuditLogRow{}
	}
	return out, rows.Err()
}

// DistinctCategories / DistinctActions feed the filter dropdowns on
// the admin UI. Limited to 100 each so we don't accidentally return
// every unique actor email.
func (r *AuditLogQueryRepo) DistinctCategories(ctx context.Context) ([]string, error) {
	if r == nil {
		return nil, nil
	}
	rows, err := r.exec.Query(ctx,
		`SELECT DISTINCT category FROM audit_logs WHERE category IS NOT NULL ORDER BY category LIMIT 100`)
	if err != nil {
		return nil, fmt.Errorf("audit_log_query: distinct categories: %w", err)
	}
	defer rows.Close()
	return scanStrings(rows)
}

// DistinctActions returns the top-100 actions seen recently. Recency
// matters more than alphabetical order for the dropdown UX.
func (r *AuditLogQueryRepo) DistinctActions(ctx context.Context) ([]string, error) {
	if r == nil {
		return nil, nil
	}
	rows, err := r.exec.Query(ctx,
		`SELECT action FROM audit_logs GROUP BY action ORDER BY MAX(ts) DESC LIMIT 100`)
	if err != nil {
		return nil, fmt.Errorf("audit_log_query: distinct actions: %w", err)
	}
	defer rows.Close()
	return scanStrings(rows)
}

func scanStrings(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
}) ([]string, error) {
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if out == nil {
		out = []string{}
	}
	return out, rows.Err()
}
