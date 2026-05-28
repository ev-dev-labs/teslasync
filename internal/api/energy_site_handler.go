package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// EnergySiteHandler serves Tesla energy product (Powerwall, Solar) data.
type EnergySiteHandler struct {
	teslaClient *tesla.Client
	repo        *database.TeslaEnergySiteRepo
}

// NewEnergySiteHandler creates a new handler.
func NewEnergySiteHandler(tc *tesla.Client, db *database.DB) *EnergySiteHandler {
	return &EnergySiteHandler{
		teslaClient: tc,
		repo:        database.NewTeslaEnergySiteRepo(db),
	}
}

// List returns all stored energy sites from DB.
func (h *EnergySiteHandler) List(w http.ResponseWriter, r *http.Request) {
	sites, err := h.repo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list energy sites")
		writeError(w, http.StatusInternalServerError, "failed to list energy sites")
		return
	}
	if sites == nil {
		sites = []*teslamodel.TeslaEnergySite{}
	}
	writeJSON(w, http.StatusOK, sites)
}

// Refresh fetches products from Tesla, filters to energy products, saves to DB, and returns them.
func (h *EnergySiteHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing energy sites from Tesla /products")

	body, status, err := h.teslaClient.GetProducts(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla products API error")
		writeError(w, http.StatusBadGateway, "failed to fetch products from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla products non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	sites, err := parseProductsResponse(body)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse products response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.ReplaceAll(r.Context(), sites); err != nil {
		log.Error().Err(err).Msg("failed to save energy sites")
		writeError(w, http.StatusInternalServerError, "failed to save energy sites")
		return
	}

	// Return fresh data from DB
	stored, err := h.repo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list energy sites after refresh")
		writeError(w, http.StatusInternalServerError, "failed to list energy sites")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaEnergySite{}
	}

	log.Info().Int("count", len(stored)).Msg("energy sites refresh complete")
	writeJSON(w, http.StatusOK, stored)
}

// SiteInfo returns stored site_info JSON from DB for a given energy site.
func (h *EnergySiteHandler) SiteInfo(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site ID")
		return
	}

	siteInfoJSON, fetchedAt, err := h.repo.GetSiteInfo(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to get site info")
		writeError(w, http.StatusInternalServerError, "failed to fetch site info")
		return
	}

	if siteInfoJSON == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data":       nil,
			"fetched_at": nil,
		})
		return
	}

	// Write envelope with raw JSON data inside to avoid double-serialization
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"data":%s,"fetched_at":"%s"}`, *siteInfoJSON, fetchedAt.Format("2006-01-02T15:04:05Z"))
}

// RefreshSiteInfo fetches site_info from Tesla, saves to DB, and returns the data.
func (h *EnergySiteHandler) RefreshSiteInfo(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site ID")
		return
	}

	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Int64("site_id", siteID).Msg("refreshing energy site info from Tesla")

	body, status, err := h.teslaClient.GetEnergySiteInfo(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Msg("tesla energy site info API error")
		writeError(w, http.StatusBadGateway, "failed to fetch site info from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla energy site info non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	// Unwrap the Tesla envelope: {"response": {...}}
	var envelope struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse site info envelope")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	innerJSON := string(envelope.Response)
	if innerJSON == "" || innerJSON == "null" {
		innerJSON = "{}"
	}

	if err := h.repo.UpdateSiteInfo(r.Context(), siteID, innerJSON); err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to save site info")
		writeError(w, http.StatusInternalServerError, "failed to save site info")
		return
	}

	// Return the freshly stored data
	siteInfoJSON, fetchedAt, err := h.repo.GetSiteInfo(r.Context(), siteID)
	if err != nil || siteInfoJSON == nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to read back site info after save")
		writeError(w, http.StatusInternalServerError, "failed to read site info after save")
		return
	}

	log.Info().Int64("site_id", siteID).Msg("energy site info refresh complete")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"data":%s,"fetched_at":"%s"}`, *siteInfoJSON, fetchedAt.Format("2006-01-02T15:04:05Z"))
}

// UpdateTOUSettings proxies a time-of-use rate plan update to the Tesla API.
func (h *EnergySiteHandler) UpdateTOUSettings(w http.ResponseWriter, r *http.Request) {
	siteID, err := parseSiteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site ID")
		return
	}

	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Int64("site_id", siteID).Msg("updating TOU settings via Tesla API")

	body, status, err := h.teslaClient.SetEnergySiteTOUSettings(r.Context(), siteID, r.Body)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to update TOU settings")
		writeError(w, http.StatusBadGateway, "failed to update TOU settings")
		return
	}

	// Preserve Tesla's response status for client errors (4xx) so the frontend
	// can distinguish validation failures from server outages.
	if status >= 400 && status < 500 {
		log.Warn().Int("status", status).Int64("site_id", siteID).Msg("tesla rejected TOU settings")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write(body)
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla TOU settings non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	log.Info().Int64("site_id", siteID).Msg("TOU settings updated successfully")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// parseProductsResponse parses the Tesla /products response, filtering to energy products only.
func parseProductsResponse(body []byte) ([]*teslamodel.TeslaEnergySite, error) {
	var envelope struct {
		Response []json.RawMessage `json:"response"`
		Count    int               `json:"count"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("unmarshal products envelope: %w", err)
	}

	var sites []*teslamodel.TeslaEnergySite

	for _, raw := range envelope.Response {
		// Peek at resource_type to filter out vehicles
		var peek struct {
			ResourceType string `json:"resource_type"`
		}
		if err := json.Unmarshal(raw, &peek); err != nil {
			continue
		}
		// Vehicles have resource_type "vehicle" — skip them
		if peek.ResourceType == "vehicle" || peek.ResourceType == "" {
			continue
		}

		var product struct {
			EnergySiteID      int64    `json:"energy_site_id"`
			ResourceType      string   `json:"resource_type"`
			SiteName          string   `json:"site_name"`
			GatewayID         *string  `json:"gateway_id"`
			TotalPackEnergy   *float64 `json:"total_pack_energy"`
			PercentageCharged *float64 `json:"percentage_charged"`
			BatteryType       *string  `json:"battery_type"`
			BackupCapable     bool     `json:"backup_capable"`
			StormModeEnabled  bool     `json:"storm_mode_enabled"`
			Components        struct {
				Solar            bool `json:"solar"`
				Battery          bool `json:"battery"`
				Grid             bool `json:"grid"`
				LoadMeter        bool `json:"load_meter"`
				TOUCapable       bool `json:"tou_capable"`
				StormModeCapable bool `json:"storm_mode_capable"`
			} `json:"components"`
		}
		if err := json.Unmarshal(raw, &product); err != nil {
			log.Warn().Err(err).Msg("skipping unparseable energy product")
			continue
		}

		if product.EnergySiteID == 0 {
			continue
		}

		sites = append(sites, &teslamodel.TeslaEnergySite{
			EnergySiteID:      product.EnergySiteID,
			ResourceType:      product.ResourceType,
			SiteName:          product.SiteName,
			GatewayID:         product.GatewayID,
			TotalPackEnergy:   product.TotalPackEnergy,
			PercentageCharged: product.PercentageCharged,
			BatteryType:       product.BatteryType,
			BackupCapable:     product.BackupCapable,
			StormModeEnabled:  product.StormModeEnabled,
			HasSolar:          product.Components.Solar,
			HasBattery:        product.Components.Battery,
			HasGrid:           product.Components.Grid,
			HasLoadMeter:      product.Components.LoadMeter,
			TOUCapable:        product.Components.TOUCapable,
			StormModeCapable:  product.Components.StormModeCapable,
		})
	}

	return sites, nil
}
