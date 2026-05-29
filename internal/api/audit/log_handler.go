package audit

import (
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

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
	limit, _ := apiparams.Pagination(r)
	if limit > 200 {
		limit = 200
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, ts, actor, action, entity_type, entity_id, detail FROM audit_logs ORDER BY ts DESC LIMIT $1`, limit)
	if err != nil {
		// Table may not exist yet — return empty array instead of 500
		// to avoid tripping the frontend circuit breaker
		httpx.WriteJSON(w, http.StatusOK, []systemmodel.AuditLog{})
		return
	}
	defer rows.Close()

	logs := []systemmodel.AuditLog{}
	for rows.Next() {
		var l systemmodel.AuditLog
		if err := rows.Scan(&l.ID, &l.Ts, &l.Actor, &l.Action, &l.EntityType, &l.EntityID, &l.Detail); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	httpx.WriteJSON(w, http.StatusOK, logs)
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
		httpx.WriteError(w, http.StatusServiceUnavailable, "per-user activity requires a ForwardAuth identity provider; set FORWARD_AUTH_HEADER to enable")
		return
	}
	actor := actorFromRequest(r, h.forwardAuthHeader)
	if actor == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity header for per-user activity")
		return
	}

	limit, offset := apiparams.Pagination(r)
	if limit > 200 {
		limit = 200
	}

	start, end := apiparams.ParseDateRange(r)
	if end.IsZero() {
		end = time.Now().UTC()
	}
	if start.IsZero() {
		start = end.Add(-30 * 24 * time.Hour)
	}
	if start.After(end) {
		httpx.WriteError(w, http.StatusBadRequest, "start must be on or before end")
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
		httpx.WriteJSON(w, http.StatusOK, []userActivityEntry{})
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
	httpx.WriteJSON(w, http.StatusOK, entries)
}
