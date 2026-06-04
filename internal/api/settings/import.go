package settings

// Settings import endpoint.
// Imports are additive: omitted sections and missing items are left untouched.
// RequireSudo gates dry-run and apply so the same step-up token covers review
// and confirmation.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// MaxSettingsImportBodyBytes caps the inbound JSON body. The biggest
// sane bundle (a few hundred alert rules + a few dozen geofences with
// long polygons) tops out under ~256 KiB; 1 MiB gives plenty of
// headroom while still cutting off accidental log-pastes or hostile
// payloads cheaply.
const MaxSettingsImportBodyBytes int64 = 1 << 20

// SettingsImportHandler serves POST /settings/import.
type SettingsImportHandler struct {
	serializer *settingsdb.SettingsSerializer
	authHdr    string
}

// NewSettingsImportHandler wires the handler against the shared
// serializer. ForwardAuth header drives per-user scoping for the
// quiet_hours section, mirroring the export handler.
func NewSettingsImportHandler(serializer *settingsdb.SettingsSerializer, forwardAuthHeader string) *SettingsImportHandler {
	return &SettingsImportHandler{serializer: serializer, authHdr: forwardAuthHeader}
}

// settingsImportRequest is the JSON contract for POST /settings/import.
// `dry_run` defaults to false (apply) when omitted; the SPA always
// sends it explicitly so the omitted case is purely defensive.
type settingsImportRequest struct {
	DryRun bool                       `json:"dry_run"`
	Bundle *settingsdb.SettingsBundle `json:"bundle"`
}

// Import validates the bundle and returns the per-section add/update/skip
// summary. Decode and schema errors are 400; serializer failures are 500.
func (h *SettingsImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	if h.serializer == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "settings import: serializer not configured")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxSettingsImportBodyBytes)
	defer r.Body.Close()

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req settingsImportRequest
	if err := dec.Decode(&req); err != nil {
		// Surface a more actionable message for the body-too-large case.
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpx.WriteError(w, http.StatusBadRequest,
				fmt.Sprintf("request body exceeds %d bytes", MaxSettingsImportBodyBytes))
			return
		}
		if errors.Is(err, io.EOF) {
			httpx.WriteError(w, http.StatusBadRequest, "request body is empty")
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Bundle == nil {
		httpx.WriteError(w, http.StatusBadRequest, "bundle is required")
		return
	}

	userID := actorFromRequest(r, h.authHdr)
	result, err := h.serializer.ImportSettings(r.Context(), userID, req.Bundle, req.DryRun)
	if err != nil {
		if errors.Is(err, settingsdb.ErrSettingsBundleUnsupportedVersion) {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, settingsdb.ErrSettingsBundleNil) {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Bool("dry_run", req.DryRun).Msg("settings import: failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to import settings")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}
