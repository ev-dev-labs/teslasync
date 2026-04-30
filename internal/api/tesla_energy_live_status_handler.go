package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// TeslaEnergyLiveStatusHandler serves Tesla energy site live status (power flow) data.
type TeslaEnergyLiveStatusHandler struct {
	teslaClient *tesla.Client
	repo        *database.TeslaEnergyLiveStatusRepo
}

// NewTeslaEnergyLiveStatusHandler creates a new handler.
func NewTeslaEnergyLiveStatusHandler(tc *tesla.Client, db *database.DB) *TeslaEnergyLiveStatusHandler {
	return &TeslaEnergyLiveStatusHandler{
		teslaClient: tc,
		repo:        database.NewTeslaEnergyLiveStatusRepo(db),
	}
}

// LiveStatus returns the latest live status snapshot from DB.
func (h *TeslaEnergyLiveStatusHandler) LiveStatus(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	status, err := h.repo.GetLatest(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to get latest energy live status")
		writeError(w, http.StatusInternalServerError, "failed to query live status")
		return
	}
	if status == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"message": "no live status data yet — use POST .../live-status/refresh to fetch",
		})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// LiveStatusHistory returns historical live status snapshots for charting.
// Query params: since, until (YYYY-MM-DD), limit (default 500, max 2000).
func (h *TeslaEnergyLiveStatusHandler) LiveStatusHistory(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
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
		writeError(w, http.StatusInternalServerError, "failed to query live status history")
		return
	}
	if entries == nil {
		entries = []*models.TeslaEnergyLiveStatus{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// RefreshLiveStatus fetches live status from Tesla, inserts to DB, and returns fresh data.
func (h *TeslaEnergyLiveStatusHandler) RefreshLiveStatus(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site_id")
		return
	}

	log.Info().Int64("site_id", siteID).Msg("refreshing energy live status from Tesla")

	body, status, err := h.teslaClient.GetEnergySiteLiveStatus(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Msg("tesla energy live status API error")
		writeError(w, http.StatusBadGateway, "failed to fetch live status from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla energy live status non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	entry, err := parseLiveStatusResponse(body, siteID)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse energy live status response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.Create(r.Context(), entry); err != nil {
		log.Error().Err(err).Msg("failed to insert energy live status")
		writeError(w, http.StatusInternalServerError, "failed to save live status")
		return
	}

	log.Info().Int64("site_id", siteID).Int64("id", entry.ID).Msg("energy live status refresh complete")
	writeJSON(w, http.StatusOK, entry)
}

// parseLiveStatusResponse parses the Tesla live_status API response into our model.
func parseLiveStatusResponse(body []byte, siteID int64) (*models.TeslaEnergyLiveStatus, error) {
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

	return &models.TeslaEnergyLiveStatus{
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
