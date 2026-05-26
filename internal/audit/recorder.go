// Package audit is the unified, tamper-evident audit recorder for
// TeslaSync. Every mutating call site MUST funnel through Recorder
// instead of writing audit_logs directly so we get a single source of
// truth for redaction, hash chaining, and trace correlation.
//
// Layer: platform
//
// Design (Phase-45 / Prompt 1):
//
//   - Recorder wraps a *pgxpool.Pool and a Redactor. Mutations are
//     accepted as Event values; the recorder fills in ts, redacts
//     before/after, computes row_hash from prev_row_hash, and inserts
//     into audit_logs.
//
//   - The hash chain is per-process: at startup the recorder loads the
//     most recent row_hash from the DB so concurrent processes still
//     have a contiguous chain (one process per audit row, last write
//     wins for the chain).
//
//   - Redaction is allowlist-based per (Category, Action) pair. The
//     default policy is "redact everything"; a Recorder constructed
//     without a redaction policy is conservative.
//
//   - Trace correlation: if the context carries an OpenTelemetry span,
//     the W3C trace id is written into audit_logs.trace_id so Jaeger
//     and the admin audit viewer can cross-link.
//
// Backward compatibility: existing call sites that call
// internal/api.insertAuditLog continue to work; they simply omit
// before/after/category/trace_id. New call sites should prefer
// Recorder.Record so the new columns are populated.
package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/trace"
)

// Category groups audit events for filtering in the admin UI. The set
// is fixed at compile time; new categories require code review.
type Category string

const (
	CategoryAuth     Category = "auth"
	CategoryAdmin    Category = "admin"
	CategoryData     Category = "data"
	CategoryConfig   Category = "config"
	CategorySecurity Category = "security"
)

// Validate returns nil for known categories and an error otherwise.
func (c Category) Validate() error {
	switch c {
	case CategoryAuth, CategoryAdmin, CategoryData, CategoryConfig, CategorySecurity:
		return nil
	default:
		return fmt.Errorf("unknown audit category %q", c)
	}
}

// Event is the canonical write shape for audit_logs. Required fields
// must be set by the caller; the recorder fills in Ts, TraceID,
// PrevRowHash, RowHash on its own.
type Event struct {
	Actor      string
	Category   Category
	Action     string
	EntityType string
	EntityID   *int64
	Detail     string
	Before     any
	After      any
	Success    bool
	IP         string
	UserAgent  string
}

// Redactor returns a serialization-safe view of `value` for the given
// (category, action) pair. Implementations should remove or replace
// secrets (tokens, passwords, API keys) before returning the value.
type Redactor interface {
	Redact(category Category, action string, value any) any
}

// AllowAllRedactor is a no-op Redactor used in tests where the input
// is known to be safe. Never use in production.
type AllowAllRedactor struct{}

// Redact returns the value unchanged.
func (AllowAllRedactor) Redact(_ Category, _ string, value any) any { return value }

// DenyAllRedactor returns the literal string "[REDACTED]" for every
// non-nil value. This is the conservative default when no per-action
// policy is registered.
type DenyAllRedactor struct{}

// Redact returns "[REDACTED]" for non-nil values, nil for nil.
func (DenyAllRedactor) Redact(_ Category, _ string, value any) any {
	if value == nil {
		return nil
	}
	return "[REDACTED]"
}

// Recorder is the single-write-path for audit_logs. Construct it
// once at app startup and pass it to every call site that needs to
// audit a mutation.
type Recorder struct {
	pool     *pgxpool.Pool
	redactor Redactor
	now      func() time.Time

	mu      sync.Mutex
	prevRow string
}

// New constructs a Recorder backed by the given pool. The redactor
// defaults to DenyAllRedactor when nil. Returns nil if pool is nil.
func New(pool *pgxpool.Pool, redactor Redactor) *Recorder {
	if pool == nil {
		return nil
	}
	if redactor == nil {
		redactor = DenyAllRedactor{}
	}
	return &Recorder{pool: pool, redactor: redactor, now: time.Now}
}

// Hydrate loads the most-recent row_hash from the DB into the
// in-memory chain head so the next Record extends the chain
// continuously. Safe to call multiple times; no-op when the table
// has no rows.
func (r *Recorder) Hydrate(ctx context.Context) error {
	if r == nil {
		return nil
	}
	var last string
	err := r.pool.QueryRow(ctx,
		`SELECT row_hash FROM audit_logs
		  WHERE row_hash IS NOT NULL
		  ORDER BY ts DESC, id DESC LIMIT 1`).Scan(&last)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("audit: hydrate prev row hash: %w", err)
	}
	r.mu.Lock()
	r.prevRow = last
	r.mu.Unlock()
	return nil
}

