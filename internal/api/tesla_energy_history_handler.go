package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// validEnergyPeriods is the whitelist of allowed period values.
var validEnergyPeriods = map[string]bool{
	"day": true, "week": true, "month": true, "year": true,
}

// TeslaEnergyHistoryHandler serves Tesla energy site history (energy, backup, WC charging).
type TeslaEnergyHistoryHandler struct {
	teslaClient *tesla.Client
	energyRepo  *database.TeslaEnergyHistoryRepo
	backupRepo  *database.TeslaEnergyBackupEventRepo
	wcRepo      *database.TeslaEnergyWCChargingRepo
}

// NewTeslaEnergyHistoryHandler creates a new handler.
func NewTeslaEnergyHistoryHandler(tc *tesla.Client, db *database.DB) *TeslaEnergyHistoryHandler {
	return &TeslaEnergyHistoryHandler{
		teslaClient: tc,
		energyRepo:  database.NewTeslaEnergyHistoryRepo(db),
		backupRepo:  database.NewTeslaEnergyBackupEventRepo(db),
		wcRepo:      database.NewTeslaEnergyWCChargingRepo(db),
	}
}

// ---------------------------------------------------------------------------
// Energy History (calendar_history kind=energy)
// ---------------------------------------------------------------------------

// EnergyHistory returns stored energy measurements from DB.
// Query params: period (day|week|month|year), since, until (YYYY-MM-DD).
func (h *TeslaEnergyHistoryHandler) EnergyHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "day"
	}
	if !validEnergyPeriods[period] {
		writeError(w, http.StatusBadRequest, "period must be day, week, month, or year")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)

	entries, err := h.energyRepo.GetByRange(r.Context(), siteID, period, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query energy history")
		writeError(w, http.StatusInternalServerError, "failed to query energy history")
		return
	}
	if entries == nil {
		entries = []*models.TeslaEnergyHistory{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// RefreshEnergyHistory fetches energy history from Tesla, upserts to DB, and returns data.
// Query params: period, start_date, end_date (YYYY-MM-DD), time_zone.
func (h *TeslaEnergyHistoryHandler) RefreshEnergyHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "day"
	}
	if !validEnergyPeriods[period] {
		writeError(w, http.StatusBadRequest, "period must be day, week, month, or year")
		return
	}

	startDate, endDate, tz := refreshDateParams(r)

	log.Info().Int64("site_id", siteID).Str("period", period).Str("start", startDate).Str("end", endDate).Msg("refreshing energy history from Tesla")

	body, status, err := h.teslaClient.GetEnergySiteCalendarHistory(r.Context(), siteID, "energy", startDate, endDate, period, tz)
	if err != nil {
		log.Error().Err(err).Msg("tesla energy history API error")
		writeError(w, http.StatusBadGateway, "failed to fetch energy history from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla energy history non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entries, err := parseEnergyHistoryResponse(body, siteID, period)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse energy history response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	upserted, err := h.energyRepo.UpsertBatch(r.Context(), entries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert energy history")
		writeError(w, http.StatusInternalServerError, "failed to save energy history")
		return
	}

	log.Info().Int("fetched", len(entries)).Int("upserted", upserted).Msg("energy history refresh complete")

	// Return fresh data from DB
	since, until := energyDateRange(r)
	limit := energyLimit(r)
	stored, err := h.energyRepo.GetByRange(r.Context(), siteID, period, since, until, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to query energy history after refresh")
		writeError(w, http.StatusInternalServerError, "failed to query energy history")
		return
	}
	if stored == nil {
		stored = []*models.TeslaEnergyHistory{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  stored,
		"upserted": upserted,
	})
}

// ---------------------------------------------------------------------------
// Backup History (calendar_history kind=backup)
// ---------------------------------------------------------------------------

