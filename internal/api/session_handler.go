// Phase-46 / Prompt 42 — Active sessions / device management endpoints.
//
// Implements three endpoints the SPA's <ActiveSessionsSection> uses to
// list and revoke TeslaSync's per-device session bindings:
//
//	GET    /api/v1/auth/sessions               — list active sessions
//	DELETE /api/v1/auth/sessions/{id}          — revoke one (sudo gated)
//	DELETE /api/v1/auth/sessions/all-others    — revoke every other (sudo gated)
//
// Provider-agnostic. TeslaSync never speaks to the upstream IdP's admin
// API. Revoking a row here only kills the TeslaSync cookie binding;
// the upstream IdP session is the IdP's responsibility.
//
// Auth-mode awareness. In open mode (no FORWARD_AUTH_HEADER configured)
// every endpoint returns 501 with code `AUTH_MODE_OPEN` so the SPA's
// `useSessions` hook can render the inline placeholder placeholder
// without a noisy 401 loop. The DELETE routes are wrapped in
// RequireSudo upstream — that middleware is itself a passthrough in
// open mode, so the open-mode check below intentionally fires before
// any database work and never depends on the sudo middleware running.
package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// SessionListStore is the storage seam for the sessions handler.
// Production wires this to *dbauth.AuthSessionsRepo; tests substitute
// an in-memory fake.
type SessionListStore interface {
	ListActiveBySubject(ctx context.Context, subject string) ([]dbauth.AuthSessionRow, error)
	Revoke(ctx context.Context, id uuid.UUID, subject string) error
	RevokeAllOthers(ctx context.Context, subject string, exceptID uuid.UUID) (int64, error)
}

// SessionHandler bundles the active-sessions endpoints. headerName is
// captured at construction so the open-mode check is consistent with
// the rest of the handlers wired against the same config snapshot.
type SessionHandler struct {
	store      SessionListStore
	headerName string
}

// NewSessionHandler builds the handler. headerName is the trimmed
// FORWARD_AUTH_HEADER value (typically "X-Forwarded-User"); empty puts
// every endpoint into open-mode (501 AUTH_MODE_OPEN) responses.
func NewSessionHandler(store SessionListStore, headerName string) *SessionHandler {
	return &SessionHandler{store: store, headerName: strings.TrimSpace(headerName)}
}

// sessionInfo is the JSON shape returned for each row in the list
// endpoint. Keys are snake_case to match the rest of the API surface;
// the camelCaseKeys transformer on the frontend exposes both forms.
//
// `Current` is true exactly for the row whose id matches the
// CurrentSessionID injected into the request context by the tracker
// middleware — so the SPA can highlight "this device" without a
// separate roundtrip.
type sessionInfo struct {
	ID         string  `json:"id"`
	UserAgent  string  `json:"user_agent"`
	IP         string  `json:"ip"`
	CreatedAt  string  `json:"created_at"`
	LastSeenAt string  `json:"last_seen_at"`
	RevokedAt  *string `json:"revoked_at,omitempty"`
	Current    bool    `json:"current"`
}

// sessionListResponse is the wrapper returned by GET /auth/sessions.
type sessionListResponse struct {
	Mode     string        `json:"mode"`
	Sessions []sessionInfo `json:"sessions"`
}

// revokeAllOthersResponse is returned by DELETE /auth/sessions/all-others.
type revokeAllOthersResponse struct {
	Mode    string `json:"mode"`
	Revoked int64  `json:"revoked"`
}

// resolveSubject pulls the principal identity from the configured
// ForwardAuth header. Returns ("", true) in open mode (no header
// configured) so the caller can short-circuit with 501 AUTH_MODE_OPEN.
// Returns ("", false) when the header is configured but absent — that
// is a 401 because the proxy should always inject it for authenticated
// traffic.
func (h *SessionHandler) resolveSubject(r *http.Request) (subject string, openMode bool) {
	if h.headerName == "" {
		return "", true
	}
	return strings.TrimSpace(r.Header.Get(h.headerName)), false
}

