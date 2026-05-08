package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// ShareHandler handles share link creation and public access.
type ShareHandler struct {
	shareRepo   *database.ShareTokenRepo
	driveRepo   *database.DriveRepo
	posRepo     *database.PositionRepo
	vehicleRepo *database.VehicleRepo
}

func NewShareHandler(db *database.DB) *ShareHandler {
	return &ShareHandler{
		shareRepo:   database.NewShareTokenRepo(db),
		driveRepo:   database.NewDriveRepo(db),
		posRepo:     database.NewPositionRepo(db),
		vehicleRepo: database.NewVehicleRepo(db),
	}
}

// ── Public DTOs — allowlisted fields only, no PII ──────────────────

type publicDriveInfo struct {
	Date           string   `json:"date"`
	DistanceKm     float64  `json:"distance_km"`
	DurationMin    float64  `json:"duration_min"`
	StartAddress   string   `json:"start_address"`
	EndAddress     string   `json:"end_address"`
	StartBattery   *int16   `json:"start_battery"`
	EndBattery     *int16   `json:"end_battery"`
	MaxSpeedKmh    *float64 `json:"max_speed_kmh,omitempty"`
	AvgSpeedKmh    *float64 `json:"avg_speed_kmh,omitempty"`
	EfficiencyWhKm *float64 `json:"efficiency_wh_km,omitempty"`
}

type publicVehicle struct {
	Model string `json:"model"`
	Color string `json:"color"`
}

type publicMapPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type publicElevationPoint struct {
	DistanceKm float64 `json:"distance_km"`
	ElevationM float64 `json:"elevation_m"`
}

type publicSpeedPoint struct {
	DistanceKm float64 `json:"distance_km"`
	SpeedKmh   float64 `json:"speed_kmh"`
}

type publicTelemetryPoint struct {
	DistanceKm   float64  `json:"distance_km"`
	BatteryLevel *int     `json:"battery_level,omitempty"`
	Power        *float64 `json:"power,omitempty"`
	Elevation    *float64 `json:"elevation,omitempty"`
}

type publicShareResponse struct {
	Title            string                 `json:"title"`
	Description      string                 `json:"description"`
	Drive            publicDriveInfo        `json:"drive"`
	Vehicle          *publicVehicle         `json:"vehicle,omitempty"`
	MapPoints        []publicMapPoint       `json:"map_points,omitempty"`
	ElevationProfile []publicElevationPoint `json:"elevation_profile,omitempty"`
	SpeedProfile     []publicSpeedPoint     `json:"speed_profile,omitempty"`
	Telemetry        []publicTelemetryPoint `json:"telemetry,omitempty"`
}

// ── Create share link (authenticated) ──────────────────────────────

type createShareRequest struct {
	Title            string `json:"title"`
	Description      string `json:"description"`
	IncludeSpeed     *bool  `json:"include_speed"`
	IncludeTelemetry *bool  `json:"include_telemetry"`
	ExpiresInDays    int    `json:"expires_in_days"`
}

func (h *ShareHandler) Create(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()

	// Verify drive exists
	drive, err := h.driveRepo.GetByID(ctx, driveID)
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("share: failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	var req createShareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	includeSpeed := true
	if req.IncludeSpeed != nil {
		includeSpeed = *req.IncludeSpeed
	}
	includeTelemetry := false
	if req.IncludeTelemetry != nil {
		includeTelemetry = *req.IncludeTelemetry
	}

	st := &models.ShareToken{
		DriveID:          driveID,
		IncludeMap:       true,
		IncludeSpeed:     includeSpeed,
		IncludeTelemetry: includeTelemetry,
	}
	if req.Title != "" {
		st.Title = &req.Title
	}
	if req.Description != "" {
		st.Description = &req.Description
	}
	if req.ExpiresInDays > 0 {
		exp := time.Now().UTC().Add(time.Duration(req.ExpiresInDays) * 24 * time.Hour)
		st.ExpiresAt = &exp
	}

	if err := h.shareRepo.Create(ctx, st); err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("share: failed to create")
		writeError(w, http.StatusInternalServerError, "failed to create share link")
		return
	}

	log.Info().
		Str("token", st.Token[:8]+"...").
		Int64("drive_id", driveID).
		Msg("share link created")

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"token": st.Token,
		"url":   "/s/" + st.Token,
		"id":    st.ID,
	})
}

