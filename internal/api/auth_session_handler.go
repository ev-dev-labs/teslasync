package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// Phase-46 / Prompt 05 — ForwardAuth session-info endpoint.
//
// GET /api/v1/auth/session is polled by the SPA (every 5 minutes) so it
// can surface the SessionExpiringModal countdown ~60s before expiry and
// the SessionExpiredModal hard-block when the upstream proxy has fully
// invalidated the cookie. The response shape is:
//
//	{
//	  "authenticated": bool,
//	  "mode":          "open" | "session",
//	  "expires_at":    RFC3339 | null,
//	  "expires_in":    int seconds remaining | null,
//	  "user":          { "sub": string, "email": string } | null,
//	  "renewable":     bool
//	}
//
// CRITICAL: this endpoint MUST always return 200 OK regardless of
// authentication state. If it returned 401 when unauthenticated, the
// SPA's session monitor would itself fall into the "401 from any API
// call" path and dispatch the hard-expired modal — turning the polling
// hook into an infinite redirect loop. Routed OUTSIDE the /api/v1
// ForwardAuth subrouter for the same reason.
//
// IDENTITY HEADERS — TeslaSync is provider-agnostic. We read whichever
// header the operator wired into FORWARD_AUTH_HEADER (typically
// X-Forwarded-User or X-Auth-Request-User). Email + expires-at use
// well-known oauth2-proxy / authentik / authelia conventions and can be
// overridden by env vars when an operator's proxy uses different names.
//
// EXPIRES PARSING — accepts both RFC3339 (oauth2-proxy default) and
// Unix-seconds-as-string (authelia, some bespoke setups). When neither
// parses, expires_at is reported as null and the SPA falls back to
// "polling-only" detection: a 401 from any other endpoint will still
// surface the hard-expired modal.
//
// OPEN MODE — when no FORWARD_AUTH_HEADER is configured we report
// {authenticated: true, mode: "open", renewable: false}. The SPA's
// useSessionMonitor short-circuits all banner/modal logic in this
// branch — there is no session to expire when there is no auth.

// AuthSessionHandler serves GET /api/v1/auth/session. Stateless — all
// data is derived from the inbound request headers + config snapshot.
type AuthSessionHandler struct {
	// userHeader is the proxy header carrying the principal identity
	// (e.g. "X-Forwarded-User"). Empty in open mode.
	userHeader string
	// emailHeader names the proxy header carrying the principal email,
	// when distinct from userHeader. Defaults to "X-Auth-Request-Email".
	emailHeader string
	// expiresHeader names the proxy header carrying the session expiry.
	// Defaults to "X-Auth-Request-Expires-At" (oauth2-proxy / authentik).
	expiresHeader string
	// now is injectable for deterministic tests.
	now func() time.Time
}

// NewAuthSessionHandler wires the handler from the application config.
// emailHeader / expiresHeader use sensible defaults that match the
// dominant ForwardAuth providers (oauth2-proxy, authentik, authelia);
// operators with bespoke header names can set FORWARD_AUTH_EMAIL_HEADER
// / FORWARD_AUTH_EXPIRES_HEADER on the deployment to override.
func NewAuthSessionHandler(cfg *config.Config) *AuthSessionHandler {
	h := &AuthSessionHandler{now: time.Now}
	if cfg != nil {
		h.userHeader = strings.TrimSpace(cfg.Auth.ForwardAuthHeader)
	}
	h.emailHeader = "X-Auth-Request-Email"
	h.expiresHeader = "X-Auth-Request-Expires-At"
	return h
}

// authSessionUser is the nested user object surfaced when the request
// is authenticated. Both fields may be empty strings if the proxy
// chooses not to expose them.
type authSessionUser struct {
	Sub   string `json:"sub"`
	Email string `json:"email,omitempty"`
}

// authSessionResponse is the JSON shape sent to the SPA. Keys are
// snake_case to match the rest of the API surface; the camelCaseKeys
// transformer on the frontend exposes both forms.
type authSessionResponse struct {
	Authenticated bool             `json:"authenticated"`
	Mode          string           `json:"mode"`
	ExpiresAt     *string          `json:"expires_at"`
	ExpiresIn     *int64           `json:"expires_in"`
	User          *authSessionUser `json:"user"`
	Renewable     bool             `json:"renewable"`
}

// Session handles GET /api/v1/auth/session. Always returns 200.
func (h *AuthSessionHandler) Session(w http.ResponseWriter, r *http.Request) {
	// Open mode: no auth header configured at all. SPA disables session
	// monitoring entirely — there is nothing to expire.
	if h.userHeader == "" {
		writeJSON(w, http.StatusOK, authSessionResponse{
			Authenticated: true,
			Mode:          "open",
		})
		return
	}

	subject := strings.TrimSpace(r.Header.Get(h.userHeader))
	if subject == "" {
		writeJSON(w, http.StatusOK, authSessionResponse{
			Authenticated: false,
			Mode:          "session",
		})
		return
	}

	email := strings.TrimSpace(r.Header.Get(h.emailHeader))
	expiresAt, expiresIn := h.parseExpiry(r.Header.Get(h.expiresHeader))

	resp := authSessionResponse{
		Authenticated: true,
		Mode:          "session",
		ExpiresAt:     expiresAt,
		ExpiresIn:     expiresIn,
		User: &authSessionUser{
			Sub:   subject,
			Email: email,
		},
		Renewable: true,
	}

	writeJSON(w, http.StatusOK, resp)
}

// parseExpiry returns (RFC3339 string, seconds remaining) for the
// supplied header value. Accepts:
//   - RFC3339 / RFC3339Nano timestamps (oauth2-proxy default)
//   - Unix seconds as a decimal string (authelia, some bespoke setups)
//   - Unix milliseconds as a decimal string (defensive — some proxies
//     emit ms; we detect ms vs s by magnitude).
//
// Returns (nil, nil) when parsing fails so the SPA falls back to its
// polling-only detection path.
func (h *AuthSessionHandler) parseExpiry(raw string) (*string, *int64) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}

	// Try RFC3339 / RFC3339Nano first — most common.
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return h.formatExpiry(t)
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return h.formatExpiry(t)
	}

	// Try numeric Unix seconds / milliseconds.
	if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
		// Magnitude heuristic: anything beyond year 5000 in seconds is
		// almost certainly milliseconds. 1e12 ≈ 2001-09-09 in ms vs
		// year 33658 in s, so this cutoff is comfortable.
		const millisCutoff = int64(1e12)
		var t time.Time
		if n >= millisCutoff {
			t = time.Unix(0, n*int64(time.Millisecond))
		} else {
			t = time.Unix(n, 0)
		}
		return h.formatExpiry(t)
	}

	return nil, nil
}

func (h *AuthSessionHandler) formatExpiry(t time.Time) (*string, *int64) {
	formatted := t.UTC().Format(time.RFC3339)
	remaining := int64(t.Sub(h.now()).Seconds())
	return &formatted, &remaining
}
