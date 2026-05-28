package teslaenergylivestatus

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// Handler serves Tesla energy site live status (power flow) data.
type Handler struct {
	teslaClient *tesla.Client
	repo        *energydb.TeslaEnergyLiveStatusRepo
}

// NewHandler creates a new handler.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		repo:        energydb.NewTeslaEnergyLiveStatusRepo(db),
	}
}

// LiveStatus returns the latest live status snapshot from DB.
func (h *Handler) LiveStatus(w http.ResponseWriter, r *http.Request) {
	siteID, err := apiparams.URLParamInt64(r, "siteID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	status, err := h.repo.GetLatest(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to get latest energy live status")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query live status")
		return
	}
	if status == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"message": "no live status data yet — use POST .../live-status/refresh to fetch",
		})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status)
}

// LiveStatusHistory returns historical live status snapshots for charting.
// Query params: since, until (YYYY-MM-DD), limit (default 500, max 2000).
func (h *Handler) LiveStatusHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := apiparams.URLParamInt64(r, "siteID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	since, until := energyDateRange(r)
	limit := energyLimit(r)
	// Allow higher limit for live status history (more granular data)
	if v := r.URL.Query().Get("limit"); v != "" {
		if l, err := fmt.Sscanf(v, "%d", &limit); err == nil && l > 0 {
			_ = l
		}
	}

	entries, err := h.repo.GetHistory(r.Context(), siteID, since, until, limit)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to query energy live status history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query live status history")
		return
	}
	if entries == nil {
		entries = []*teslamodel.TeslaEnergyLiveStatus{}
	}
	httpx.WriteJSON(w, http.StatusOK, entries)
}

// RefreshLiveStatus fetches live status from Tesla, inserts to DB, and returns fresh data.
func (h *Handler) RefreshLiveStatus(w http.ResponseWriter, r *http.Request) {
	siteID, err := apiparams.URLParamInt64(r, "siteID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	log.Info().Int64("site_id", siteID).Msg("refreshing energy live status from Tesla")

	body, status, err := h.teslaClient.GetEnergySiteLiveStatus(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Msg("tesla energy live status API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch live status from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla energy live status non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entry, err := parseLiveStatusResponse(body, siteID)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse energy live status response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.Create(r.Context(), entry); err != nil {
		log.Error().Err(err).Msg("failed to insert energy live status")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save live status")
		return
	}

	log.Info().Int64("site_id", siteID).Int64("id", entry.ID).Msg("energy live status refresh complete")
	httpx.WriteJSON(w, http.StatusOK, entry)
}

// parseLiveStatusResponse parses the Tesla live_status API response into our model.
func parseLiveStatusResponse(body []byte, siteID int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
	var resp struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal live status envelope: %w", err)
	}

	var data struct {
		SolarPower        *float64 `json:"solar_power"`
		BatteryPower      *float64 `json:"battery_power"`
		LoadPower         *float64 `json:"load_power"`
		GridPower         *float64 `json:"grid_power"`
		GridServicesPower *float64 `json:"grid_services_power"`
		EnergyLeft        *float64 `json:"energy_left"`
		TotalPackEnergy   *float64 `json:"total_pack_energy"`
		PercentageCharged *float64 `json:"percentage_charged"`
		GridStatus        *string  `json:"grid_status"`
		BackupCapable     *bool    `json:"backup_capable"`
		StormModeActive   *bool    `json:"storm_mode_active"`
		Timestamp         string   `json:"timestamp"`
	}
	if err := json.Unmarshal(resp.Response, &data); err != nil {
		return nil, fmt.Errorf("unmarshal live status data: %w", err)
	}

	ts := time.Now().UTC()
	if data.Timestamp != "" {
		if parsed, err := time.Parse(time.RFC3339, data.Timestamp); err == nil {
			ts = parsed
		}
	}

	return &teslamodel.TeslaEnergyLiveStatus{
		EnergySiteID:      siteID,
		SolarPower:        data.SolarPower,
		BatteryPower:      data.BatteryPower,
		LoadPower:         data.LoadPower,
		GridPower:         data.GridPower,
		GridServicesPower: data.GridServicesPower,
		EnergyLeft:        data.EnergyLeft,
		TotalPackEnergy:   data.TotalPackEnergy,
		PercentageCharged: data.PercentageCharged,
		GridStatus:        data.GridStatus,
		BackupCapable:     data.BackupCapable,
		StormModeActive:   data.StormModeActive,
		Timestamp:         ts,
	}, nil
}

// energyDateRange extracts since/until from query params with sensible defaults.
// Defaults to last 30 days if not provided.
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

// truncateBody returns the first 500 bytes of a response body for logging.
func truncateBody(b []byte) string {
	if len(b) > 500 {
		return string(b[:500])
	}
	return string(b)
}