// ── List shares for a drive (authenticated) ────────────────────────

func (h *ShareHandler) List(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	tokens, err := h.shareRepo.ListByDrive(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("share: failed to list")
		writeError(w, http.StatusInternalServerError, "failed to list shares")
		return
	}
	if tokens == nil {
		tokens = make([]*models.ShareToken, 0)
	}
	writeJSON(w, http.StatusOK, tokens)
}

// ── Revoke share link (authenticated) ──────────────────────────────

func (h *ShareHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}

	if err := h.shareRepo.Delete(r.Context(), token); err != nil {
		log.Error().Err(err).Str("token", token[:8]+"...").Msg("share: failed to revoke")
		writeError(w, http.StatusNotFound, "share link not found")
		return
	}

	log.Info().Str("token", token[:8]+"...").Msg("share link revoked")
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// ── Public share view (NO authentication) ──────────────────────────

func (h *ShareHandler) GetPublicShare(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	ctx := r.Context()

	share, err := h.shareRepo.GetByToken(ctx, token)
	if err != nil {
		log.Error().Err(err).Msg("share: failed to get token")
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if share == nil {
		writeError(w, http.StatusNotFound, "share not found or expired")
		return
	}

	// Check expiry
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now().UTC()) {
		writeError(w, http.StatusGone, "share link has expired")
		return
	}

	// Increment view counter synchronously
	if err := h.shareRepo.IncrementViews(ctx, share.ID); err != nil {
		log.Warn().Err(err).Int64("shareID", share.ID).Msg("share: failed to increment views")
	}

	// Fetch drive
	drive, err := h.driveRepo.GetByID(ctx, share.DriveID)
	if err != nil || drive == nil {
		log.Error().Err(err).Int64("driveID", share.DriveID).Msg("share: drive not found")
		writeError(w, http.StatusNotFound, "shared drive no longer exists")
		return
	}

	// Build public drive info (no PII).
	// Decision #3 (phase-48 methodology): convert SI canonical Drive fields
	// to true km / min / km/h for the existing publicDriveInfo JSON shape.
	// Pre-Phase-48 the field names said "km" but the values were silently
	// miles; Slice 4 will rename the JSON keys to SI canonical and bump the
	// payload `version` field. Numbers in newly issued share links jump by
	// a factor of ~1.609× compared to old links — that is the correct
	// behaviour.
	info := publicDriveInfo{
		Date:         drive.StartTs.Format("2006-01-02"),
		DistanceKm:   drive.DistanceM / 1000.0,
		DurationMin:  float64(drive.DurationS) / 60.0,
		StartAddress: safeDeref(drive.StartAddress, ""),
		EndAddress:   safeDeref(drive.EndAddress, ""),
		StartBattery: drive.StartBatteryPct,
		EndBattery:   drive.EndBatteryPct,
	}

	if share.IncludeSpeed {
		if drive.MaxSpeedMps != nil {
			v := *drive.MaxSpeedMps * 3.6
			info.MaxSpeedKmh = &v
		}
		if drive.AvgSpeedMps != nil {
			v := *drive.AvgSpeedMps * 3.6
			info.AvgSpeedKmh = &v
		}
	}

	// Approximate efficiency: battery % delta per km → Wh/km
	distanceKm := drive.DistanceM / 1000.0
	if drive.StartBatteryPct != nil && drive.EndBatteryPct != nil && distanceKm > 2 {
		battUsed := float64(*drive.StartBatteryPct - *drive.EndBatteryPct)
		if battUsed > 0 {
			eff := battUsed / distanceKm * 100 * 0.75
			info.EfficiencyWhKm = &eff
		}
	}

	resp := publicShareResponse{
		Title:       safeDeref(share.Title, "Shared Drive"),
		Description: safeDeref(share.Description, ""),
		Drive:       info,
	}

	// Fetch vehicle info (model and color only — no VIN, no IDs)
	vehicle, err := h.vehicleRepo.GetByID(ctx, drive.VehicleID)
	if err == nil && vehicle != nil {
		resp.Vehicle = &publicVehicle{
			Model: safeDeref(vehicle.Model, ""),
			Color: safeDeref(vehicle.Color, ""),
		}
	}

	// Build map, elevation, and speed profiles from positions/telemetry
	if share.IncludeMap || share.IncludeSpeed || share.IncludeTelemetry {
		h.buildPublicProfiles(ctx, &resp, drive, share)
	}

	// Cache the response for 5 minutes
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, resp)
}

