package fleettelemetry

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetrydb "github.com/ev-dev-labs/teslasync/internal/database/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	// Side-effect import registers the pgx/v5 migrate driver selected by URL scheme.
	_ "github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
)

// FleetTelemetryErrorHandler serves partner-level fleet telemetry error data.
type FleetTelemetryErrorHandler struct {
	teslaClient *tesla.Client
	repo        *telemetrydb.TeslaFleetTelemetryErrorRepo
}

// NewFleetTelemetryErrorHandler creates a new handler.
func NewFleetTelemetryErrorHandler(tc *tesla.Client, db *database.DB) *FleetTelemetryErrorHandler {
	return &FleetTelemetryErrorHandler{
		teslaClient: tc,
		repo:        telemetrydb.NewTeslaFleetTelemetryErrorRepo(db),
	}
}

// ErrorVINs returns stored error VINs from DB.
// GET /api/v1/tesla/fleet-telemetry/error-vins
func (h *FleetTelemetryErrorHandler) ErrorVINs(w http.ResponseWriter, r *http.Request) {
	vins, err := h.repo.GetActiveErrorVINs(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list fleet telemetry error vins")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list error vins")
		return
	}
	if vins == nil {
		vins = []*telemetrymodel.TeslaFleetTelemetryErrorVIN{}
	}
	httpx.WriteJSON(w, http.StatusOK, vins)
}

// RefreshErrorVINs fetches error VINs from Tesla partner API, upserts to DB, and returns fresh data.
// POST /api/v1/tesla/fleet-telemetry/error-vins/refresh
func (h *FleetTelemetryErrorHandler) RefreshErrorVINs(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing fleet telemetry error VINs from Tesla partner API")

	body, status, err := h.teslaClient.GetFleetTelemetryErrorVINs(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla fleet telemetry error vins API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch error VINs from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla error vins non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	var envelope struct {
		Response struct {
			VINs      []string `json:"vins"`
			UpdatedAt string   `json:"updated_at"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse error vins response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	vins := envelope.Response.VINs
	if vins == nil {
		vins = []string{}
	}

	if err := h.repo.ReplaceErrorVINs(r.Context(), vins); err != nil {
		log.Error().Err(err).Msg("failed to save fleet telemetry error vins")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save error VINs")
		return
	}

	stored, err := h.repo.GetActiveErrorVINs(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list error vins after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list error vins")
		return
	}
	if stored == nil {
		stored = []*telemetrymodel.TeslaFleetTelemetryErrorVIN{}
	}

	log.Info().Int("count", len(stored)).Msg("fleet telemetry error VINs refresh complete")
	httpx.WriteJSON(w, http.StatusOK, stored)
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list errors")
		return
	}
	if errors == nil {
		errors = []*telemetrymodel.TeslaFleetTelemetryError{}
	}
	httpx.WriteJSON(w, http.StatusOK, errors)
}

// RefreshErrors fetches error details from Tesla partner API, upserts to DB, and returns fresh data.
// POST /api/v1/tesla/fleet-telemetry/errors/refresh
func (h *FleetTelemetryErrorHandler) RefreshErrors(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing fleet telemetry errors from Tesla partner API")

	body, status, err := h.teslaClient.GetPartnerFleetTelemetryErrors(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla fleet telemetry errors API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch errors from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla fleet errors non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	now := time.Now().UTC()

	var teslaUpdatedAt *time.Time
	if envelope.Response.UpdatedAt != "" {
		if t, err := time.Parse(time.RFC3339, envelope.Response.UpdatedAt); err == nil {
			utc := t.UTC()
			teslaUpdatedAt = &utc
		}
	}

	var modelErrors []*telemetrymodel.TeslaFleetTelemetryError
	for _, e := range envelope.Response.Errors {
		m := &telemetrymodel.TeslaFleetTelemetryError{
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save errors")
		return
	}

	// Return fresh data from DB
	stored, err := h.repo.GetErrors(r.Context(), "", 100, 0)
	if err != nil {
		log.Error().Err(err).Msg("failed to list errors after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list errors")
		return
	}
	if stored == nil {
		stored = []*telemetrymodel.TeslaFleetTelemetryError{}
	}

	log.Info().Int("upserted", inserted).Int("total", len(stored)).Msg("fleet telemetry errors refresh complete")
	httpx.WriteJSON(w, http.StatusOK, stored)
}

// missingUnitDropsResponse is the narrow admin contract for unit-drop diagnostics.
type missingUnitDropsResponse struct {
	Total   float64            `json:"total"`
	ByField map[string]float64 `json:"by_field"`
}

// MissingUnitDrops reports normalize-pipeline drops where unit metadata was missing.
//
// The counter is in-memory by design: it is an operational health signal, not an audit log.
func (h *FleetTelemetryErrorHandler) MissingUnitDrops(w http.ResponseWriter, r *http.Request) {
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		log.Error().Err(err).Msg("failed to gather prometheus metrics for missing-unit drops")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to gather metrics")
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
	httpx.WriteJSON(w, http.StatusOK, out)
}

func truncateBody(b []byte) string {
	if len(b) > 500 {
		return string(b[:500])
	}
	return string(b)
}