// BackupHistory returns stored backup events from DB.
func (h *TeslaEnergyHistoryHandler) BackupHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)

	entries, err := h.backupRepo.GetByRange(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query backup history")
		writeError(w, http.StatusInternalServerError, "failed to query backup history")
		return
	}
	if entries == nil {
		entries = []*models.TeslaEnergyBackupEvent{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// RefreshBackupHistory fetches backup events from Tesla and upserts to DB.
func (h *TeslaEnergyHistoryHandler) RefreshBackupHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "day"
	}
	if !validEnergyPeriods[period] {
		writeError(w, http.StatusBadRequest, "period must be day, week, month, or year")
		return
	}

	startDate, endDate, tz := refreshDateParams(r)

	log.Info().Int64("site_id", siteID).Str("start", startDate).Str("end", endDate).Msg("refreshing backup history from Tesla")

	body, status, err := h.teslaClient.GetEnergySiteCalendarHistory(r.Context(), siteID, "backup", startDate, endDate, period, tz)
	if err != nil {
		log.Error().Err(err).Msg("tesla backup history API error")
		writeError(w, http.StatusBadGateway, "failed to fetch backup history from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla backup history non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entries, err := parseBackupHistoryResponse(body, siteID, period)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse backup history response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	upserted, err := h.backupRepo.UpsertBatch(r.Context(), entries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert backup history")
		writeError(w, http.StatusInternalServerError, "failed to save backup history")
		return
	}

	log.Info().Int("fetched", len(entries)).Int("upserted", upserted).Msg("backup history refresh complete")

	since, until := energyDateRange(r)
	limit := energyLimit(r)
	stored, err := h.backupRepo.GetByRange(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to query backup history after refresh")
		writeError(w, http.StatusInternalServerError, "failed to query backup history")
		return
	}
	if stored == nil {
		stored = []*models.TeslaEnergyBackupEvent{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  stored,
		"upserted": upserted,
	})
}

// ---------------------------------------------------------------------------
// WC Charging History (telemetry_history kind=charge)
// ---------------------------------------------------------------------------

// ChargingHistory returns stored wall connector charging records from DB.
func (h *TeslaEnergyHistoryHandler) ChargingHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)

	entries, err := h.wcRepo.GetByRange(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query wc charging history")
		writeError(w, http.StatusInternalServerError, "failed to query charging history")
		return
	}
	if entries == nil {
		entries = []*models.TeslaEnergyWCCharging{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// RefreshChargingHistory fetches WC charging from Tesla and upserts to DB.
func (h *TeslaEnergyHistoryHandler) RefreshChargingHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	startDate, endDate, tz := refreshDateParams(r)

	log.Info().Int64("site_id", siteID).Str("start", startDate).Str("end", endDate).Msg("refreshing wc charging history from Tesla")

	body, status, err := h.teslaClient.GetEnergySiteTelemetryHistory(r.Context(), siteID, "charge", startDate, endDate, tz)
	if err != nil {
		log.Error().Err(err).Msg("tesla wc charging history API error")
		writeError(w, http.StatusBadGateway, "failed to fetch charging history from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla wc charging history non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entries, err := parseWCChargingResponse(body, siteID)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse wc charging history response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	upserted, err := h.wcRepo.UpsertBatch(r.Context(), entries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert wc charging history")
		writeError(w, http.StatusInternalServerError, "failed to save charging history")
		return
	}

	log.Info().Int("fetched", len(entries)).Int("upserted", upserted).Msg("wc charging history refresh complete")

	since, until := energyDateRange(r)
	limit := energyLimit(r)
	stored, err := h.wcRepo.GetByRange(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to query wc charging history after refresh")
		writeError(w, http.StatusInternalServerError, "failed to query charging history")
		return
	}
	if stored == nil {
		stored = []*models.TeslaEnergyWCCharging{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  stored,
		"upserted": upserted,
	})
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

// parseSiteID extracts {siteID} URL parameter as int64.
func parseSiteID(r *http.Request) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, "siteID"), 10, 64)
}

// energyDateRange extracts since/until from query params with sensible defaults.
// Defaults to last 30 days if not provided.
func energyDateRange(r *http.Request) (since, until time.Time) {
	now := time.Now().UTC()
	since = now.AddDate(0, -1, 0) // default: 30 days ago
	until = now

	if s := r.URL.Query().Get("since"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			since = t
		}
	}
	if s := r.URL.Query().Get("until"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			until = t.Add(24*time.Hour - time.Second) // end of day
		}
	}
	return
}

// energyLimit extracts limit with a default of 500.
func energyLimit(r *http.Request) int {
	limit := 500
	if v := r.URL.Query().Get("limit"); v != "" {
		if l, err := strconv.Atoi(v); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}
	return limit
}

// refreshDateParams extracts date/tz params for Tesla API refresh calls.
// Defaults: last 30 days, UTC timezone.
func refreshDateParams(r *http.Request) (startDate, endDate, tz string) {
	now := time.Now().UTC()
	startDate = r.URL.Query().Get("start_date")
	endDate = r.URL.Query().Get("end_date")
	tz = r.URL.Query().Get("time_zone")

	if startDate == "" {
		startDate = now.AddDate(0, -1, 0).Format("2006-01-02")
	}
	if endDate == "" {
		endDate = now.Format("2006-01-02")
	}
	if tz == "" {
		tz = "UTC"
	}
	return
}

