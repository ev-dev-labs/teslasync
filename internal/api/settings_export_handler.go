package api

// Phase-46 / Prompt 36 — Settings export endpoint.
//
//   GET /api/v1/settings/export
//
// Returns a JSON bundle containing the user-discoverable preference
// surface (settings, alert rules, geofences, quiet-hours windows).
// Sensitive items (Tesla refresh tokens, API keys, TOTP secrets,
// password hashes, notification-channel webhook URLs / SMTP passwords
// / bot tokens) are NEVER part of the bundle — see the file-level
// docstring on internal/database/settings_serializer.go for the full
// list of excluded sections + rationale.
//
// The response has Content-Disposition: attachment so the SPA's
// fetch-and-trigger-download flow renders the user a save-as dialog.
// The filename includes a UTC date so multiple exports stay
// distinguishable in the user's downloads folder.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// SettingsExportHandler serves GET /settings/export.
type SettingsExportHandler struct {
	serializer *settingsdb.SettingsSerializer
	authHdr    string
}

// NewSettingsExportHandler wires the handler against the shared
// serializer. The ForwardAuth header drives per-user scoping for the
// quiet_hours section; install-global sections are unaffected.
func NewSettingsExportHandler(serializer *settingsdb.SettingsSerializer, forwardAuthHeader string) *SettingsExportHandler {
	return &SettingsExportHandler{serializer: serializer, authHdr: forwardAuthHeader}
}

// Export builds the bundle and streams it as application/json with a
// Content-Disposition header. Uses encoding/json's Indent encoder so
// the file is human-diffable in the user's git repo.
//
// Errors are surfaced as the standard {error, code} JSON envelope.
// Concrete error mapping:
//   - serializer error → 500 INTERNAL_ERROR
//   - missing serializer (router wired wrong) → 500 INTERNAL_ERROR
func (h *SettingsExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	if h.serializer == nil {
		writeError(w, http.StatusInternalServerError, "settings export: serializer not configured")
		return
	}
	userID := actorFromRequest(r, h.authHdr)
	bundle, err := h.serializer.ExportSettings(r.Context(), userID)
	if err != nil {
		log.Error().Err(err).Msg("settings export: failed to assemble bundle")
		writeError(w, http.StatusInternalServerError, "failed to export settings")
		return
	}

	filename := fmt.Sprintf("teslasync-settings-%s.json", time.Now().UTC().Format("20060102"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Cache-Control", "no-store")

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(bundle); err != nil {
		log.Error().Err(err).Msg("settings export: failed to encode bundle")
		// Headers are already sent; nothing useful we can do but log.
	}
}
