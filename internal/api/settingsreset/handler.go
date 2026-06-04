package settingsreset

// Settings reset endpoint.
//
// POST /api/v1/settings/reset resets either every whitelisted section or one named section.
// The route is sudo-gated, leaves per-vehicle settings to their own endpoint, and returns ImportResult-shaped JSON.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// MaxSettingsResetBodyBytes caps the inbound JSON body. The body is
// at most a single { "section": "..." } pair so this is generous;
// we cap to cut off accidental log-pastes / hostile payloads cheaply.
const MaxSettingsResetBodyBytes int64 = 1 << 14 // 16 KiB

// SettingsResetExecutor is the narrow surface SettingsResetHandler
// depends on. Production: *settingsdb.SettingsResetRepo. Tests stub
// this to assert the handler's flow without a live database.
type SettingsResetExecutor interface {
	ResetSections(ctx context.Context, userID string, sections []settingsdb.SettingsResetSection) (*settingsdb.SettingsResetResult, error)
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
		httpx.WriteError(w, http.StatusInternalServerError, "settings reset: repo not configured")
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
				httpx.WriteError(w, http.StatusBadRequest,
					fmt.Sprintf("request body exceeds %d bytes", MaxSettingsResetBodyBytes))
				return
			}
			httpx.WriteError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
			return
		}
	}

	var sections []settingsdb.SettingsResetSection
	if req.Section == "" {
		sections = settingsdb.AllSettingsResetSections()
	} else {
		s, reason, err := settingsdb.CanonicalResetSection(req.Section)
		if errors.Is(err, settingsdb.ErrSettingsResetDenied) {
			httpx.WriteErrorCode(w, http.StatusBadRequest, reason, "SECTION_DENIED")
			return
		}
		if errors.Is(err, settingsdb.ErrSettingsResetUnknownSection) {
			httpx.WriteErrorCode(w, http.StatusBadRequest,
				fmt.Sprintf("unknown section %q", req.Section), "SECTION_UNKNOWN")
			return
		}
		if err != nil {
			log.Error().Err(err).Str("section", req.Section).Msg("settings reset: section resolution failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to resolve section")
			return
		}
		sections = []settingsdb.SettingsResetSection{s}
	}

	userID := actorFromRequest(r, h.authHdr)
	result, err := h.repo.ResetSections(r.Context(), userID, sections)
	if err != nil {
		if errors.Is(err, settingsdb.ErrSettingsResetQuietHoursRequiresUser) {
			httpx.WriteErrorCode(w, http.StatusUnauthorized,
				"quiet_hours can only be reset by an authenticated user",
				"MISSING_IDENTITY")
			return
		}
		if errors.Is(err, settingsdb.ErrSettingsResetUnknownSection) {
			// Pre-flight catches single-section requests above; this
			// path covers a bad section in the global whitelist
			// (defensive — should never happen in production).
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Str("section", req.Section).Msg("settings reset: orchestrator failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to reset settings")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}
