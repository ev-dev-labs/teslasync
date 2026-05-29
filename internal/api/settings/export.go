package settings

// Settings export endpoint.
// Exports only user-discoverable preferences; credentials, tokens, and webhook
// secrets are deliberately excluded by the serializer contract. The attachment
// filename includes a UTC date so repeated downloads remain distinguishable.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
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

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

// Export streams an indented settings bundle as an attachment so users can
// diff it outside the app. Serializer and wiring failures use the standard
// error envelope.
func (h *SettingsExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	if h.serializer == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "settings export: serializer not configured")
		return
	}
	userID := actorFromRequest(r, h.authHdr)
	bundle, err := h.serializer.ExportSettings(r.Context(), userID)
	if err != nil {
		log.Error().Err(err).Msg("settings export: failed to assemble bundle")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to export settings")
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
