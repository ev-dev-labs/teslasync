package teslaenergyhist

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// validEnergyPeriods is the whitelist of allowed period values.
var validEnergyPeriods = map[string]bool{
	"day": true, "week": true, "month": true, "year": true,
}

// teslaRefreshTimeout bounds every outbound Tesla Fleet API refresh call
// (plus its follow-on upsert/read-back) so a hung upstream can never pin
// a request goroutine. 30s matches the Tesla API budget documented in
// go-backend.instructions.md.
const teslaRefreshTimeout = 30 * time.Second

// The interfaces below are the minimal ports Handler depends on. Defining
// them here (rather than referencing the concrete *tesla.Client and
// *energydb.* repos) lets the handler tests inject fakes without a live
// database or network — the same testability pattern used by the
// vehiclestates handler. Production wiring in NewTeslaEnergyHistoryHandler
// still passes the concrete implementations, which satisfy these ports.

// energyHistoryClient is the slice of the Tesla Fleet API client the
// refresh handlers use to pull calendar_history and telemetry_history.
type energyHistoryClient interface {
	GetEnergySiteCalendarHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, period, timeZone string) ([]byte, int, error)
	GetEnergySiteTelemetryHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, timeZone string) ([]byte, int, error)
}

// energyHistoryStore is the persistence port for energy measurements.
type energyHistoryStore interface {
	GetByRange(ctx context.Context, siteID int64, period string, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyHistory, error)
	UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyHistory) (int, error)
}

// backupEventStore is the persistence port for off-grid backup events.
type backupEventStore interface {
	GetByRange(ctx context.Context, siteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyBackupEvent, error)
	UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyBackupEvent) (int, error)
}

// wcChargingStore is the persistence port for wall connector charging.
type wcChargingStore interface {
	GetByRange(ctx context.Context, siteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyWCCharging, error)
	UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyWCCharging) (int, error)
}

// TeslaEnergyHistoryHandler serves Tesla energy site history (energy, backup, WC charging).
type TeslaEnergyHistoryHandler struct {
	teslaClient energyHistoryClient
	energyRepo  energyHistoryStore
	backupRepo  backupEventStore
	wcRepo      wcChargingStore
}

// NewTeslaEnergyHistoryHandler creates a new handler.
func NewTeslaEnergyHistoryHandler(tc *tesla.Client, db *database.DB) *TeslaEnergyHistoryHandler {
	return &TeslaEnergyHistoryHandler{
		teslaClient: tc,
		energyRepo:  energydb.NewTeslaEnergyHistoryRepo(db),
		backupRepo:  energydb.NewTeslaEnergyBackupEventRepo(db),
		wcRepo:      energydb.NewTeslaEnergyWCChargingRepo(db),
	}
}

// EnergyHistory returns stored energy measurements from DB.
// Query params: period (day|week|month|year), since, until (YYYY-MM-DD).
func (h *TeslaEnergyHistoryHandler) EnergyHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "day"
	}
	if !validEnergyPeriods[period] {
		httpx.WriteError(w, http.StatusBadRequest, "period must be day, week, month, or year")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)

	entries, err := h.energyRepo.GetByRange(r.Context(), siteID, period, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query energy history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query energy history")
		return
	}
	if entries == nil {
		entries = []*teslamodel.TeslaEnergyHistory{}
	}
	httpx.WriteJSON(w, http.StatusOK, entries)
}

// RefreshEnergyHistory fetches energy history from Tesla, upserts to DB, and returns data.
// Query params: period, start_date, end_date (YYYY-MM-DD), time_zone.
func (h *TeslaEnergyHistoryHandler) RefreshEnergyHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "day"
	}
	if !validEnergyPeriods[period] {
		httpx.WriteError(w, http.StatusBadRequest, "period must be day, week, month, or year")
		return
	}

	startDate, endDate, tz := refreshDateParams(r)

	log.Info().Int64("site_id", siteID).Str("period", period).Str("start", startDate).Str("end", endDate).Msg("refreshing energy history from Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaRefreshTimeout)
	defer cancel()

	body, status, err := h.teslaClient.GetEnergySiteCalendarHistory(ctx, siteID, "energy", startDate, endDate, period, tz)
	if err != nil {
		log.Error().Err(err).Msg("tesla energy history API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch energy history from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla energy history non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entries, err := parseEnergyHistoryResponse(body, siteID, period)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse energy history response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	upserted, err := h.energyRepo.UpsertBatch(ctx, entries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert energy history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save energy history")
		return
	}

	log.Info().Int("fetched", len(entries)).Int("upserted", upserted).Msg("energy history refresh complete")

	since, until := energyDateRange(r)
	limit := energyLimit(r)
	stored, err := h.energyRepo.GetByRange(ctx, siteID, period, since, until, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to query energy history after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query energy history")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaEnergyHistory{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  stored,
		"upserted": upserted,
	})
}

