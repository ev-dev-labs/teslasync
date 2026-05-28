// Phase-46 / Prompt 46 — Admin impersonation handler.
//
// Four endpoints back the SPA's impersonation flow:
//
//	GET  /api/v1/admin/impersonate            → current state for the banner
//	POST /api/v1/admin/impersonate            → start (sudo-gated upstream)
//	POST /api/v1/admin/impersonate/end        → end + clear cookie
//	GET  /api/v1/admin/impersonate/candidates → distinct subjects (excluding actor)
//
// Provider-agnostic. The candidate list comes from
// `auth_sessions.subject DISTINCT WHERE revoked_at IS NULL` because
// prompt 57 (auth_subjects + RequireSubjectMiddleware) has not yet
// shipped. When prompt 57 lands, swap the candidates query to read
// from `auth_subjects` directly.
//
// Auth-mode awareness. In open mode (no FORWARD_AUTH_HEADER configured)
// every endpoint returns 501 with code AUTH_MODE_OPEN so the SPA's
// useImpersonation hook can render the inline placeholder without a
// noisy 401 loop. The POST start route is wrapped in RequireSudo
// upstream — that middleware is itself a passthrough in open mode, so
// the open-mode check below intentionally fires before any database
// work and never depends on the sudo middleware running.
//
// Audit. Every successful start AND end writes a row to audit_logs
// via the AuditRepo. Cookie expiry does NOT fire an end row — only an
// explicit POST /admin/impersonate/end does — so the count of end
// rows is a precise "manually ended" metric.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// MaxImpersonationStartBodyBytes caps the JSON body of POST
// /admin/impersonate. The body is a tiny `{ "subject": "..." }` object
// (~256 bytes worst case) so 4 KiB is generous; the cap prevents a
// buggy or malicious caller from streaming an unbounded payload at us.
const MaxImpersonationStartBodyBytes int64 = 4 * 1024

// ImpersonationErrorCode is the structured `code` field returned in
// the JSON error envelope. Stable strings the SPA's typed-fetch layer
// matches instead of HTTP status alone.
const (
	ImpersonationCodeBadBody              = "INVALID_BODY"
	ImpersonationCodeMissingIdentity      = "MISSING_IDENTITY"
	ImpersonationCodeInvalidTarget        = "INVALID_IMPERSONATION_TARGET"
	ImpersonationCodeAlreadyImpersonating = "ALREADY_IMPERSONATING"
	ImpersonationCodeMintFailed           = "IMPERSONATION_MINT_FAILED"
	ImpersonationCodeAuditFailed          = "IMPERSONATION_AUDIT_FAILED"
	ImpersonationCodeCandidatesFailed     = "IMPERSONATION_CANDIDATES_FAILED"
)

// ImpersonationCandidatesStore is the storage seam used by the
// candidates endpoint. Production wires *auditdb.AuditRepo (which
// owns the auth_sessions DISTINCT query for this prompt — see the
// comment in audit_repo.go for why a temporary lodge there is
// preferable to a new repo file outside the allowed-files set).
type ImpersonationCandidatesStore interface {
	ListDistinctActiveSubjects(ctx context.Context) ([]string, error)
}

// ImpersonationAuditWriter is the storage seam for the impersonation
// audit-row writers. Production wires *auditdb.AuditRepo; tests
// substitute an in-memory fake.
type ImpersonationAuditWriter interface {
	WriteImpersonationStart(ctx context.Context, evt auditdb.AuditImpersonationEvent) error
	WriteImpersonationEnd(ctx context.Context, evt auditdb.AuditImpersonationEvent) error
}

// ImpersonationHandler bundles the four impersonation endpoints.
// headerName is captured at construction so the open-mode check is
// consistent with the rest of the handlers wired against the same
// config snapshot.
type ImpersonationHandler struct {
	store      *tsauth.ImpersonationStore
	candidates ImpersonationCandidatesStore
	audit      ImpersonationAuditWriter
	headerName string // FORWARD_AUTH_HEADER value; empty == open mode.
}

