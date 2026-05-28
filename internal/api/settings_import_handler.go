package api

// Phase-46 / Prompt 36 — Settings import endpoint.
//
//   POST /api/v1/settings/import
//
// Body shape:
//
//   {
//     "dry_run":  true | false,
//     "bundle":   <SettingsBundle>     // schema_version + sections{...}
//   }
//
// On dry_run=true the handler returns the diff the apply path WOULD
// perform (added/updated/skipped per section). On dry_run=false the
// apply runs section-by-section, additively (sections missing from
// the bundle are not touched, items missing from a present section
// are NOT deleted — see the serializer docstring for the full
// idempotency contract).
//
// The route is gated by RequireSudo at the router so destructive
// applies (large alert-rule replays, bulk geofence rewrites, etc.)
// always carry a fresh credential. Dry-run requests pass through the
// same gate so the cached step-up token is reused for the subsequent
// apply — opening the dialog twice would be confusing.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/rs/zerolog/log"

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

// Import decodes the request, validates the schema_version, and
// dispatches to the serializer. Returns the per-section
// {added, updated, skipped} summary as JSON.
//
// Status codes:
//   - 200 OK on dry_run=true with a valid bundle
//   - 200 OK on dry_run=false after a successful apply
//   - 400 BAD_REQUEST on decode failure or unsupported schema_version
//   - 500 INTERNAL_ERROR on serializer / database failure
func (h *SettingsImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	if h.serializer == nil {
		writeError(w, http.StatusInternalServerError, "settings import: serializer not configured")
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
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("request body exceeds %d bytes", MaxSettingsImportBodyBytes))
			return
		}
		if errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "request body is empty")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Bundle == nil {
		writeError(w, http.StatusBadRequest, "bundle is required")
		return
	}

	userID := actorFromRequest(r, h.authHdr)
	result, err := h.serializer.ImportSettings(r.Context(), userID, req.Bundle, req.DryRun)
	if err != nil {
		if errors.Is(err, settingsdb.ErrSettingsBundleUnsupportedVersion) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, settingsdb.ErrSettingsBundleNil) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Bool("dry_run", req.DryRun).Msg("settings import: failed")
		writeError(w, http.StatusInternalServerError, "failed to import settings")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
