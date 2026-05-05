package api

// Phase-46 / Prompt 50 — Settings reset endpoint.
//
//   POST /api/v1/settings/reset
//
// Body shape:
//
//   {}                          -> reset every whitelisted section
//   { "section": "alert_rules" } -> reset just that section
//
// Returns ImportResult-shaped JSON:
//
//   {
//     "reset":    37,
//     "sections": [{ "section": "alert_rules", "reset": 37 }]
//   }
//
// The route is sudo-gated by RequireSudo at the router so a misclick
// always carries a fresh credential. Per-vehicle settings (Phase-46
// / Prompt 43) are NOT touched here; the per-vehicle reset flow has
// its own endpoint.
//
// Error contract:
//   - 400 BAD_REQUEST          → unknown section / deny-listed /
//                                payload too large / malformed JSON
//   - 401 MISSING_IDENTITY     → quiet_hours requested but ForwardAuth
//                                header is empty (open mode)
//   - 500 INTERNAL_ERROR       → orchestrator / database failure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MaxSettingsResetBodyBytes caps the inbound JSON body. The body is
// at most a single { "section": "..." } pair so this is generous;
// we cap to cut off accidental log-pastes / hostile payloads cheaply.
const MaxSettingsResetBodyBytes int64 = 1 << 14 // 16 KiB

// SettingsResetExecutor is the narrow surface SettingsResetHandler
// depends on. Production: *database.SettingsResetRepo. Tests stub
// this to assert the handler's flow without a live database.
type SettingsResetExecutor interface {
	ResetSections(ctx context.Context, userID string, sections []database.SettingsResetSection) (*database.SettingsResetResult, error)
}

// SettingsResetHandler serves POST /settings/reset.
type SettingsResetHandler struct {
	repo    SettingsResetExecutor
	authHdr string
}

// NewSettingsResetHandler wires the production repo. ForwardAuth
// header drives per-user scoping for the quiet_hours section
// (mirrors the export/import handler conventions).
func NewSettingsResetHandler(repo SettingsResetExecutor, forwardAuthHeader string) *SettingsResetHandler {
	return &SettingsResetHandler{repo: repo, authHdr: forwardAuthHeader}
}

// settingsResetRequest is the JSON contract for POST /settings/reset.
// `section` is optional; when omitted the handler resets every
// whitelisted section (the "Reset ALL settings" Danger zone path).
type settingsResetRequest struct {
	Section string `json:"section,omitempty"`
}

// Reset decodes the request, resolves the section list, and dispatches
// to the orchestrator. The shared `request()` client transparently
// drives the <ReauthDialog> step-up because the route is gated by
// RequireSudo upstream.
func (h *SettingsResetHandler) Reset(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		writeError(w, http.StatusInternalServerError, "settings reset: repo not configured")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxSettingsResetBodyBytes)
	defer r.Body.Close()

	var req settingsResetRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		// A completely empty body is allowed and means "reset all" —
		// the SPA sends `{}` but we accept zero bytes too so curl
		// users don't have to remember the empty object.
		if errors.Is(err, io.EOF) {
			req = settingsResetRequest{}
		} else {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				writeError(w, http.StatusBadRequest,
					fmt.Sprintf("request body exceeds %d bytes", MaxSettingsResetBodyBytes))
				return
			}
			writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
			return
		}
	}

	var sections []database.SettingsResetSection
	if req.Section == "" {
		sections = database.AllSettingsResetSections()
	} else {
		s, reason, err := database.CanonicalResetSection(req.Section)
		if errors.Is(err, database.ErrSettingsResetDenied) {
			writeErrorCode(w, http.StatusBadRequest, reason, "SECTION_DENIED")
			return
		}
		if errors.Is(err, database.ErrSettingsResetUnknownSection) {
			writeErrorCode(w, http.StatusBadRequest,
				fmt.Sprintf("unknown section %q", req.Section), "SECTION_UNKNOWN")
			return
		}
		if err != nil {
			log.Error().Err(err).Str("section", req.Section).Msg("settings reset: section resolution failed")
			writeError(w, http.StatusInternalServerError, "failed to resolve section")
			return
		}
		sections = []database.SettingsResetSection{s}
	}

	userID := actorFromRequest(r, h.authHdr)
	result, err := h.repo.ResetSections(r.Context(), userID, sections)
	if err != nil {
		if errors.Is(err, database.ErrSettingsResetQuietHoursRequiresUser) {
			writeErrorCode(w, http.StatusUnauthorized,
				"quiet_hours can only be reset by an authenticated user",
				"MISSING_IDENTITY")
			return
		}
		if errors.Is(err, database.ErrSettingsResetUnknownSection) {
			// Pre-flight catches single-section requests above; this
			// path covers a bad section in the global whitelist
			// (defensive — should never happen in production).
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Str("section", req.Section).Msg("settings reset: orchestrator failed")
		writeError(w, http.StatusInternalServerError, "failed to reset settings")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
