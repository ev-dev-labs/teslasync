// Phase-46 / Prompt 57 — Auth-mode contract endpoint.
//
// Exposes a single read-only endpoint the SPA polls to discover:
//
//  1. Whether the deployment is in open mode or behind a ForwardAuth
//     provider.
//  2. The exact header name TeslaSync reads (so the SPA never has to
//     hard-code "X-Forwarded-User").
//  3. The current request's resolved subject value (or null in open
//     mode / when the proxy stripped the header).
//  4. An operator-supplied free-text provider hint (Authentik /
//     Authelia / oauth2-proxy / Keycloak / …) used purely as
//     copy in the SPA — never as a routing key, never to dispatch
//     vendor-specific admin API calls.
//  5. A capability matrix the SPA uses to decide which sections to
//     mount vs. replace with the inline "feature requires
//     authentication" placeholder.
//
// The endpoint is deliberately UNGUARDED — it must answer in open
// mode without a sudo token, and it must answer in forward-auth mode
// even when the upstream proxy stripped the header (so the SPA can
// surface a coherent error instead of looping on an opaque 401). It
// is mounted inside the /api/v1 group below the per-IP rate
// middleware so an aggressive client can't busy-loop it.
//
// Provider-agnostic: TeslaSync never speaks to the upstream IdP's
// admin API. The provider hint is operator-supplied free text.
package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// AuthModeForward / AuthModeOpen are the two values returned in
// AuthModeResponse.Mode. Stable strings — the SPA switches on them.
const (
	AuthModeForward = "forward_auth"
	AuthModeOpen    = "open"
)

// AuthModeResponse is the JSON envelope returned by GET
// /api/v1/system/auth-mode. snake_case keys to match the rest of the
// API surface; the camelCaseKeys transformer on the frontend exposes
// both forms.
type AuthModeResponse struct {
	Mode          string               `json:"mode"`
	SubjectHeader string               `json:"subject_header,omitempty"`
	Subject       *string              `json:"subject,omitempty"`
	ProviderHint  string               `json:"provider_hint,omitempty"`
	Capabilities  AuthModeCapabilities `json:"capabilities"`
}

// AuthModeCapabilities is the per-feature gate the SPA uses to decide
// whether to mount an auth-coupled section or replace it with the
// inline placeholder. Every field is a boolean — there is no "maybe"
// state, and the field set is fixed (additions go in a backward-
// compatible way: SPA defaults missing fields to false).
//
// NB: keep the JSON keys in lock-step with the
// AuthModeCapabilities interface in web/src/api/types.ts. Any drift
// here will silently disable the corresponding SPA section.
type AuthModeCapabilities struct {
	StepUpReauth   bool `json:"step_up_reauth"`
	TOTPEnrollment bool `json:"totp_enrollment"`
	SessionList    bool `json:"session_list"`
	Impersonation  bool `json:"impersonation"`
	RBAC           bool `json:"rbac"`
}

// SystemAuthModeHandler answers GET /api/v1/system/auth-mode. Stateless;
// a single handler instance is shared by the router.
//
// headerName is the trimmed FORWARD_AUTH_HEADER value (typically
// "X-Forwarded-User"); empty puts the response in open mode.
// providerHint is operator-supplied free text (env
// TESLASYNC_AUTH_PROVIDER_HINT) — empty omits the field from the
// response so the SPA falls back to a generic "your auth provider"
// copy.
type SystemAuthModeHandler struct {
	headerName   string
	providerHint string
}

// NewSystemAuthModeHandler builds the handler with the supplied
// configuration snapshot. Both values are trimmed of surrounding
// whitespace so a value pasted with a stray newline still produces
// the correct semantics.
func NewSystemAuthModeHandler(headerName, providerHint string) *SystemAuthModeHandler {
	return &SystemAuthModeHandler{
		headerName:   strings.TrimSpace(headerName),
		providerHint: strings.TrimSpace(providerHint),
	}
}

// ServeHTTP implements http.Handler. Always 200 — the endpoint is the
// SPA's source of truth for "what mode am I in" and a non-200 here
// would force every consumer to invent its own fallback.
func (h *SystemAuthModeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	resp := AuthModeResponse{
		ProviderHint: h.providerHint,
		Capabilities: AuthModeCapabilities{},
	}

	if tsauth.IsOpenMode(h.headerName) {
		resp.Mode = AuthModeOpen
		// Open mode: every auth-coupled capability is unavailable.
		// We deliberately leave Capabilities at the zero value
		// rather than spelling each field out so a future addition
		// (capability X added to the interface) defaults to off in
		// open mode without a code change.
		writeJSON(w, http.StatusOK, resp)
		return
	}

	resp.Mode = AuthModeForward
	resp.SubjectHeader = h.headerName

	// Subject is best-effort — the proxy may have stripped the header
	// on this specific request. The SPA tolerates a null subject (the
	// session-monitor surfaces a "missing identity" toast separately);
	// we do NOT 401 here because the contract endpoint MUST keep
	// answering even when downstream auth is broken.
	if subject, ok := tsauth.SubjectFromRequest(r, h.headerName); ok {
		s := subject
		resp.Subject = &s
	}

	resp.Capabilities = forwardAuthCapabilities()
	writeJSON(w, http.StatusOK, resp)
}

// forwardAuthCapabilities returns the canonical capability matrix
// for forward-auth mode. Centralised so the test pins it without
// re-deriving the truth table from the JSON shape.
//
// All capabilities are currently a flat "true in forward-auth mode"
// — the per-feature gating logic (e.g. "RBAC requires the groups
// header to also be configured") lives inside each feature's own
// handler so the contract endpoint stays a single source of truth
// for the mode itself, not a re-implementation of every feature's
// preconditions.
func forwardAuthCapabilities() AuthModeCapabilities {
	return AuthModeCapabilities{
		StepUpReauth:   true,
		TOTPEnrollment: true,
		SessionList:    true,
		Impersonation:  true,
		RBAC:           true,
	}
}

// authSubjectsStoreAdapter narrows *dbauth.AuthSubjectsRepo to the
// tsauth.SubjectStore interface expected by the recorder. The repo's
// Upsert returns the row for callers (admin panels) that want the
// edited display_name back; the recorder only needs the side-effect
// + error so we drop the row here.
//
// Lives in this file (rather than router.go) because (a) the
// SystemAuthModeHandler is the canonical Phase-46/57 module the rest
// of the auth-mode contract hangs off and (b) keeping the adapter
// next to the handler makes the contract's complete server surface
// reviewable in one file.
type authSubjectsStoreAdapter struct {
	repo *dbauth.AuthSubjectsRepo
}

// Upsert satisfies tsauth.SubjectStore. Errors propagate to the
// recorder, which intentionally swallows them (best-effort audit).
func (a authSubjectsStoreAdapter) Upsert(ctx context.Context, subject string, now time.Time) error {
	if a.repo == nil {
		return nil
	}
	_, err := a.repo.Upsert(ctx, subject, now)
	return err
}

// Compile-time assertions so a future signature drift on either side
// fails the build instead of misleading at runtime.
var (
	_ tsauth.SubjectStore = authSubjectsStoreAdapter{}
)
