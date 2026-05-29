// MaskedRevealHandler powers POST /api/v1/audit/reveal.
//
// The route is the server-side leg of the `<MaskedValue>` privacy
// primitive: every time an operator clicks the eye toggle to reveal
// a sensitive value (API token, VIN, lat/lng, email, etc.) the SPA
// fires a fire-and-forget POST here so the action lands in
// `audit_logs` for after-the-fact review.
package audit

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"

	"github.com/rs/zerolog/log"
)

// MaxRevealAuditBodyBytes caps the POST body. The expected payload
// is a small JSON object (~100 bytes); 1KB rejects misbehaving
// clients without ever allocating more than necessary.
const MaxRevealAuditBodyBytes = 1024

// AllowedRevealVariants lists the variants the SPA's <MaskedValue>
// component knows how to render. Any other value is rejected with a
// 400 so a typo in a future caller does not silently pollute the
// audit_logs table with junk entity_type rows.
var AllowedRevealVariants = map[string]struct{}{
	"token":   {},
	"vin":     {},
	"coords":  {},
	"email":   {},
	"generic": {},
}

// AllowedRevealKinds lists the supported `kind` discriminators. For
// now only `masked_reveal` is meaningful but the field is forward-
// compatible (e.g. a future "masked_export" event would extend the
// set without rewriting the wire format).
var AllowedRevealKinds = map[string]struct{}{
	"masked_reveal": {},
}

// revealAuditRequest is the canonical wire shape for the POST body.
//
// `variant` is required and must be one of AllowedRevealVariants.
// `kind` is optional but, when supplied, must match
// AllowedRevealKinds. Unknown JSON fields are rejected so a typo at
// the call site (e.g. `varient` instead of `variant`) fails loudly
// rather than silently writing a NULL into audit_logs.
type revealAuditRequest struct {
	Kind    string `json:"kind"`
	Variant string `json:"variant"`
}

// MaskedRevealHandler is the HTTP handler for POST /audit/reveal.
//
// It depends on:
//   - a `*auditdb.AuditRepo` for the actual write,
//   - the configured ForwardAuth header so the actor identity can be
//     resolved (when AUTH is enabled).
//
// The handler is constructed once during router setup and shared
// across all requests; it holds no per-request state.
type MaskedRevealHandler struct {
	repo              *auditdb.AuditRepo
	forwardAuthHeader string
}

// NewMaskedRevealHandler constructs a handler. `repo` MUST be
// non-nil; passing nil yields a handler that 500s every request,
// which is intentionally loud — there is no graceful degradation
// path for a misconfigured audit pipeline.
func NewMaskedRevealHandler(repo *auditdb.AuditRepo, forwardAuthHeader string) *MaskedRevealHandler {
	return &MaskedRevealHandler{
		repo:              repo,
		forwardAuthHeader: forwardAuthHeader,
	}
}

// Reveal is the chi-compatible HTTP handler for POST /api/v1/audit/reveal.
// It lives behind the same auth gate as every other /api/v1 route.
func (h *MaskedRevealHandler) Reveal(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.repo == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "audit pipeline not configured")
		return
	}

	body, err := decodeRevealAuditBody(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, ok := AllowedRevealVariants[body.Variant]; !ok {
		httpx.WriteError(w, http.StatusBadRequest, "unknown reveal variant")
		return
	}

	// `kind` is optional but, when non-empty, must be a known value.
	if body.Kind != "" {
		if _, ok := AllowedRevealKinds[body.Kind]; !ok {
			httpx.WriteError(w, http.StatusBadRequest, "unknown reveal kind")
			return
		}
	}

	evt := auditdb.AuditRevealEvent{
		Actor:     actorFromRequest(r, h.forwardAuthHeader),
		Variant:   body.Variant,
		Kind:      body.Kind,
		IP:        clientIP(r),
		UserAgent: r.UserAgent(),
	}

	if err := h.repo.WriteRevealEvent(r.Context(), evt); err != nil {
		// Log at warn (not error) — audit failures should be visible
		// to operators but never page on-call.
		if errors.Is(err, auditdb.ErrAuditRevealVariantRequired) {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Warn().
			Err(err).
			Str("variant", body.Variant).
			Str("kind", body.Kind).
			Msg("masked-reveal audit insert failed")
		// Per the prompt's contract the SPA never observes this 500
		// (it `.catch(() => {})`s the entire promise) but emitting a
		// 500 here means Prometheus / log aggregation will surface
		// the failure — which is exactly what we want.
		httpx.WriteError(w, http.StatusInternalServerError, "failed to record audit event")
		return
	}

	// 204 because the body would otherwise be empty; matches every
	// other "fire-and-forget" endpoint in the codebase.
	w.WriteHeader(http.StatusNoContent)
}

// decodeRevealAuditBody parses + validates the request body with a
// hard cap of MaxRevealAuditBodyBytes. Unknown fields are rejected so
// typos surface as 400s rather than silent data drops.
func decodeRevealAuditBody(r *http.Request) (revealAuditRequest, error) {
	var body revealAuditRequest
	if r.Body == nil {
		return body, errors.New("missing request body")
	}
	limited := http.MaxBytesReader(nil, r.Body, MaxRevealAuditBodyBytes)
	defer limited.Close()
	dec := json.NewDecoder(limited)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return body, errors.New("invalid request body")
	}
	body.Variant = strings.TrimSpace(strings.ToLower(body.Variant))
	body.Kind = strings.TrimSpace(strings.ToLower(body.Kind))
	if body.Variant == "" {
		return body, errors.New("variant is required")
	}
	return body, nil
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
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
