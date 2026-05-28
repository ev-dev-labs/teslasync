// Package auth — session tracker middleware (Phase-46 / Prompt 42).
//
// The tracker mints a TeslaSync-issued opaque cookie on the first
// authenticated request from a browser, persists the (subject, cookie
// hash) tuple via [dbauth.AuthSessionsRepo], and validates the cookie
// on every subsequent request. Revoking a row in `auth_sessions` causes
// the next request bearing the cookie to be rejected with HTTP 401 and
// the cookie cleared on the browser — independently of the upstream
// ForwardAuth provider's session state.
//
// The package is deliberately a sibling of `internal/api` so the future
// auth-mode contract (prompt 57) can land helpers like `subject.go`
// here without churning the API package's import graph.
//
// Open-mode policy
// ----------------
// When the install is in open mode (no FORWARD_AUTH_HEADER configured)
// the middleware is a no-op passthrough. There is no stable subject
// identity, so there is no session to track or invalidate.
package auth

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// SessionCookieName is the cookie name TeslaSync uses for its own
// per-device binding. Distinct from anything an upstream IdP sets so
// the proxy and the tracker can coexist on the same hostname.
const SessionCookieName = "teslasync_session"

// CookieMaxAge is how long the browser keeps the cookie absent an
// explicit revoke. 30 days matches the upper bound most browsers honor
// without a Set-Cookie refresh; the tracker bumps last_seen_at on every
// request so an active user effectively never sees the cookie expire.
const CookieMaxAge = 30 * 24 * time.Hour

// contextKey is a private type so the request-context value cannot be
// shadowed by an unrelated package using the same string.
type contextKey int

const (
	// sessionIDKey is the request-context key under which the resolved
	// AuthSessionRow id is stored. Handlers fetch it via
	// CurrentSessionID(r.Context()) to know which row in the listing
	// represents "this device".
	sessionIDKey contextKey = iota
)

// SessionStore is the storage seam for the tracker. Production wires
// this to *dbauth.AuthSessionsRepo; tests substitute an in-memory fake.
//
// The interface is intentionally minimal — every method maps 1-to-1 to
// a state transition the tracker needs — so a future swap to a Redis
// or distributed-ledger backed store does not require resurrecting
// unused methods.
type SessionStore interface {
	HashCookie(token string) []byte
	MintCookieToken() (token string, hash []byte, err error)
	Create(ctx context.Context, subject string, cookieHash []byte, userAgent, ip string) (uuid.UUID, error)
	GetByCookieHash(ctx context.Context, cookieHash []byte) (*dbauth.AuthSessionRow, error)
	BumpLastSeen(ctx context.Context, id uuid.UUID) error
}

// SessionTrackerOptions tunes the middleware's behaviour. Zero values
// are treated as the documented defaults so production wiring can pass
// `SessionTrackerOptions{}` and rely on defaults.
type SessionTrackerOptions struct {
	// CookieName overrides SessionCookieName. Empty means use the
	// default — operators changing it must also update the SPA's
	// document.cookie reads, which is why the override is intentionally
	// rare.
	CookieName string

	// CookieSecure forces the Secure flag on the issued cookie. When
	// false the cookie is set Secure only when the inbound request was
	// observed over TLS (X-Forwarded-Proto=https or r.TLS != nil).
	// Production deployments behind a TLS-terminating reverse proxy
	// should set this to true to be defensive against misconfiguration.
	CookieSecure bool

	// CookieDomain pins the cookie to a specific domain. Empty means
	// the host of the issuing request, matching the default browser
	// behaviour and avoiding accidental cross-subdomain leaks.
	CookieDomain string

	// BumpInterval is the minimum gap between successive
	// BumpLastSeen() writes for the same session id. Zero defaults to
	// 60 seconds. A short interval keeps the audit feed fresh without
	// hammering the database on every request.
	BumpInterval time.Duration

	// Now is injectable for deterministic tests. Defaults to time.Now.
	Now func() time.Time
}