// NewImpersonationHandler builds the handler. headerName is the
// trimmed FORWARD_AUTH_HEADER value (typically "X-Forwarded-User");
// empty puts every endpoint into open-mode (501 AUTH_MODE_OPEN)
// responses.
func NewImpersonationHandler(
	store *tsauth.ImpersonationStore,
	candidates ImpersonationCandidatesStore,
	audit ImpersonationAuditWriter,
	headerName string,
) *ImpersonationHandler {
	return &ImpersonationHandler{
		store:      store,
		candidates: candidates,
		audit:      audit,
		headerName: strings.TrimSpace(headerName),
	}
}

// impersonationStartRequest is the body shape accepted by POST
// /admin/impersonate.
type impersonationStartRequest struct {
	Subject string `json:"subject"`
}

// impersonationStateResponse is the GET /admin/impersonate envelope.
// Mode is `open` in open-mode installs, `inactive` when no cookie is
// present, and `active` when the request is currently impersonating.
type impersonationStateResponse struct {
	Mode          string `json:"mode"`
	OriginalAdmin string `json:"original_admin,omitempty"`
	Target        string `json:"target,omitempty"`
	ExpiresAt     string `json:"expires_at,omitempty"`
}

// impersonationCandidatesResponse is the GET
// /admin/impersonate/candidates envelope.
type impersonationCandidatesResponse struct {
	Mode       string                   `json:"mode"`
	Candidates []impersonationCandidate `json:"candidates"`
}

// impersonationCandidate is one row in the candidates list. Subject
// is the opaque proxy-issued identity; the SPA renders it verbatim
// because the future prompt 57 may add a display-name column without
// changing this contract.
type impersonationCandidate struct {
	Subject string `json:"subject"`
}

// impersonationStartResponse is the success-shape returned by POST
// /admin/impersonate. ExpiresAt is RFC3339 UTC.
type impersonationStartResponse struct {
	Mode          string `json:"mode"`
	OriginalAdmin string `json:"original_admin"`
	Target        string `json:"target"`
	ExpiresAt     string `json:"expires_at"`
}

// resolveActor pulls the original admin subject from the request.
// During an active impersonation the FORWARD_AUTH header has been
// rewritten to target, so we MUST read from the impersonation claim
// in context first; outside of impersonation we fall back to the
// header. Returns ("", true) when the install is in open mode so the
// caller can short-circuit with 501 AUTH_MODE_OPEN.
func (h *ImpersonationHandler) resolveActor(r *http.Request) (actor string, openMode bool) {
	if h.headerName == "" {
		return "", true
	}
	if claim, ok := tsauth.CurrentImpersonationClaim(r.Context()); ok {
		return claim.OriginalAdmin, false
	}
	return strings.TrimSpace(r.Header.Get(h.headerName)), false
}

// writeOpenModeNotImplementedImpersonation is the canonical 501
// response in open mode. Centralised so the SPA's useImpersonation
// hook can match the exact code without snake-vs-camel drift.
func writeOpenModeNotImplementedImpersonation(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusNotImplemented,
		"impersonation requires forward-auth mode", AuthModeOpenCode)
}

// GetState implements GET /api/v1/admin/impersonate.
//
// Returns the current impersonation state for the calling browser.
// The banner polls this endpoint every 30 seconds and uses it to
// decide whether to render itself.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401 MISSING_IDENTITY.
// Forward-auth, no cookie: 200 mode="inactive".
// Forward-auth, valid cookie: 200 mode="active" with subjects + expiry.
func (h *ImpersonationHandler) GetState(w http.ResponseWriter, r *http.Request) {
	if h.headerName == "" {
		writeOpenModeNotImplementedImpersonation(w)
		return
	}
	// Always require an authenticated principal — even when no
	// impersonation is active — so an unauthenticated caller can't
	// poll the endpoint as an oracle.
	if strings.TrimSpace(r.Header.Get(h.headerName)) == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", ImpersonationCodeMissingIdentity)
		return
	}
	if claim, ok := tsauth.CurrentImpersonationClaim(r.Context()); ok {
		writeJSON(w, http.StatusOK, impersonationStateResponse{
			Mode:          "active",
			OriginalAdmin: claim.OriginalAdmin,
			Target:        claim.Target,
			ExpiresAt:     claim.ExpiresAt.UTC().Format(time.RFC3339),
		})
		return
	}
	writeJSON(w, http.StatusOK, impersonationStateResponse{Mode: "inactive"})
}

