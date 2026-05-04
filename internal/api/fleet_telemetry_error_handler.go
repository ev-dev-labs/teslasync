package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	// Side-effect import: registers the
	// tesla_normalize_unit_context_missing_total counter against
	// prometheus.DefaultRegisterer at package init time so
	// MissingUnitDrops below sees the metric family on every API
	// process — including binaries that do not yet wire
	// normalize.Pipeline as the live ingest path. Phase-42 wiring
	// prompts will eventually plumb the Pipeline into the API
	// binary; until then this import keeps the diagnostics endpoint
	// returning a real (zero-valued) family rather than 404-equivalent
	// "metric not registered".
	_ "github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
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
	for _, e := range envelope.Response.Errors {
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

// missingUnitDropsResponse describes the
// tesla_normalize_unit_context_missing_total counter snapshot served by
// the Settings/Diagnostics "missing-unit drops" indicator.
//
// Total is the running sum across every Field label since the API
// process started; ByField is the per-Field breakdown (empty when no
// drops have been recorded). The counter is monotonic, so a non-zero
// Total combined with a flat slope on subsequent polls is a healthy
// "old drift, now resolved" signal — the frontend renders both Total
// and a recent-rate window over polled samples.
type missingUnitDropsResponse struct {
	Total   float64            `json:"total"`
	ByField map[string]float64 `json:"by_field"`
}

// MissingUnitDrops returns the running count of normalize-pipeline drops
// caused by an empty vehicle_unit_history at the atomic's EmittedAt.
// Sourced from the tesla_normalize_unit_context_missing_total counter
// registered by internal/tesla/normalize.Pipeline.
//
// Phase-42 prompt 0068 replaces the legacy
// fleet_telemetry_subscriptions-derived health indicator with this
// metric-derived one (per ADR-004 #2: live pipeline metrics, not
// snapshot tables, are the source of truth for ingest health).
//
// GET /api/v1/tesla/fleet-telemetry/missing-unit-drops
func (h *FleetTelemetryErrorHandler) MissingUnitDrops(w http.ResponseWriter, r *http.Request) {
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		log.Error().Err(err).Msg("failed to gather prometheus metrics for missing-unit drops")
		writeError(w, http.StatusInternalServerError, "failed to gather metrics")
		return
	}
	out := missingUnitDropsResponse{ByField: map[string]float64{}}
	const wanted = "tesla_normalize_unit_context_missing_total"
	for _, mf := range families {
		if mf.GetName() != wanted {
			continue
		}
		for _, m := range mf.GetMetric() {
			counter := m.GetCounter()
			if counter == nil {
				continue
			}
			v := counter.GetValue()
			out.Total += v
			for _, lp := range m.GetLabel() {
				if lp.GetName() == "field" {
					out.ByField[lp.GetValue()] += v
					break
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}