// writeOpenModeNotImplementedSession is the canonical 501 response in
// open mode. Centralised so the SPA's useSessions hook can match the
// exact code without snake-vs-camel drift.
func writeOpenModeNotImplementedSession(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusNotImplemented,
		"active sessions list requires forward-auth mode", tsauth.AuthModeOpenCode)
}

// List implements GET /auth/sessions.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401.
// Forward-auth, header set: 200 with sessions[] (possibly empty).
//
// `Current` is true for the row whose id matches the inbound request's
// session cookie binding (resolved via tracker middleware). When the
// cookie is missing or unknown, no row reports current — that mirrors
// what the user actually sees and avoids a misleading "this is the
// current device" pill on every row.
func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	subject, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplementedSession(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", "MISSING_IDENTITY")
		return
	}

	rows, err := h.store.ListActiveBySubject(r.Context(), subject)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load sessions")
		return
	}
	currentID, hasCurrent := tsauth.CurrentSessionID(r.Context())

	out := make([]sessionInfo, 0, len(rows))
	for _, row := range rows {
		info := sessionInfo{
			ID:         row.ID.String(),
			UserAgent:  row.UserAgent,
			IP:         row.IP,
			CreatedAt:  row.CreatedAt.UTC().Format(time.RFC3339),
			LastSeenAt: row.LastSeenAt.UTC().Format(time.RFC3339),
			Current:    hasCurrent && row.ID == currentID,
		}
		if row.RevokedAt != nil {
			s := row.RevokedAt.UTC().Format(time.RFC3339)
			info.RevokedAt = &s
		}
		out = append(out, info)
	}
	writeJSON(w, http.StatusOK, sessionListResponse{Mode: "session", Sessions: out})
}

// Revoke implements DELETE /auth/sessions/{id}.
//
// Open mode: 501 AUTH_MODE_OPEN. (Open-mode RequireSudo passes through
// trivially; this check guards the resource semantics.)
// Forward-auth, missing header: 401.
// Forward-auth, malformed id: 400.
// Forward-auth, no matching row OR row already revoked: 204 (idempotent).
// Forward-auth, row revoked: 204.
//
// Subject scoping is enforced inside the repo via the (id, subject)
// composite filter, so principal-A cannot revoke principal-B's session
// by guessing an id.
func (h *SessionHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	subject, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplementedSession(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", "MISSING_IDENTITY")
		return
	}

	idParam := strings.TrimSpace(chi.URLParam(r, "id"))
	id, err := uuid.Parse(idParam)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}

	if err := h.store.Revoke(r.Context(), id, subject); err != nil {
		if errors.Is(err, dbauth.ErrAuthSessionNotFound) {
			// Idempotent — caller may have already revoked this row
			// in a parallel tab. Treat as success so the SPA's
			// optimistic update doesn't have to special-case 404s.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to revoke session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RevokeAllOthers implements DELETE /auth/sessions/all-others.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401.
// Forward-auth, success: 200 with `revoked` count.
//
// The "current" session is excluded based on the inbound cookie's
// resolved id. When no current session is in the request context (e.g.
// the client cleared its cookie before calling), the call revokes EVERY
// active session for the subject — the SPA only lets the user trigger
// this from a context that has a valid session, so the no-exception
// path is best-effort defensive rather than the happy path.
func (h *SessionHandler) RevokeAllOthers(w http.ResponseWriter, r *http.Request) {
	subject, openMode := h.resolveSubject(r)
	if openMode {
		writeOpenModeNotImplementedSession(w)
		return
	}
	if subject == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", "MISSING_IDENTITY")
		return
	}

	currentID, _ := tsauth.CurrentSessionID(r.Context())
	revoked, err := h.store.RevokeAllOthers(r.Context(), subject, currentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke other sessions")
		return
	}
	writeJSON(w, http.StatusOK, revokeAllOthersResponse{Mode: "session", Revoked: revoked})
}