// truncateBody returns the first 500 bytes of a response body for logging.
func truncateBody(b []byte) string {
	if len(b) > 500 {
		return string(b[:500])
	}
	return string(b)
}

// ---------------------------------------------------------------------------
// Tesla response parsing
// ---------------------------------------------------------------------------

// Tesla calendar_history response envelope.
type teslaCalendarHistoryResponse struct {
	Response struct {
		SerialNumber string            `json:"serial_number"`
		Period       string            `json:"period"`
		TimeSeriesData []json.RawMessage `json:"time_series"`
	} `json:"response"`
}

// parseEnergyHistoryResponse parses Tesla calendar_history kind=energy response.
func parseEnergyHistoryResponse(body []byte, siteID int64, period string) ([]*models.TeslaEnergyHistory, error) {
	var resp teslaCalendarHistoryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal energy history: %w", err)
	}

	var entries []*models.TeslaEnergyHistory
	for _, raw := range resp.Response.TimeSeriesData {
		var point struct {
			Timestamp        string   `json:"timestamp"`
			SolarEnergy      *float64 `json:"solar_energy_exported"`
			BatteryEnergyIn  *float64 `json:"battery_energy_imported_from_grid"`
			BatteryEnergyOut *float64 `json:"battery_energy_exported_to_grid"`
			GridEnergyIn     *float64 `json:"grid_energy_imported"`
			GridEnergyOut    *float64 `json:"grid_energy_exported_from_solar"`
			ConsumerEnergy   *float64 `json:"consumer_energy_imported_from_grid"`
		}
		if err := json.Unmarshal(raw, &point); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, point.Timestamp)
		if err != nil {
			continue
		}
		entries = append(entries, &models.TeslaEnergyHistory{
			EnergySiteID:       siteID,
			Period:             period,
			Timestamp:          ts,
			SolarEnergyWh:      point.SolarEnergy,
			BatteryEnergyInWh:  point.BatteryEnergyIn,
			BatteryEnergyOutWh: point.BatteryEnergyOut,
			GridEnergyInWh:     point.GridEnergyIn,
			GridEnergyOutWh:    point.GridEnergyOut,
			ConsumerEnergyWh:   point.ConsumerEnergy,
		})
	}
	return entries, nil
}

// parseBackupHistoryResponse parses Tesla calendar_history kind=backup response.
func parseBackupHistoryResponse(body []byte, siteID int64, period string) ([]*models.TeslaEnergyBackupEvent, error) {
	var resp teslaCalendarHistoryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal backup history: %w", err)
	}

	var entries []*models.TeslaEnergyBackupEvent
	for _, raw := range resp.Response.TimeSeriesData {
		var point struct {
			Timestamp string `json:"timestamp"`
			Duration  int    `json:"duration"`
		}
		if err := json.Unmarshal(raw, &point); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, point.Timestamp)
		if err != nil {
			continue
		}
		entries = append(entries, &models.TeslaEnergyBackupEvent{
			EnergySiteID:    siteID,
			Period:          period,
			Timestamp:       ts,
			DurationSeconds: point.Duration,
		})
	}
	return entries, nil
}

// Tesla telemetry_history response envelope.
type teslaTelemetryHistoryResponse struct {
	Response struct {
		Data []json.RawMessage `json:"data"`
	} `json:"response"`
}

// parseWCChargingResponse parses Tesla telemetry_history kind=charge response.
func parseWCChargingResponse(body []byte, siteID int64) ([]*models.TeslaEnergyWCCharging, error) {
	var resp teslaTelemetryHistoryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal wc charging history: %w", err)
	}

	var entries []*models.TeslaEnergyWCCharging
	for _, raw := range resp.Response.Data {
		var point struct {
			Timestamp string   `json:"timestamp"`
			DIN       *string  `json:"din"`
			EnergyWh  *float64 `json:"energy_wh"`
		}
		if err := json.Unmarshal(raw, &point); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, point.Timestamp)
		if err != nil {
			continue
		}
		entries = append(entries, &models.TeslaEnergyWCCharging{
			EnergySiteID: siteID,
			DIN:          point.DIN,
			Timestamp:    ts,
			EnergyWh:     point.EnergyWh,
		})
	}
	return entries, nil
}
