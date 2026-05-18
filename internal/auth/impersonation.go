// Package auth — admin impersonation primitives (Phase-46 / Prompt 46).
//
// When supporting another user (or family member) an admin needs to
// "see what they see" without juggling browsers/incognito sessions.
// This file implements an HMAC-signed cookie that lets an admin
// temporarily borrow another subject's identity for read-only
// diagnostics. Every authenticated handler downstream of
// [ImpersonationMiddleware] sees the impersonation TARGET as the
// principal — the admin's original identity is preserved in the
// request context for audit purposes.
//
// Threat model
// ------------
//   - The cookie carries a signed payload, NOT a server-side session
//     id. A leaked cookie can replay until the embedded expiry
//     elapses (15 minutes); revocation is "visit /admin/impersonate/end
//     or wait it out".
//   - The cookie is bound to the original admin subject — the
//     middleware re-validates on every request that the current
//     forwarded subject still matches the admin embedded in the
//     cookie. A leftover cookie on a shared browser cannot
//     impersonate anyone for a different signed-in user.
//   - The HMAC key is generated freshly per process so a database
//     dump alone cannot mint a forged cookie. Cookies issued before
//     a restart become invalid; this is acceptable for a 15-minute
//     primitive.
//
// AUTH-MODE AWARENESS. Open-mode installs (no FORWARD_AUTH_HEADER) have
// no per-user identity to bind a cookie to, so the middleware is a
// passthrough and every endpoint in [ImpersonationHandler] returns 501
// AUTH_MODE_OPEN.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ImpersonationCookieName is the cookie TeslaSync sets when an admin
// starts an impersonation session. Distinct from
// [SessionCookieName] so the proxy can co-route both cookies and
// neither overwrites the other on its set/clear cycle.
const ImpersonationCookieName = "teslasync_impersonate"

// ImpersonationTTL is how long an impersonation cookie remains valid.
// 15 minutes is the upper bound of a typical "support call" — long
// enough for a diagnosis, short enough that a forgotten cookie ages
// out before the admin notices.
const ImpersonationTTL = 15 * time.Minute

// ImpersonationBlockedCode is the JSON `code` string returned by
// [RequireNotImpersonating] when it rejects a request. The SPA's
// fetch interceptor matches on this exact string to render a help
// modal explaining "you can't change credentials while impersonating".
const ImpersonationBlockedCode = "IMPERSONATION_BLOCKED"

// ImpersonationCookieMaxBytes caps the cookie payload after base64
// encoding. The payload is a tiny JSON object (3 fields) so 4 KiB is
// generous; the cap exists so a forged cookie can't make the
// validation step pin the API process by streaming an unbounded body
// at us through the cookie header.
const ImpersonationCookieMaxBytes = 4 * 1024

// ErrImpersonationCookieMissing means the request had no cookie. Not
// an error per se — every non-impersonating request is in this state.
var ErrImpersonationCookieMissing = errors.New("impersonation: cookie missing")

// ErrImpersonationCookieInvalid is returned by [ImpersonationStore.Verify]
// when the HMAC fails, the payload is malformed, or the embedded
// expiry has elapsed. Callers MUST clear the cookie and treat the
// request as non-impersonating; never re-mint without a fresh
// /admin/impersonate POST.
var ErrImpersonationCookieInvalid = errors.New("impersonation: cookie invalid")

// ImpersonationClaim is the canonical in-memory shape of a decoded
// impersonation cookie.
type ImpersonationClaim struct {
	// OriginalAdmin is the subject that started the impersonation —
	// the value the FORWARD_AUTH_HEADER carried at start time. The
	// middleware re-validates this on every request to defend against
	// shared-browser cookie carryover.
	OriginalAdmin string `json:"a"`

	// Target is the subject the admin is currently viewing. The
	// middleware rewrites FORWARD_AUTH_HEADER to this value so all
	// downstream handlers see the target as the principal.
	Target string `json:"t"`

	// ExpiresAt is the wall-clock instant the cookie stops being
	// valid. Verified before HMAC-comparison fails so a long-stale
	// cookie returns ErrImpersonationCookieInvalid quickly.
	ExpiresAt time.Time `json:"e"`
}

// impersonationContextKey is a private type so the request-context
// values cannot be shadowed by an unrelated package using the same
// string.
type impersonationContextKey int

const (
	// impersonationClaimKey stores the validated [ImpersonationClaim]
	// produced by [ImpersonationMiddleware]. Handlers that need to
	// know "is this request impersonated?" pull from here via
	// [CurrentImpersonationClaim].
	impersonationClaimKey impersonationContextKey = iota
)

// ImpersonationStore signs and verifies impersonation cookies. Each
// process gets a fresh HMAC key on construction; cookies do not
// survive restart. That is the desired semantic — a 15-minute
// primitive should not outlive the process that minted it.
type ImpersonationStore struct {
	key []byte
	now func() time.Time
}

// NewImpersonationStore constructs a store with a freshly-generated
// 32-byte HMAC key. Returns an error only if the host's CSPRNG is
// inaccessible — in that case the caller should fail process startup
// rather than silently mint forgeable cookies.
func NewImpersonationStore() (*ImpersonationStore, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("impersonation: generate hmac key: %w", err)
	}
	return &ImpersonationStore{key: key, now: time.Now}, nil
}

