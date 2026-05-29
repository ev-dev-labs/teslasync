package api

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// auditEntry is the canonical write-shape for audit_logs (Phase-40 / Prompt 49).
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

// actorFromRequest resolves the user identity for an audit event.
//
// When a ForwardAuth header is configured (Authentik, Authelia, oauth2-proxy,
// Keycloak, etc.) and present on the request, its value is treated as the
// stable per-user actor id (typically an email or username). When absent or
// unconfigured, the function returns the empty string — callers that need
// guaranteed identity for per-user filtering should error out in that case
// rather than silently aggregating across users.
func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

// clientIP extracts the best-effort client IP from a request, preferring
// X-Forwarded-For (trusted reverse-proxy chain) then RemoteAddr. The port
// is stripped so the value is comparable across requests.
func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// XFF is a comma-separated chain; the first entry is the original client.
		if i := strings.IndexByte(xff, ','); i >= 0 {
			xff = xff[:i]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	if r.RemoteAddr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// logAuditFromRequest persists a fully-attributed audit event for an HTTP
// mutation. Actor is derived from the configured ForwardAuth header (empty
// string when no auth is configured — those rows still record IP/UA so admins
// can diagnose dev-mode activity). Use this for any new authenticated write
// path so that /users/me/activity can surface it.
func logAuditFromRequest(db *database.DB, r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
	insertAuditLog(db, r.Context(), auditEntry{
		Actor:      actorFromRequest(r, headerName),
		Action:     action,
		EntityType: resource,
		EntityID:   entityID,
		Detail:     detail,
		IP:         clientIP(r),
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
