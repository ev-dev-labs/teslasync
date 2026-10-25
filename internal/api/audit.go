package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// auditEntry is the canonical write-shape for audit_logs.
// All inserts route through insertAuditLog so that the new ip/user_agent
// columns added by migration 000163 are populated consistently.
type auditEntry struct {
	Actor      string
	Action     string
	EntityType string
	EntityID   *int64
	Detail     string
	IP         string
	UserAgent  string
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// insertAuditLog writes one row into audit_logs. Errors are logged but never
// propagated — audit failures must not break user-facing mutations.
func insertAuditLog(db *database.DB, ctx context.Context, e auditEntry) {
	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := db.Pool.Exec(ctx, query,
		time.Now().UTC(),
		e.Actor,
		e.Action,
		e.EntityType,
		e.EntityID,
		e.Detail,
		nullableStr(e.IP),
		nullableStr(e.UserAgent),
	)
	if err != nil {
		log.Warn().Err(err).Str("action", e.Action).Str("entity_type", e.EntityType).Msg("failed to write audit log")
	}
}

// logAudit records an audit log entry for a mutation action.
//
// Backward-compatible shim: existing callers pass the request's RemoteAddr as
// `ip`, which is recorded in the `actor` column to match the historical
// convention. New callers that have access to the originating *http.Request
// should prefer logAuditFromRequest, which derives a real actor identity from
// the configured ForwardAuth header and persists IP/User-Agent separately.
func logAudit(db *database.DB, ctx context.Context, action, resource, details, ip string) {
	insertAuditLog(db, ctx, auditEntry{
		Actor:      ip,
		Action:     action,
		EntityType: resource,
		Detail:     details,
	})
}

// logAuditFromRequest persists a fully-attributed audit event for an HTTP
// mutation. Actor is derived from the configured ForwardAuth header (empty
// string when no auth is configured — those rows still record IP/UA so admins
// can diagnose dev-mode activity). Use this for any new authenticated write
// path so that /users/me/activity can surface it.
func logAuditFromRequest(db *database.DB, r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
	insertAuditLog(db, r.Context(), auditEntry{
		Actor:      httputil.ActorIdentity(r, headerName),
		Action:     action,
		EntityType: resource,
		EntityID:   entityID,
		Detail:     detail,
		IP:         httputil.ClientIP(r, httputil.ClientIPOptions{TrustXForwardedFor: true}),
		UserAgent:  r.UserAgent(),
	})
}

// DBAuditWriter implements automation.AuditWriter by writing to the
// audit_logs table. It satisfies the interface used by the Auditor.
type DBAuditWriter struct {
	db *database.DB
}

// NewDBAuditWriter creates a writer backed by the given database.
func NewDBAuditWriter(db *database.DB) *DBAuditWriter {
	return &DBAuditWriter{db: db}
}

// WriteAudit inserts an audit log entry. Errors are logged but not returned.
func (w *DBAuditWriter) WriteAudit(ctx context.Context, action, resource, details, ip string) {
	logAudit(w.db, ctx, action, resource, details, ip)
}