// SetNowForTests replaces the store's internal clock. Tests use this
// to cover the expiry boundary deterministically; production never
// touches it.
func (s *ImpersonationStore) SetNowForTests(fn func() time.Time) {
	if fn == nil {
		s.now = time.Now
		return
	}
	s.now = fn
}

// Mint produces a signed cookie value carrying the supplied claim.
// The caller is responsible for setting the cookie header; this
// method only encodes + signs.
//
// Both subjects are trimmed; empty values return an error rather than
// silently minting a useless cookie.
func (s *ImpersonationStore) Mint(originalAdmin, target string) (token string, expiresAt time.Time, err error) {
	if s == nil {
		return "", time.Time{}, errors.New("impersonation: store nil")
	}
	originalAdmin = strings.TrimSpace(originalAdmin)
	target = strings.TrimSpace(target)
	if originalAdmin == "" {
		return "", time.Time{}, errors.New("impersonation: original admin required")
	}
	if target == "" {
		return "", time.Time{}, errors.New("impersonation: target required")
	}
	if originalAdmin == target {
		return "", time.Time{}, errors.New("impersonation: cannot impersonate self")
	}
	expiresAt = s.now().UTC().Add(ImpersonationTTL)
	claim := ImpersonationClaim{
		OriginalAdmin: originalAdmin,
		Target:        target,
		ExpiresAt:     expiresAt,
	}
	payload, err := json.Marshal(claim)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("impersonation: marshal: %w", err)
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return body + "." + sig, expiresAt, nil
}

// Verify decodes and validates a cookie value. Returns the embedded
// claim on success or [ErrImpersonationCookieInvalid] on any failure.
// All failure modes return the same sentinel so a probe can't distinguish
// "wrong signature" from "expired payload" — both mean "throw it out".
func (s *ImpersonationStore) Verify(token string) (ImpersonationClaim, error) {
	var zero ImpersonationClaim
	if s == nil {
		return zero, ErrImpersonationCookieInvalid
	}
	if token == "" {
		return zero, ErrImpersonationCookieMissing
	}
	if len(token) > ImpersonationCookieMaxBytes {
		return zero, ErrImpersonationCookieInvalid
	}
	dot := strings.IndexByte(token, '.')
	if dot <= 0 || dot == len(token)-1 {
		return zero, ErrImpersonationCookieInvalid
	}
	body := token[:dot]
	sig := token[dot+1:]
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(body))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	// Constant-time compare so signature length is not leaked.
	if subtleConstantTimeStringEq(sig, expected) != 1 {
		return zero, ErrImpersonationCookieInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return zero, ErrImpersonationCookieInvalid
	}
	var claim ImpersonationClaim
	if err := json.Unmarshal(payload, &claim); err != nil {
		return zero, ErrImpersonationCookieInvalid
	}
	if strings.TrimSpace(claim.OriginalAdmin) == "" || strings.TrimSpace(claim.Target) == "" {
		return zero, ErrImpersonationCookieInvalid
	}
	if claim.ExpiresAt.IsZero() || s.now().After(claim.ExpiresAt) {
		return zero, ErrImpersonationCookieInvalid
	}
	return claim, nil
}