// Middleware returns the session-tracker HTTP middleware.
//
// In open mode (headerName == ""), or when store is nil, the returned
// middleware is a passthrough — there is no per-user identity to bind
// a session to, so we do nothing rather than break local development.
//
// The middleware MUST be mounted AFTER ForwardAuthMiddleware so the
// principal header is guaranteed present on every wrapped request.
func Middleware(headerName string, store SessionStore, opts SessionTrackerOptions) func(http.Handler) http.Handler {
	if headerName == "" || store == nil {
		return func(next http.Handler) http.Handler { return next }
	}

	cookieName := opts.CookieName
	if cookieName == "" {
		cookieName = SessionCookieName
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	bumper := dbauth.NewDebouncedBumper(opts.BumpInterval)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			subject := strings.TrimSpace(r.Header.Get(headerName))
			if subject == "" {
				// Header configured but absent — the proxy stripped or
				// failed to inject identity. ForwardAuthMiddleware
				// already 401s in this case, but our middleware may
				// run on an unauthenticated path; pass through.
				next.ServeHTTP(w, r)
				return
			}

			cookie, err := r.Cookie(cookieName)
			cookieValue := ""
			if err == nil {
				cookieValue = strings.TrimSpace(cookie.Value)
			}

			if cookieValue == "" {
				// First authenticated request from this browser — mint
				// a fresh session row + cookie.
				if id, ok := mintAndAttach(r.Context(), store, subject, r, w, opts, cookieName); ok {
					ctx := context.WithValue(r.Context(), sessionIDKey, id)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
				// Mint failed — fall through unauthenticated. We
				// deliberately do NOT 500 the request; the session
				// list will simply be empty for this principal until
				// the next attempt succeeds.
				next.ServeHTTP(w, r)
				return
			}

			hash := store.HashCookie(cookieValue)
			row, lookupErr := store.GetByCookieHash(r.Context(), hash)
			if lookupErr != nil || row == nil {
				// Unknown cookie. Could be a leftover from a previous
				// install, or an attacker probing. Clear the cookie
				// and pass through; we deliberately don't mint a new
				// one in the same response so the SPA's session
				// monitor surfaces the change cleanly.
				clearCookie(w, cookieName, opts, r)
				next.ServeHTTP(w, r)
				return
			}
			if row.RevokedAt != nil || row.Subject != subject {
				// Revoked, or the cookie was issued for a different
				// subject (subject change without re-mint). Hard 401
				// + clear cookie so the SPA reloads cleanly.
				clearCookie(w, cookieName, opts, r)
				bumper.Forget(row.ID)
				http.Error(w, "session revoked", http.StatusUnauthorized)
				return
			}

			// Active row + matching subject. Debounced last-seen bump.
			if bumper.ShouldBump(row.ID, now()) {
				_ = store.BumpLastSeen(r.Context(), row.ID)
			}
			ctx := context.WithValue(r.Context(), sessionIDKey, row.ID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// mintAndAttach generates a fresh cookie, persists the session row,
// and attaches the Set-Cookie header to w. Returns the new id and true
// on success.
func mintAndAttach(ctx context.Context, store SessionStore, subject string, r *http.Request, w http.ResponseWriter, opts SessionTrackerOptions, cookieName string) (uuid.UUID, bool) {
	token, hash, err := store.MintCookieToken()
	if err != nil {
		return uuid.Nil, false
	}
	id, err := store.Create(ctx, subject, hash, requestUserAgent(r), requestClientIP(r))
	if err != nil {
		return uuid.Nil, false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		Domain:   opts.CookieDomain,
		Secure:   opts.CookieSecure || requestIsTLS(r),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(CookieMaxAge.Seconds()),
	})
	return id, true
}

// clearCookie writes a Set-Cookie header that expires the named cookie
// immediately on the browser. Used on revoke / unknown-cookie paths.
func clearCookie(w http.ResponseWriter, cookieName string, opts SessionTrackerOptions, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		Domain:   opts.CookieDomain,
		Secure:   opts.CookieSecure || requestIsTLS(r),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// CurrentSessionID retrieves the session id stored in the request
// context by Middleware. Returns uuid.Nil + false when the request was
// not tracked (open mode, or before the middleware ran).
func CurrentSessionID(ctx context.Context) (uuid.UUID, bool) {
	if ctx == nil {
		return uuid.Nil, false
	}
	v := ctx.Value(sessionIDKey)
	if v == nil {
		return uuid.Nil, false
	}
	id, ok := v.(uuid.UUID)
	if !ok {
		return uuid.Nil, false
	}
	return id, true
}

// WithSessionForTests returns ctx augmented with id as the
// CurrentSessionID. Exposed only so tests in sibling packages can stage
// the request context without re-implementing the unexported context
// key. Production code MUST go through Middleware to set this value.
func WithSessionForTests(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, sessionIDKey, id)
}

// requestUserAgent returns the trimmed User-Agent header.
func requestUserAgent(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("User-Agent"))
}

// requestClientIP returns the best-effort client IP for r. Prefers
// X-Forwarded-For (left-most) when present, falls back to RemoteAddr.
// Mirrors the helper in internal/api/audit.go but lives here so the
// auth package has no api-package dependency.
func requestClientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		// Left-most non-empty token.
		for _, candidate := range strings.Split(xff, ",") {
			c := strings.TrimSpace(candidate)
			if c == "" {
				continue
			}
			return c
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// requestIsTLS reports whether the inbound request was observed over
// TLS — directly via r.TLS or via the X-Forwarded-Proto header set by a
// terminating reverse proxy.
func requestIsTLS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if proto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))); proto == "https" {
		return true
	}
	return false
}
