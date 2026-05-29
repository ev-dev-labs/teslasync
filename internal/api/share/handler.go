package share

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	positiondb "github.com/ev-dev-labs/teslasync/internal/database/position"
	"github.com/ev-dev-labs/teslasync/internal/database/sharing"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// ShareHandler handles share link creation and public access.
type ShareHandler struct {
	shareRepo   *sharing.TokenRepo
	driveRepo   *drivedb.DriveRepo
	posRepo     *positiondb.PositionRepo
	vehicleRepo *vehicledb.VehicleRepo
}

func NewShareHandler(db *database.DB) *ShareHandler {
	return &ShareHandler{
		shareRepo:   sharing.NewTokenRepo(db),
		driveRepo:   drivedb.NewDriveRepo(db),
		posRepo:     positiondb.NewPositionRepo(db),
		vehicleRepo: vehicledb.NewVehicleRepo(db),
	}
}

// ── Public DTOs — allowlisted fields only, no PII ──────────────────

type publicDriveInfo struct {
	Date          string   `json:"date"`
	DistanceM     float64  `json:"distance_m"`
	DurationS     int64    `json:"duration_s"`
	StartAddress  string   `json:"start_address"`
	EndAddress    string   `json:"end_address"`
	StartBattery  *int16   `json:"start_battery"`
	EndBattery    *int16   `json:"end_battery"`
	MaxSpeedMps   *float64 `json:"max_speed_mps,omitempty"`
	AvgSpeedMps   *float64 `json:"avg_speed_mps,omitempty"`
	EfficiencyWhM *float64 `json:"efficiency_wh_per_m,omitempty"`
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
	DistanceM  float64 `json:"distance_m"`
	ElevationM float64 `json:"elevation_m"`
}

type publicSpeedPoint struct {
	DistanceM float64 `json:"distance_m"`
	SpeedMps  float64 `json:"speed_mps"`
}

type publicTelemetryPoint struct {
	DistanceM    float64  `json:"distance_m"`
	BatteryLevel *int     `json:"battery_level,omitempty"`
	Power        *float64 `json:"power,omitempty"`
	Elevation    *float64 `json:"elevation,omitempty"`
}

type publicShareResponse struct {
	PayloadVersion   string                 `json:"payload_version"`
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
	driveID, err := apiparams.URLParamInt64(r, "driveID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()

	// Verify drive exists
	drive, err := h.driveRepo.GetByID(ctx, driveID)
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("share: failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	var req createShareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
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

	st := &drivemodel.ShareToken{
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create share link")
		return
	}

	log.Info().
		Str("token", st.Token[:8]+"...").
		Int64("drive_id", driveID).
		Msg("share link created")

	httpx.WriteJSON(w, http.StatusCreated, map[string]interface{}{
		"token": st.Token,
		"url":   "/s/" + st.Token,
		"id":    st.ID,
	})
}

// ── List shares for a drive (authenticated) ────────────────────────

func (h *ShareHandler) List(w http.ResponseWriter, r *http.Request) {
	driveID, err := apiparams.URLParamInt64(r, "driveID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	tokens, err := h.shareRepo.ListByDrive(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("share: failed to list")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list shares")
		return
	}
	if tokens == nil {
		tokens = make([]*drivemodel.ShareToken, 0)
	}
	httpx.WriteJSON(w, http.StatusOK, tokens)
}

// ── Revoke share link (authenticated) ──────────────────────────────

func (h *ShareHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		httpx.WriteError(w, http.StatusBadRequest, "token required")
		return
	}

	if err := h.shareRepo.Delete(r.Context(), token); err != nil {
		log.Error().Err(err).Str("token", token[:8]+"...").Msg("share: failed to revoke")
		httpx.WriteError(w, http.StatusNotFound, "share link not found")
		return
	}

	log.Info().Str("token", token[:8]+"...").Msg("share link revoked")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// ── Public share view (NO authentication) ──────────────────────────

func (h *ShareHandler) GetPublicShare(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	ctx := r.Context()

	share, err := h.shareRepo.GetByToken(ctx, token)
	if err != nil {
		log.Error().Err(err).Msg("share: failed to get token")
		httpx.WriteError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if share == nil {
		httpx.WriteError(w, http.StatusNotFound, "share not found or expired")
		return
	}

	// Check expiry
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now().UTC()) {
		httpx.WriteError(w, http.StatusGone, "share link has expired")
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
		httpx.WriteError(w, http.StatusNotFound, "shared drive no longer exists")
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
		DistanceM:    drive.DistanceM,
		DurationS:    drive.DurationS,
		StartAddress: safeDeref(drive.StartAddress, ""),
		EndAddress:   safeDeref(drive.EndAddress, ""),
		StartBattery: drive.StartBatteryPct,
		EndBattery:   drive.EndBatteryPct,
	}

	if share.IncludeSpeed {
		if drive.MaxSpeedMps != nil {
			v := *drive.MaxSpeedMps
			info.MaxSpeedMps = &v
		}
		if drive.AvgSpeedMps != nil {
			v := *drive.AvgSpeedMps
			info.AvgSpeedMps = &v
		}
	}

	// Approximate efficiency: battery % delta per km → Wh/km
	if drive.StartBatteryPct != nil && drive.EndBatteryPct != nil && drive.DistanceM > 2000 {
		battUsed := float64(*drive.StartBatteryPct - *drive.EndBatteryPct)
		if battUsed > 0 {
			eff := battUsed / drive.DistanceM * 100 * 750.0
			info.EfficiencyWhM = &eff
		}
	}

	resp := publicShareResponse{
		PayloadVersion: "v2",
		Title:          safeDeref(share.Title, "Shared Drive"),
		Description:    safeDeref(share.Description, ""),
		Drive:          info,
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
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// buildPublicProfiles populates map points, elevation, speed, and telemetry
// from drive positions/telemetry. It clips the first and last few points to
// hide exact start/end locations.
func (h *ShareHandler) buildPublicProfiles(ctx context.Context, resp *publicShareResponse, drive *drivemodel.Drive, share *drivemodel.ShareToken) {
	// Drive telemetry repo removed — fall back to positions only.
	if drive.EndTs != nil {
		positions, _ := h.posRepo.ListByVehicle(ctx, drive.VehicleID, drive.StartTs, *drive.EndTs)
		if len(positions) > 0 {
			h.buildFromPositions(resp, positions, share)
		}
	}
}

const clipPoints = 3 // number of points to clip from start/end for privacy

func (h *ShareHandler) buildFromPositions(resp *publicShareResponse, positions []telemetrymodel.Position, share *drivemodel.ShareToken) {
	n := len(positions)
	if n <= clipPoints*2 {
		return
	}

	clipped := positions[clipPoints : n-clipPoints]

	var cumulativeDistM float64
	var prevLat, prevLng float64

	for i, p := range clipped {
		if p.Latitude == 0 && p.Longitude == 0 {
			continue
		}

		if i > 0 && prevLat != 0 {
			cumulativeDistM += haversineKm(prevLat, prevLng, p.Latitude, p.Longitude) * 1000.0
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
				DistanceM:  cumulativeDistM,
				ElevationM: *p.ElevationM,
			})
		}

		if share.IncludeSpeed && p.SpeedMph != nil {
			resp.SpeedProfile = append(resp.SpeedProfile, publicSpeedPoint{
				DistanceM: cumulativeDistM,
				SpeedMps:  *p.SpeedMph * 0.44704,
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

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0

	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}