// buildPublicProfiles populates map points, elevation, speed, and telemetry
// from drive positions/telemetry. It clips the first and last few points to
// hide exact start/end locations.
func (h *ShareHandler) buildPublicProfiles(ctx context.Context, resp *publicShareResponse, drive *models.Drive, share *models.ShareToken) {
	// Drive telemetry repo removed — fall back to positions only.
	if drive.EndTs != nil {
		positions, _ := h.posRepo.ListByVehicle(ctx, drive.VehicleID, drive.StartTs, *drive.EndTs)
		if len(positions) > 0 {
			h.buildFromPositions(resp, positions, share)
		}
	}
}

const clipPoints = 3 // number of points to clip from start/end for privacy

func (h *ShareHandler) buildFromTelemetry(resp *publicShareResponse, readings []*models.DriveTelemetryReading, share *models.ShareToken) {
	n := len(readings)
	if n <= clipPoints*2 {
		return
	}

	// Clip start and end points for privacy
	clipped := readings[clipPoints : n-clipPoints]

	var cumulativeDist float64
	var prevLat, prevLng float64

	for i, tp := range clipped {
		lat := derefFloat(tp.Latitude)
		lng := derefFloat(tp.Longitude)

		if lat == 0 && lng == 0 {
			continue
		}

		// Accumulate distance
		if i > 0 && prevLat != 0 {
			cumulativeDist += haversineKm(prevLat, prevLng, lat, lng)
		}
		prevLat, prevLng = lat, lng

		if share.IncludeMap {
			resp.MapPoints = append(resp.MapPoints, publicMapPoint{Lat: lat, Lng: lng})
		}

		if tp.Elevation != nil {
			resp.ElevationProfile = append(resp.ElevationProfile, publicElevationPoint{
				DistanceKm: cumulativeDist,
				ElevationM: *tp.Elevation,
			})
		}

		if share.IncludeSpeed && tp.Speed != nil {
			resp.SpeedProfile = append(resp.SpeedProfile, publicSpeedPoint{
				DistanceKm: cumulativeDist,
				SpeedKmh:   *tp.Speed,
			})
		}

		if share.IncludeTelemetry {
			resp.Telemetry = append(resp.Telemetry, publicTelemetryPoint{
				DistanceKm:   cumulativeDist,
				BatteryLevel: tp.BatteryLevel,
				Power:        tp.Power,
				Elevation:    tp.Elevation,
			})
		}
	}
}

func (h *ShareHandler) buildFromPositions(resp *publicShareResponse, positions []models.Position, share *models.ShareToken) {
	n := len(positions)
	if n <= clipPoints*2 {
		return
	}

	clipped := positions[clipPoints : n-clipPoints]

	var cumulativeDist float64
	var prevLat, prevLng float64

	for i, p := range clipped {
		if p.Latitude == 0 && p.Longitude == 0 {
			continue
		}

		if i > 0 && prevLat != 0 {
			cumulativeDist += haversineKm(prevLat, prevLng, p.Latitude, p.Longitude)
		}
		prevLat, prevLng = p.Latitude, p.Longitude

		if share.IncludeMap {
			resp.MapPoints = append(resp.MapPoints, publicMapPoint{
				Lat: p.Latitude,
				Lng: p.Longitude,
			})
		}

		if p.ElevationM != nil {
			resp.ElevationProfile = append(resp.ElevationProfile, publicElevationPoint{
				DistanceKm: cumulativeDist,
				ElevationM: *p.ElevationM,
			})
		}

		if share.IncludeSpeed && p.SpeedMph != nil {
			resp.SpeedProfile = append(resp.SpeedProfile, publicSpeedPoint{
				DistanceKm: cumulativeDist,
				SpeedKmh:   *p.SpeedMph,
			})
		}
	}
}

// ── Helpers ────────────────────────────────────────────────────────

func safeDeref(s *string, fallback string) string {
	if s != nil {
		return *s
	}
	return fallback
}
