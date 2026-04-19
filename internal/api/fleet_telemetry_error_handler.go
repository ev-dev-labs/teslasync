package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// FleetTelemetryErrorHandler serves partner-level fleet telemetry error data.
type FleetTelemetryErrorHandler struct {
	teslaClient *tesla.Client
	repo        *database.TeslaFleetTelemetryErrorRepo
}

// NewFleetTelemetryErrorHandler creates a new handler.
func NewFleetTelemetryErrorHandler(tc *tesla.Client, db *database.DB) *FleetTelemetryErrorHandler {
	return &FleetTelemetryErrorHandler{
		teslaClient: tc,
		repo:        database.NewTeslaFleetTelemetryErrorRepo(db),
	}
}

// ErrorVINs returns stored error VINs from DB.
// GET /api/v1/tesla/fleet-telemetry/error-vins
func (h *FleetTelemetryErrorHandler) ErrorVINs(w http.ResponseWriter, r *http.Request) {
	vins, err := h.repo.GetActiveErrorVINs(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list fleet telemetry error vins")
		writeError(w, http.StatusInternalServerError, "failed to list error vins")
		return
	}
	if vins == nil {
		vins = []*models.TeslaFleetTelemetryErrorVIN{}
	}
	writeJSON(w, http.StatusOK, vins)
}

// RefreshErrorVINs fetches error VINs from Tesla partner API, upserts to DB, and returns fresh data.
// POST /api/v1/tesla/fleet-telemetry/error-vins/refresh
func (h *FleetTelemetryErrorHandler) RefreshErrorVINs(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing fleet telemetry error VINs from Tesla partner API")

	body, status, err := h.teslaClient.GetFleetTelemetryErrorVINs(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla fleet telemetry error vins API error")
		writeError(w, http.StatusBadGateway, "failed to fetch error VINs from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla error vins non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	// Parse Tesla response: {"response": {"vins": [...], "updated_at": "..."}}
	var envelope struct {
		Response struct {
			VINs      []string `json:"vins"`
			UpdatedAt string   `json:"updated_at"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse error vins response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	vins := envelope.Response.VINs
	if vins == nil {
		vins = []string{}
	}

	if err := h.repo.ReplaceErrorVINs(r.Context(), vins); err != nil {
		log.Error().Err(err).Msg("failed to save fleet telemetry error vins")
		writeError(w, http.StatusInternalServerError, "failed to save error VINs")
		return
	}

	// Return fresh data from DB
	stored, err := h.repo.GetActiveErrorVINs(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list error vins after refresh")
		writeError(w, http.StatusInternalServerError, "failed to list error vins")
		return
	}
	if stored == nil {
		stored = []*models.TeslaFleetTelemetryErrorVIN{}
	}

	log.Info().Int("count", len(stored)).Msg("fleet telemetry error VINs refresh complete")
	writeJSON(w, http.StatusOK, stored)
}

// Errors returns stored error logs from DB, optionally filtered by VIN.
// GET /api/v1/tesla/fleet-telemetry/errors?vin=...&limit=...&offset=...
func (h *FleetTelemetryErrorHandler) Errors(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	errors, err := h.repo.GetErrors(r.Context(), vin, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list fleet telemetry errors")
		writeError(w, http.StatusInternalServerError, "failed to list errors")
		return
	}
	if errors == nil {
		errors = []*models.TeslaFleetTelemetryError{}
	}
	writeJSON(w, http.StatusOK, errors)
}

// RefreshErrors fetches error details from Tesla partner API, upserts to DB, and returns fresh data.
// POST /api/v1/tesla/fleet-telemetry/errors/refresh
func (h *FleetTelemetryErrorHandler) RefreshErrors(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing fleet telemetry errors from Tesla partner API")

	body, status, err := h.teslaClient.GetPartnerFleetTelemetryErrors(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla fleet telemetry errors API error")
		writeError(w, http.StatusBadGateway, "failed to fetch errors from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla fleet errors non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	// Parse Tesla response: {"response": {"errors": [...], "updated_at": "..."}}
	var envelope struct {
		Response struct {
			Errors []struct {
				VIN          string `json:"vin"`
				ErrorCode    string `json:"error_code"`
				ErrorMessage string `json:"error_message"`
				ReportedAt   string `json:"reported_at"`
			} `json:"errors"`
			UpdatedAt string `json:"updated_at"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse fleet telemetry errors response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	now := time.Now().UTC()

	// Parse Tesla's updated_at
	var teslaUpdatedAt *time.Time
	if envelope.Response.UpdatedAt != "" {
		if t, err := time.Parse(time.RFC3339, envelope.Response.UpdatedAt); err == nil {
			utc := t.UTC()
			teslaUpdatedAt = &utc
		}
	}

	// Convert parsed errors to model structs
	var modelErrors []*models.TeslaFleetTelemetryError
	for i, e := range envelope.Response.Errors {
		m := &models.TeslaFleetTelemetryError{
			VIN:            e.VIN,
			TeslaUpdatedAt: teslaUpdatedAt,
			FetchedAt:      now,
		}
		if e.ErrorCode != "" {
			m.ErrorCode = &e.ErrorCode
		}
		if e.ErrorMessage != "" {
			m.ErrorMessage = &e.ErrorMessage
		}
		if e.ReportedAt != "" {
			if t, err := time.Parse(time.RFC3339, e.ReportedAt); err == nil {
				utc := t.UTC()
				m.ReportedAt = &utc
			}
		}

		// Store raw JSON for each error entry
		if rawBytes, err := json.Marshal(envelope.Response.Errors[i]); err == nil {
			m.RawJSON = string(rawBytes)
		}

		modelErrors = append(modelErrors, m)
	}

	inserted, err := h.repo.UpsertErrors(r.Context(), modelErrors)
	if err != nil {
		log.Error().Err(err).Msg("failed to save fleet telemetry errors")
		writeError(w, http.StatusInternalServerError, "failed to save errors")
		return
	}

	// Return fresh data from DB
	stored, err := h.repo.GetErrors(r.Context(), "", 100, 0)
	if err != nil {
		log.Error().Err(err).Msg("failed to list errors after refresh")
		writeError(w, http.StatusInternalServerError, "failed to list errors")
		return
	}
	if stored == nil {
		stored = []*models.TeslaFleetTelemetryError{}
	}

	log.Info().Int("upserted", inserted).Int("total", len(stored)).Msg("fleet telemetry errors refresh complete")
	writeJSON(w, http.StatusOK, stored)
}
