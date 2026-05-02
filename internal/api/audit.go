package api

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
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

// AuditHandler handles audit log endpoints.
type AuditHandler struct {
	db                *database.DB
	forwardAuthHeader string
}

// NewAuditHandler creates a new AuditHandler.
//
// forwardAuthHeader is the request header (e.g. X-Forwarded-User) injected by
// the reverse-proxy auth provider. When empty, the per-user activity endpoint
// returns 503 — there is no reliable way to scope rows to a single caller.
func NewAuditHandler(db *database.DB, forwardAuthHeader string) *AuditHandler {
	return &AuditHandler{db: db, forwardAuthHeader: forwardAuthHeader}
}

// List returns recent audit log entries.
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := pagination(r)
	if limit > 200 {
		limit = 200
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, ts, actor, action, entity_type, entity_id, detail FROM audit_logs ORDER BY ts DESC LIMIT $1`, limit)
	if err != nil {
		// Table may not exist yet — return empty array instead of 500
		// to avoid tripping the frontend circuit breaker
		writeJSON(w, http.StatusOK, []models.AuditLog{})
		return
	}
	defer rows.Close()

	logs := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.Ts, &l.Actor, &l.Action, &l.EntityType, &l.EntityID, &l.Detail); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	writeJSON(w, http.StatusOK, logs)
}

// userActivityEntry mirrors the JSON returned by GET /users/me/activity.
//
// Field names are snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys (entity_type → entityType, etc.) so consumers can
// pick either naming convention.
type userActivityEntry struct {
	ID         int64     `json:"id"`
	Ts         time.Time `json:"ts"`
	Action     string    `json:"action"`
	EntityType string    `json:"entity_type"`
	EntityID   *int64    `json:"entity_id,omitempty"`
	Detail     *string   `json:"detail,omitempty"`
}

// UserActivity returns the requesting caller's recent audit-log entries.
//
// Identity is resolved from the configured ForwardAuth header. When the
// install is not running behind a reverse-proxy auth provider (header name
// unset OR header value empty for the request), the endpoint returns 503
// rather than collapsing every "anonymous" caller into a single shared feed.
//
// Query params:
//   - start, end (YYYY-MM-DD, optional): defaults to last 30 days
//   - limit (1..200, default 50), offset (>=0, default 0)
func (h *AuditHandler) UserActivity(w http.ResponseWriter, r *http.Request) {
	if h.forwardAuthHeader == "" {
		writeError(w, http.StatusServiceUnavailable, "per-user activity requires a ForwardAuth identity provider; set FORWARD_AUTH_HEADER to enable")
		return
	}
	actor := actorFromRequest(r, h.forwardAuthHeader)
	if actor == "" {
		writeError(w, http.StatusUnauthorized, "missing identity header for per-user activity")
		return
	}

	limit, offset := pagination(r)
	if limit > 200 {
		limit = 200
	}

	start, end := parseDateRange(r)
	if end.IsZero() {
		end = time.Now().UTC()
	}
	if start.IsZero() {
		start = end.Add(-30 * 24 * time.Hour)
	}
	if start.After(end) {
		writeError(w, http.StatusBadRequest, "start must be on or before end")
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, ts, action, entity_type, entity_id, detail
		   FROM audit_logs
		  WHERE actor = $1 AND ts BETWEEN $2 AND $3
		  ORDER BY ts DESC
		  LIMIT $4 OFFSET $5`,
		actor, start, end, limit, offset)
	if err != nil {
		// Table may not exist yet — return empty array rather than 500
		// to keep the frontend circuit breaker closed.
		writeJSON(w, http.StatusOK, []userActivityEntry{})
		return
	}
	defer rows.Close()

	entries := []userActivityEntry{}
	for rows.Next() {
		var e userActivityEntry
		if err := rows.Scan(&e.ID, &e.Ts, &e.Action, &e.EntityType, &e.EntityID, &e.Detail); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	writeJSON(w, http.StatusOK, entries)
}