// Record persists a single audit event. Errors are returned (not
// swallowed) so callers can decide whether to surface to the user
// or log-and-continue.
func (r *Recorder) Record(ctx context.Context, ev Event) error {
	if r == nil {
		return nil
	}
	if ev.Actor == "" || ev.Action == "" || ev.EntityType == "" {
		return errors.New("audit: actor, action, entity_type are required")
	}

	ts := r.now().UTC()
	traceID := traceIDFromContext(ctx)

	beforeJSON, err := marshalRedacted(r.redactor, ev.Category, ev.Action, ev.Before)
	if err != nil {
		return fmt.Errorf("audit: marshal before: %w", err)
	}
	afterJSON, err := marshalRedacted(r.redactor, ev.Category, ev.Action, ev.After)
	if err != nil {
		return fmt.Errorf("audit: marshal after: %w", err)
	}

	r.mu.Lock()
	prev := r.prevRow
	rowHash := computeRowHash(prev, ts, ev, beforeJSON, afterJSON, traceID)
	r.prevRow = rowHash
	r.mu.Unlock()

	const query = `
INSERT INTO audit_logs (
  ts, actor, action, entity_type, entity_id, detail,
  ip, user_agent, category, before_value, after_value,
  trace_id, prev_row_hash, row_hash, success
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10, $11,
  $12, $13, $14, $15
)`
	_, err = r.pool.Exec(ctx, query,
		ts, ev.Actor, ev.Action, ev.EntityType, ev.EntityID, nullableStr(ev.Detail),
		nullableStr(ev.IP), nullableStr(ev.UserAgent),
		nullableStr(string(ev.Category)), nullableJSON(beforeJSON), nullableJSON(afterJSON),
		nullableStr(traceID), nullableStr(prev), rowHash, ev.Success,
	)
	if err != nil {
		r.mu.Lock()
		r.prevRow = prev
		r.mu.Unlock()
		log.Warn().Err(err).Str("action", ev.Action).Msg("audit: insert failed; chain not advanced")
		return fmt.Errorf("audit: insert: %w", err)
	}
	return nil
}

func marshalRedacted(red Redactor, c Category, action string, value any) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	redacted := red.Redact(c, action, value)
	if redacted == nil {
		return nil, nil
	}
	return json.Marshal(redacted)
}

// computeRowHash returns the SHA256 hex of (prev || canonical(event)).
// The canonical form is the JSON encoding of a fixed-shape struct so
// the same event always hashes the same way.
func computeRowHash(prev string, ts time.Time, ev Event, beforeJSON, afterJSON []byte, traceID string) string {
	type canonical struct {
		Prev       string          `json:"prev"`
		Ts         string          `json:"ts"`
		Actor      string          `json:"actor"`
		Category   string          `json:"category"`
		Action     string          `json:"action"`
		EntityType string          `json:"entity_type"`
		EntityID   *int64          `json:"entity_id,omitempty"`
		Detail     string          `json:"detail,omitempty"`
		Before     json.RawMessage `json:"before,omitempty"`
		After      json.RawMessage `json:"after,omitempty"`
		TraceID    string          `json:"trace_id,omitempty"`
		Success    bool            `json:"success"`
	}
	c := canonical{
		Prev:       prev,
		Ts:         ts.Format(time.RFC3339Nano),
		Actor:      ev.Actor,
		Category:   string(ev.Category),
		Action:     ev.Action,
		EntityType: ev.EntityType,
		EntityID:   ev.EntityID,
		Detail:     ev.Detail,
		Before:     beforeJSON,
		After:      afterJSON,
		TraceID:    traceID,
		Success:    ev.Success,
	}
	b, _ := json.Marshal(c)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// VerifyChain walks the rows in (ts, id) order and recomputes each
// row_hash from prev_row_hash + canonical event. Returns the id of
// the first row whose recomputed hash diverges, or 0 if the chain
// is intact through `limit` rows.
func (r *Recorder) VerifyChain(ctx context.Context, since time.Time, limit int) (firstBadID int64, checked int, err error) {
	if r == nil {
		return 0, 0, nil
	}
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	const query = `
SELECT id, ts, actor, COALESCE(category,''), action, entity_type, entity_id,
       COALESCE(detail,''), before_value, after_value,
       COALESCE(trace_id,''), COALESCE(prev_row_hash,''),
       COALESCE(row_hash,''), COALESCE(success,false)
  FROM audit_logs
 WHERE ts >= $1 AND row_hash IS NOT NULL
 ORDER BY ts ASC, id ASC
 LIMIT $2`
	rows, err := r.pool.Query(ctx, query, since, limit)
	if err != nil {
		return 0, 0, fmt.Errorf("audit: verify scan: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id                 int64
			ts                 time.Time
			actor, cat, action string
			entityType         string
			entityID           *int64
			detail             string
			beforeJSON         []byte
			afterJSON          []byte
			traceID, prev      string
			rowHash            string
			success            bool
		)
		if err := rows.Scan(&id, &ts, &actor, &cat, &action, &entityType, &entityID,
			&detail, &beforeJSON, &afterJSON, &traceID, &prev, &rowHash, &success); err != nil {
			return 0, checked, fmt.Errorf("audit: verify scan row: %w", err)
		}
		ev := Event{
			Actor: actor, Category: Category(cat), Action: action,
			EntityType: entityType, EntityID: entityID, Detail: detail,
			Success: success,
		}
		want := computeRowHash(prev, ts.UTC(), ev, beforeJSON, afterJSON, traceID)
		checked++
		if want != rowHash {
			return id, checked, nil
		}
	}
	return 0, checked, rows.Err()
}

func traceIDFromContext(ctx context.Context) string {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return ""
	}
	return sc.TraceID().String()
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