// subtleConstantTimeStringEq is a length-tolerant constant-time string
// equality helper. Returns 1 iff the strings are byte-identical.
//
// Avoids importing crypto/subtle just for one call so this file's
// dependency surface stays small; the implementation is the standard
// XOR-OR-fold pattern from crypto/subtle.ConstantTimeCompare.
func subtleConstantTimeStringEq(a, b string) int {
	if len(a) != len(b) {
		return 0
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	if v == 0 {
		return 1
	}
	return 0
}

// ImpersonationMiddleware returns the request-rewriting middleware.
//
// When the inbound request has a valid impersonation cookie AND the
// embedded original-admin still matches the forwarded subject, the
// middleware:
//
//  1. Sets the impersonation claim into the request context.
//  2. Rewrites the FORWARD_AUTH header to the impersonation TARGET so
//     every downstream handler reads the target as the principal.
//
// Any of the following invalidates the cookie and clears it:
//
//   - The cookie is missing (normal non-impersonating request).
//   - The HMAC verification fails or the payload has expired.
//   - The forwarded subject does not match the cookie's
//     original-admin field (cookie carryover from a previous user on
//     a shared browser).
//
// The middleware MUST be mounted AFTER [ForwardAuthMiddleware] (so
// the principal header is guaranteed present) AND AFTER [Middleware]
// (the session tracker), so the tracker pins to the admin's actual
// identity rather than the impersonation target.
//
// In open mode (headerName == "") OR when store is nil, the
// middleware is a passthrough — there is no per-user identity to bind
// the cookie to, so the only correct behaviour is to do nothing.
func ImpersonationMiddleware(headerName string, store *ImpersonationStore) func(http.Handler) http.Handler {
	if headerName == "" || store == nil {
		return func(next http.Handler) http.Handler { return next }
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(ImpersonationCookieName)
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			claim, verifyErr := store.Verify(cookie.Value)
			if verifyErr != nil {
				clearImpersonationCookie(w, r)
				next.ServeHTTP(w, r)
				return
			}
			currentSubject := strings.TrimSpace(r.Header.Get(headerName))
			if currentSubject == "" || currentSubject != claim.OriginalAdmin {
				// Cookie carryover from a previous user on a shared
				// browser, OR the proxy stripped the identity for
				// this request. Either way, the cookie is stale —
				// clear it and pass through.
				clearImpersonationCookie(w, r)
				next.ServeHTTP(w, r)
				return
			}
			// Active impersonation: rewrite the principal header and
			// thread the claim into context so the impersonate
			// handler (and any future audit-aware handler) can fetch
			// the original admin without re-parsing the cookie.
			r.Header.Set(headerName, claim.Target)
			ctx := context.WithValue(r.Context(), impersonationClaimKey, claim)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// CurrentImpersonationClaim retrieves the impersonation claim stored
// in ctx by [ImpersonationMiddleware]. Returns the zero value + false
// when the request is not impersonated (the common case).
func CurrentImpersonationClaim(ctx context.Context) (ImpersonationClaim, bool) {
	if ctx == nil {
		return ImpersonationClaim{}, false
	}
	v := ctx.Value(impersonationClaimKey)
	if v == nil {
		return ImpersonationClaim{}, false
	}
	claim, ok := v.(ImpersonationClaim)
	if !ok {
		return ImpersonationClaim{}, false
	}
	return claim, true
}

// IsImpersonating reports whether ctx carries a validated
// impersonation claim. Convenience wrapper around
// [CurrentImpersonationClaim] for the common boolean check.
func IsImpersonating(ctx context.Context) bool {
	_, ok := CurrentImpersonationClaim(ctx)
	return ok
}

// OriginalAdminSubject returns the admin subject that started the
// impersonation, or empty string when the request is not
// impersonated. The audit handler uses this to attribute
// impersonation.end events to the right operator even though the
// request's FORWARD_AUTH header has been rewritten to target.
func OriginalAdminSubject(ctx context.Context) string {
	claim, ok := CurrentImpersonationClaim(ctx)
	if !ok {
		return ""
	}
	return claim.OriginalAdmin
}

// WithImpersonationForTests returns ctx augmented with the supplied
// claim as the active impersonation. Exposed only so tests in sibling
// packages can stage the request context without re-implementing the
// unexported context key. Production code MUST go through
// [ImpersonationMiddleware] to set this value.
func WithImpersonationForTests(ctx context.Context, claim ImpersonationClaim) context.Context {
	return context.WithValue(ctx, impersonationClaimKey, claim)
}

// RequireNotImpersonating returns a middleware that rejects requests
// arriving with an active impersonation claim. Mount this on every
// route that must NOT be exercised on behalf of someone else —
// credential changes, sudo-token mints, identity-management actions,
// etc. The middleware is a passthrough when no claim is present, so
// regular admin traffic is unaffected.
//
// On reject the response is 403 Forbidden with the structured
// envelope:
//
//	{"error": "...", "code": "IMPERSONATION_BLOCKED"}
//
// The SPA's fetch interceptor matches on `code === IMPERSONATION_BLOCKED`
// to render a help modal explaining "end your impersonation session
// before performing this action".
func RequireNotImpersonating() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if IsImpersonating(r.Context()) {
				writeImpersonationBlocked(w, "this action is not allowed during an impersonation session")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeImpersonationBlocked writes the canonical 403 envelope used by
// [RequireNotImpersonating]. Centralised so the SPA can match the
// `code` field exactly without the indirection of a per-route
// handler-side string.
func writeImpersonationBlocked(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	body := map[string]string{
		"error": message,
		"code":  ImpersonationBlockedCode,
	}
	_ = json.NewEncoder(w).Encode(body)
}

// SetImpersonationCookie writes a Set-Cookie header carrying the
// supplied signed token. The cookie is HttpOnly, SameSite=Lax, and
// Secure when the request was observed over TLS — same posture as
// the session-tracker cookie.
//
// MaxAge is set from [ImpersonationTTL] so a browser tab that never
// sees a server response again will eventually drop the cookie even
// without a clean /admin/impersonate/end call.
func SetImpersonationCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     ImpersonationCookieName,
		Value:    token,
		Path:     "/",
		Secure:   requestIsTLS(r),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ImpersonationTTL.Seconds()),
	})
}

// ClearImpersonationCookie writes a Set-Cookie header that expires
// the impersonation cookie immediately on the browser. Used by the
// /admin/impersonate/end handler and by the middleware on cookie
// invalidation.
func ClearImpersonationCookie(w http.ResponseWriter, r *http.Request) {
	clearImpersonationCookie(w, r)
}

// clearImpersonationCookie is the unexported worker shared between
// the public ClearImpersonationCookie helper and the middleware.
// Centralising the cookie attributes prevents drift between mint and
// clear sites.
func clearImpersonationCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     ImpersonationCookieName,
		Value:    "",
		Path:     "/",
		Secure:   requestIsTLS(r),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
