package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// WatchSummary is the minimal data needed for a watch face display.
type WatchSummary struct {
	VehicleName string  `json:"vehicle_name"`
	State       string  `json:"state"`
	BatteryLevel int    `json:"battery_level"`
	RangeKm     float64 `json:"range_km"`
	IsCharging  bool    `json:"is_charging"`
	ChargeRate  float64 `json:"charge_rate"`
	TimeToFull  float64 `json:"time_to_full"`
	IsLocked    bool    `json:"is_locked"`
	SentryMode  bool    `json:"sentry_mode"`
	InsideTemp  float64 `json:"inside_temp_c"`
	OutsideTemp float64 `json:"outside_temp_c"`
	IsClimateOn bool    `json:"is_climate_on"`
	LastUpdated string  `json:"last_updated"`
}

// WatchComplication is the absolute minimum for Apple Watch complications.
type WatchComplication struct {
	Battery  string `json:"battery"`
	Range    string `json:"range"`
	State    string `json:"state"`
	Charging bool   `json:"charging"`
}

// WatchHandler handles lightweight watch-optimized endpoints.
type WatchHandler struct {
	db           *database.DB
	vehicleRepo  *database.VehicleRepo
	settingsRepo *database.SettingsRepo
	teslaClient  *tesla.Client
}

// NewWatchHandler creates a new WatchHandler.
func NewWatchHandler(db *database.DB, tc *tesla.Client) *WatchHandler {
	return &WatchHandler{
		db:           db,
		vehicleRepo:  database.NewVehicleRepo(db),
		settingsRepo: database.NewSettingsRepo(db),
		teslaClient:  tc,
	}
}

// watchCommands is the limited set of commands available from a watch.
var watchCommands = map[string]bool{
	"lock":        true,
	"unlock":      true,
	"climate_on":  true,
	"climate_off": true,
	"charge_start": true,
	"charge_stop":  true,
	"flash_lights": true,
	"honk_horn":    true,
}

// Summary returns a minimal vehicle summary optimized for watch displays.
func (h *WatchHandler) Summary(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := resolveWatchVehicleID(r, h.vehicleRepo)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil || vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	summary, err := h.queryWatchSummary(r.Context(), vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("no live state for watch summary")
		// Return basic info from vehicle record when no live state exists
		writeJSON(w, http.StatusOK, WatchSummary{
			VehicleName: vehicle.DisplayName,
			State:       vehicle.State,
			IsLocked:    true,
			LastUpdated: vehicle.UpdatedAt.Format(time.RFC3339),
		})
		return
	}

	summary.VehicleName = vehicle.DisplayName
	summary.State = vehicle.State

	writeJSON(w, http.StatusOK, summary)
}

// Complication returns the absolute minimum data for Apple Watch complications.
func (h *WatchHandler) Complication(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := resolveWatchVehicleID(r, h.vehicleRepo)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	summary, err := h.queryWatchSummary(r.Context(), vehicleID)
	if err != nil {
		// Fallback: get basic vehicle info
		vehicle, vErr := h.vehicleRepo.GetByID(r.Context(), vehicleID)
		if vErr != nil || vehicle == nil {
			writeError(w, http.StatusNotFound, "vehicle not found")
			return
		}
		writeJSON(w, http.StatusOK, WatchComplication{
			Battery:  "—",
			Range:    "—",
			State:    stateEmoji(vehicle.State),
			Charging: false,
		})
		return
	}

	rangeStr := strconv.Itoa(int(summary.RangeKm)) + "km"
	writeJSON(w, http.StatusOK, WatchComplication{
		Battery:  strconv.Itoa(summary.BatteryLevel) + "%",
		Range:    rangeStr,
		State:    stateEmoji(summary.State),
		Charging: summary.IsCharging,
	})
}