// BackupHistory returns stored backup events from DB.
func (h *TeslaEnergyHistoryHandler) BackupHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)

	entries, err := h.backupRepo.GetByRange(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query backup history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query backup history")
		return
	}
	if entries == nil {
		entries = []*teslamodel.TeslaEnergyBackupEvent{}
	}
	httpx.WriteJSON(w, http.StatusOK, entries)
}

// RefreshBackupHistory fetches backup events from Tesla and upserts to DB.
func (h *TeslaEnergyHistoryHandler) RefreshBackupHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "day"
	}
	if !validEnergyPeriods[period] {
		httpx.WriteError(w, http.StatusBadRequest, "period must be day, week, month, or year")
		return
	}

	startDate, endDate, tz := refreshDateParams(r)

	log.Info().Int64("site_id", siteID).Str("start", startDate).Str("end", endDate).Msg("refreshing backup history from Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaRefreshTimeout)
	defer cancel()

	body, status, err := h.teslaClient.GetEnergySiteCalendarHistory(ctx, siteID, "backup", startDate, endDate, period, tz)
	if err != nil {
		log.Error().Err(err).Msg("tesla backup history API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch backup history from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla backup history non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entries, err := parseBackupHistoryResponse(body, siteID, period)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse backup history response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	upserted, err := h.backupRepo.UpsertBatch(ctx, entries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert backup history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save backup history")
		return
	}

	log.Info().Int("fetched", len(entries)).Int("upserted", upserted).Msg("backup history refresh complete")

	since, until := energyDateRange(r)
	limit := energyLimit(r)
	stored, err := h.backupRepo.GetByRange(ctx, siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to query backup history after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query backup history")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaEnergyBackupEvent{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  stored,
		"upserted": upserted,
	})
}

// ChargingHistory returns stored wall connector charging records from DB.
func (h *TeslaEnergyHistoryHandler) ChargingHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)

	entries, err := h.wcRepo.GetByRange(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query wc charging history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query charging history")
		return
	}
	if entries == nil {
		entries = []*teslamodel.TeslaEnergyWCCharging{}
	}
	httpx.WriteJSON(w, http.StatusOK, entries)
}

// RefreshChargingHistory fetches WC charging from Tesla and upserts to DB.
func (h *TeslaEnergyHistoryHandler) RefreshChargingHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	startDate, endDate, tz := refreshDateParams(r)

	log.Info().Int64("site_id", siteID).Str("start", startDate).Str("end", endDate).Msg("refreshing wc charging history from Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaRefreshTimeout)
	defer cancel()

	body, status, err := h.teslaClient.GetEnergySiteTelemetryHistory(ctx, siteID, "charge", startDate, endDate, tz)
	if err != nil {
		log.Error().Err(err).Msg("tesla wc charging history API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch charging history from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla wc charging history non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entries, err := parseWCChargingResponse(body, siteID)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse wc charging history response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	upserted, err := h.wcRepo.UpsertBatch(ctx, entries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert wc charging history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save charging history")
		return
	}

	log.Info().Int("fetched", len(entries)).Int("upserted", upserted).Msg("wc charging history refresh complete")

	since, until := energyDateRange(r)
	limit := energyLimit(r)
	stored, err := h.wcRepo.GetByRange(ctx, siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to query wc charging history after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query charging history")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaEnergyWCCharging{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  stored,
		"upserted": upserted,
	})
}

// parseSiteID extracts {siteID} URL parameter as a positive int64.
func parseSiteID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "siteID"), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse site_id: %w", err)
	}
	if id <= 0 {
		return 0, fmt.Errorf("site_id must be a positive integer, got %d", id)
	}
	return id, nil
}

// energyDateRange extracts since/until and defaults to the last 30 days.
func energyDateRange(r *http.Request) (since, until time.Time) {
	now := time.Now().UTC()
	since = now.AddDate(0, -1, 0)
	until = now

	if s := r.URL.Query().Get("since"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			since = t
		}
	}
	if s := r.URL.Query().Get("until"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			until = t.Add(24*time.Hour - time.Second)
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
