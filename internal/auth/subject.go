// Package auth provides subject extraction primitives.
//
// Every authenticated handler in TeslaSync needs to answer two
// questions:
//
//  1. Are we in open mode (no FORWARD_AUTH_HEADER configured) or in
//     forward-auth mode?
//  2. If forward-auth, what is the opaque subject string carried by
//     the configured header on this request?
//
// Centralising the answers here means downstream handlers don't
// re-implement the same `if h.headerName == "" { … 501 … }` ladder
// with subtly different code paths — historically this drift has
// produced AUTH_MODE_OPEN responses that mismatch on code, status, or
// JSON shape across handlers.
//
// The package is provider-agnostic. No assumption is made about which
// proxy minted the header (Authentik, Authelia, oauth2-proxy,
// Keycloak, …) or about the value's internal structure. The subject
// is treated as an opaque identifier — comparison is exact (no case
// folding, no domain stripping) so the cross-table join with
// auth_subjects, auth_sessions, audit_logs and the future RBAC layer
// stays consistent.
package auth

import (
	"encoding/json"
	"net/http"
	"strings"
)

// AuthModeOpenCode is the canonical machine-readable signal returned
// when an endpoint cannot operate without a configured upstream
// identity provider. The frontend's hooks (useAuthMode, useTOTP,
// useSessions, useImpersonation, useRbacMatrix) all match this exact
// string to decide whether to render the inline "feature requires
// authentication" placeholder.
//
// Mirrors internal/api.AuthModeOpenCode — kept duplicated here so the
// auth package has no dependency on the api package (which already
// depends on this one).
const AuthModeOpenCode = "AUTH_MODE_OPEN"

// MissingIdentityCode is returned when FORWARD_AUTH_HEADER is
// configured but the inbound request did not carry a value. The proxy
// is misconfigured or stripped the header — in either case the API
// cannot honour the request and 401 is the right answer.
const MissingIdentityCode = "MISSING_IDENTITY"

// SubjectFromRequest pulls the principal identity out of r based on
// the configured headerName.
//
// Returns ("", false) in two distinct situations the caller may want
// to handle differently:
//
//   - headerName == "": OPEN MODE. The deployment has no upstream
//     identity provider configured; downstream handlers SHOULD
//     respond 501 with code AUTH_MODE_OPEN.
//   - header configured but absent / whitespace-only on this request:
//     FORWARD-AUTH MODE WITH MISSING HEADER. Downstream handlers
//     SHOULD respond 401 with code MISSING_IDENTITY.
//
// Use [IsOpenMode] when you need to disambiguate — bare bool checks
// against the second return alone conflate the two states.
func SubjectFromRequest(r *http.Request, headerName string) (subject string, present bool) {
	if headerName == "" {
		return "", false
	}
	if r == nil {
		return "", false
	}
	subject = strings.TrimSpace(r.Header.Get(headerName))
	if subject == "" {
		return "", false
	}
	return subject, true
}

// IsOpenMode reports whether headerName disables identity entirely.
// Exposed as a tiny helper so callers can read at the abstraction
// level "are we in open mode" without comparing strings inline.
func IsOpenMode(headerName string) bool {
	return headerName == ""
}

// RequireSubjectMiddleware refuses to admit requests that lack a
// resolvable principal. Use this on endpoints that have no sensible
// open-mode behaviour and would otherwise need to repeat the same
// 501 / 401 ladder in their handler bodies.
//
// Behaviour:
//
//   - headerName == "": every request is rejected with 501
//     AUTH_MODE_OPEN before next.ServeHTTP runs.
//   - headerName configured + missing on this request: 401
//     MISSING_IDENTITY.
//   - header present + non-empty: passthrough to next.
//
// The middleware does not stash the subject in the request context —
// downstream handlers continue to read it from the header directly so
// the request-context surface stays minimal. Adding a
// SubjectContextKey here would be a visible coupling cost without a
// concrete reuse case yet.
func RequireSubjectMiddleware(headerName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if headerName == "" {
				writeJSONError(w, http.StatusNotImplemented,
					"this feature requires forward-auth mode", AuthModeOpenCode)
				return
			}
			if _, ok := SubjectFromRequest(r, headerName); !ok {
				writeJSONError(w, http.StatusUnauthorized,
					"missing identity header", MissingIdentityCode)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeJSONError mirrors internal/api.writeErrorCode shape so the SPA
// can match the exact same { error, code } envelope regardless of
// which package emitted the response. Kept private because the only
// caller is RequireSubjectMiddleware — the api package's helper is
// the right choice everywhere else.
func writeJSONError(w http.ResponseWriter, status int, msg, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": msg,
		"code":  code,
	})
}