// Command executes a simplified vehicle command from a watch.
func (h *WatchHandler) Command(w http.ResponseWriter, r *http.Request) {
	// Check API key permissions — commands require read-write or admin
	perms, _ := r.Context().Value(apiKeyPermCtxKey{}).(string)
	if perms != "read-write" && perms != "admin" {
		writeError(w, http.StatusForbidden, "API key requires read-write or admin permissions for commands")
		return
	}

	// Check if API is suspended
	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		writeError(w, http.StatusConflict, "Tesla API calls are suspended")
		return
	}

	var body struct {
		VehicleID int64  `json:"vehicle_id"`
		Command   string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Command == "" {
		writeError(w, http.StatusBadRequest, "command is required")
		return
	}

	if !watchCommands[body.Command] {
		writeError(w, http.StatusBadRequest, "unsupported watch command: "+body.Command)
		return
	}

	vehicleID := body.VehicleID
	if vehicleID == 0 {
		// Try to resolve default vehicle
		vehicles, err := h.vehicleRepo.GetAll(r.Context())
		if err != nil || len(vehicles) == 0 {
			writeError(w, http.StatusBadRequest, "vehicle_id is required")
			return
		}
		vehicleID = vehicles[0].ID
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil || vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, body.Command, nil)
	if cmdErr != nil {
		log.Error().Err(cmdErr).
			Str("command", body.Command).
			Int64("vehicle_id", vehicleID).
			Msg("watch command failed")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": "Command failed: " + cmdErr.Error(),
		})
		return
	}

	log.Info().
		Str("command", body.Command).
		Int64("vehicle_id", vehicleID).
		Msg("watch command sent")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Command sent successfully",
	})
}

// queryWatchSummary reads only the fields needed for a watch display
// from vehicle_live_state using a single efficient query.
func (h *WatchHandler) queryWatchSummary(ctx context.Context, vehicleID int64) (*WatchSummary, error) {
	var batteryLevel *int
	var ratedRange, insideTemp, outsideTemp *float64
	var chargeRate, timeToFull *float64
	var locked, sentryMode, hvacPower *bool
	var chargeState *string
	var updatedAt *time.Time

	err := h.db.Pool.QueryRow(ctx, `
		SELECT battery_level, rated_range, inside_temp, outside_temp,
		       charge_rate, time_to_full_charge, locked, sentry_mode,
		       hvac_power, charge_state, updated_at
		FROM vehicle_live_state
		WHERE vehicle_id = $1`, vehicleID).Scan(
		&batteryLevel, &ratedRange, &insideTemp, &outsideTemp,
		&chargeRate, &timeToFull, &locked, &sentryMode,
		&hvacPower, &chargeState, &updatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Convert rated_range from miles to km (DB stores miles)
	rangeKm := 0.0
	if ratedRange != nil {
		rangeKm = *ratedRange * 1.60934
	}

	isCharging := false
	if chargeState != nil && (*chargeState == "Charging" || *chargeState == "charging") {
		isCharging = true
	}

	lastUpdated := time.Now().UTC().Format(time.RFC3339)
	if updatedAt != nil {
		lastUpdated = updatedAt.Format(time.RFC3339)
	}

	// Convert time_to_full from hours to minutes
	ttfMinutes := 0.0
	if timeToFull != nil {
		ttfMinutes = *timeToFull * 60
	}

	return &WatchSummary{
		BatteryLevel: derefInt(batteryLevel),
		RangeKm:      rangeKm,
		IsCharging:   isCharging,
		ChargeRate:   derefFloat(chargeRate),
		TimeToFull:   ttfMinutes,
		IsLocked:     locked == nil || *locked, // default locked when unknown
		SentryMode:   sentryMode != nil && *sentryMode,
		InsideTemp:   derefFloat(insideTemp),
		OutsideTemp:  derefFloat(outsideTemp),
		IsClimateOn:  hvacPower != nil && *hvacPower,
		LastUpdated:  lastUpdated,
	}, nil
}

// resolveWatchVehicleID extracts vehicle_id from query params, falling back
// to the first vehicle if not specified.
func resolveWatchVehicleID(r *http.Request, repo *database.VehicleRepo) (int64, error) {
	if vidStr := r.URL.Query().Get("vehicle_id"); vidStr != "" {
		vid, err := strconv.ParseInt(vidStr, 10, 64)
		if err != nil || vid <= 0 {
			return 0, fmt.Errorf("invalid vehicle_id")
		}
		return vid, nil
	}
	// Default to first vehicle
	vehicles, err := repo.GetAll(r.Context())
	if err != nil || len(vehicles) == 0 {
		return 0, fmt.Errorf("no vehicles found")
	}
	return vehicles[0].ID, nil
}

// stateEmoji returns a colored circle emoji for vehicle state.
func stateEmoji(state string) string {
	switch state {
	case "online":
		return "🟢"
	case "asleep":
		return "😴"
	case "driving":
		return "🚗"
	case "charging":
		return "⚡"
	default:
		return "⚫"
	}
}