// Start implements POST /api/v1/admin/impersonate.
//
// Sudo-gated upstream and wrapped in RequireNotImpersonating; the
// handler trusts both middlewares ran before it.
//
// Validates that the supplied target subject:
//   - is non-empty
//   - differs from the actor
//   - appears in the active-subject candidates list (not just any
//     string the caller invented — defends against typos)
//
// On success, mints an HMAC-signed cookie (15-minute TTL), writes the
// audit row, and returns 200 with the same envelope GetState would
// return on the next request. Returning the envelope rather than 204
// lets the SPA prime its cache without a follow-up GET.
func (h *ImpersonationHandler) Start(w http.ResponseWriter, r *http.Request) {
	if h.headerName == "" {
		writeOpenModeNotImplementedImpersonation(w)
		return
	}
	// RequireNotImpersonating is mounted upstream, but check defensively
	// in case this handler is wired without the middleware in a test.
	if tsauth.IsImpersonating(r.Context()) {
		writeErrorCode(w, http.StatusConflict,
			"already impersonating; end the current session first",
			ImpersonationCodeAlreadyImpersonating)
		return
	}
	actor := strings.TrimSpace(r.Header.Get(h.headerName))
	if actor == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", ImpersonationCodeMissingIdentity)
		return
	}
	body, err := decodeImpersonationStartBody(r)
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, err.Error(), ImpersonationCodeBadBody)
		return
	}
	target := strings.TrimSpace(body.Subject)
	if target == "" {
		writeErrorCode(w, http.StatusBadRequest,
			"subject is required", ImpersonationCodeInvalidTarget)
		return
	}
	if target == actor {
		writeErrorCode(w, http.StatusBadRequest,
			"cannot impersonate self", ImpersonationCodeInvalidTarget)
		return
	}
	// Validate target appears in the candidate list. This defends
	// against typos and against impersonating a freshly-revoked
	// subject. Open the candidates list ONCE and reuse it.
	candidates, err := h.candidates.ListDistinctActiveSubjects(r.Context())
	if err != nil {
		writeErrorCode(w, http.StatusInternalServerError,
			"failed to load candidates", ImpersonationCodeCandidatesFailed)
		return
	}
	if !containsString(candidates, target) {
		writeErrorCode(w, http.StatusBadRequest,
			"target subject is not a known active session",
			ImpersonationCodeInvalidTarget)
		return
	}
	token, expiresAt, err := h.store.Mint(actor, target)
	if err != nil {
		writeErrorCode(w, http.StatusInternalServerError,
			"failed to mint impersonation cookie", ImpersonationCodeMintFailed)
		return
	}
	if h.audit != nil {
		if writeErr := h.audit.WriteImpersonationStart(r.Context(), auditdb.AuditImpersonationEvent{
			Actor:     actor,
			Target:    target,
			IP:        impersonationClientIP(r),
			UserAgent: r.UserAgent(),
		}); writeErr != nil {
			writeErrorCode(w, http.StatusInternalServerError,
				"failed to write audit row", ImpersonationCodeAuditFailed)
			return
		}
	}
	tsauth.SetImpersonationCookie(w, r, token)
	writeJSON(w, http.StatusOK, impersonationStartResponse{
		Mode:          "active",
		OriginalAdmin: actor,
		Target:        target,
		ExpiresAt:     expiresAt.UTC().Format(time.RFC3339),
	})
}

// End implements POST /api/v1/admin/impersonate/end.
//
// NOT sudo-gated — ending impersonation should always succeed without
// a re-auth prompt. Idempotent: a request without an active cookie
// still returns 204 so a parallel-tab end click does not surface an
// error toast.
//
// Open mode: 501 AUTH_MODE_OPEN. The SPA never calls this in open
// mode (the banner is hidden) but routing it consistently means a
// misconfigured proxy flipping mode mid-flight does not 5xx.
func (h *ImpersonationHandler) End(w http.ResponseWriter, r *http.Request) {
	if h.headerName == "" {
		writeOpenModeNotImplementedImpersonation(w)
		return
	}
	claim, ok := tsauth.CurrentImpersonationClaim(r.Context())
	// Always clear the cookie defensively, even when no claim is
	// active, so a malformed cookie is unstuck on the next request.
	tsauth.ClearImpersonationCookie(w, r)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if h.audit != nil {
		if writeErr := h.audit.WriteImpersonationEnd(r.Context(), auditdb.AuditImpersonationEvent{
			Actor:     claim.OriginalAdmin,
			Target:    claim.Target,
			IP:        impersonationClientIP(r),
			UserAgent: r.UserAgent(),
		}); writeErr != nil {
			// Audit failure should NOT block end — the cookie is
			// already cleared. Surface a 5xx so the SPA can log the
			// failure but still reflect the cleared state.
			writeErrorCode(w, http.StatusInternalServerError,
				"failed to write audit row", ImpersonationCodeAuditFailed)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// Candidates implements GET /api/v1/admin/impersonate/candidates.
//
// Returns the distinct subjects with at least one active
// auth_sessions row, EXCLUDING the calling actor. The SPA hides the
// "Impersonate" button when this list is empty (single-subject
// install) so the user never sees a button that can't possibly
// produce a valid target.
//
// Open mode: 501 AUTH_MODE_OPEN.
// Forward-auth, missing header: 401 MISSING_IDENTITY.
// Forward-auth, header set: 200 with the filtered list.
func (h *ImpersonationHandler) Candidates(w http.ResponseWriter, r *http.Request) {
	actor, openMode := h.resolveActor(r)
	if openMode {
		writeOpenModeNotImplementedImpersonation(w)
		return
	}
	if actor == "" {
		writeErrorCode(w, http.StatusUnauthorized,
			"missing identity header", ImpersonationCodeMissingIdentity)
		return
	}
	subjects, err := h.candidates.ListDistinctActiveSubjects(r.Context())
	if err != nil {
		writeErrorCode(w, http.StatusInternalServerError,
			"failed to load candidates", ImpersonationCodeCandidatesFailed)
		return
	}
	out := make([]impersonationCandidate, 0, len(subjects))
	for _, s := range subjects {
		if s == actor {
			continue
		}
		out = append(out, impersonationCandidate{Subject: s})
	}
	writeJSON(w, http.StatusOK, impersonationCandidatesResponse{
		Mode:       "session",
		Candidates: out,
	})
}

// decodeImpersonationStartBody parses the request body with a hard
// 4 KiB cap and DisallowUnknownFields. The body is validated at the
// JSON level only; subject content checks live in the Start handler.
func decodeImpersonationStartBody(r *http.Request) (impersonationStartRequest, error) {
	var body impersonationStartRequest
	if r.Body == nil {
		return body, errors.New("missing request body")
	}
	limited := http.MaxBytesReader(nil, r.Body, MaxImpersonationStartBodyBytes)
	defer limited.Close()
	dec := json.NewDecoder(limited)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return body, errors.New("invalid request body")
	}
	if dec.More() {
		return body, errors.New("trailing junk after json")
	}
	body.Subject = strings.TrimSpace(body.Subject)
	return body, nil
}

// containsString reports whether s appears in the slice. Inline
// helper rather than a slices.Contains call so the Go 1.20 baseline
// stays unchallenged for this tiny use case.
func containsString(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}

// impersonationClientIP extracts the best-effort client IP for r,
// preferring X-Forwarded-For (left-most) then RemoteAddr. Mirrors the
// helper in audit.go but lives in this file so the impersonation
// audit-write path has zero cross-file dependencies on the legacy
// audit helpers.
func impersonationClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
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
