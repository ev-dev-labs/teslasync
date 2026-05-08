package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// WatchSummary is the minimal data needed for a watch face display.
type WatchSummary struct {
	VehicleName  string  `json:"vehicle_name"`
	State        string  `json:"state"`
	BatteryLevel int     `json:"battery_level"`
	RangeKm      float64 `json:"range_km"`
	IsCharging   bool    `json:"is_charging"`
	ChargeRate   float64 `json:"charge_rate"`
	TimeToFull   float64 `json:"time_to_full"`
	IsLocked     bool    `json:"is_locked"`
	SentryMode   bool    `json:"sentry_mode"`
	InsideTemp   float64 `json:"inside_temp_c"`
	OutsideTemp  float64 `json:"outside_temp_c"`
	IsClimateOn  bool    `json:"is_climate_on"`
	LastUpdated  string  `json:"last_updated"`
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
	redisCache   *signal.RedisSignalCache
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

// WithRedisCache sets the Redis signal cache for reading live vehicle state.
func (h *WatchHandler) WithRedisCache(cache *signal.RedisSignalCache) *WatchHandler {
	h.redisCache = cache
	return h
}

// watchCommands is the limited set of commands available from a watch.
var watchCommands = map[string]bool{
	"lock":         true,
	"unlock":       true,
	"climate_on":   true,
	"climate_off":  true,
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
			State:       "unknown",
			IsLocked:    true,
			LastUpdated: vehicle.UpdatedAt.Format(time.RFC3339),
		})
		return
	}

	summary.VehicleName = vehicle.DisplayName

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
			State:    stateEmoji("unknown"),
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
// from the Redis signal cache.
func (h *WatchHandler) queryWatchSummary(ctx context.Context, vehicleID int64) (*WatchSummary, error) {
	if h.redisCache == nil {
		return nil, fmt.Errorf("redis signal cache not available")
	}

	signals, err := h.redisCache.GetAll(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("read redis signals: %w", err)
	}
	if signals == nil {
		return nil, fmt.Errorf("no signals for vehicle %d", vehicleID)
	}

	batteryLevel, _ := signalInt(signals, "BatteryLevel")

	// RatedRange from Fleet Telemetry is in miles — convert to km
	ratedRange, _ := signalFloat(signals, "RatedRange")
	rangeKm := ratedRange * 1.60934

	insideTemp, _ := signalFloat(signals, "InsideTemp")
	outsideTemp, _ := signalFloat(signals, "OutsideTemp")
	chargeRate, _ := signalFloat(signals, "RangeAddedMetersPerHour")

	// TimeToFullCharge is in hours — convert to minutes
	ttf, _ := signalFloat(signals, "TimeToFullCharge")
	ttfMinutes := ttf * 60

	// Locked: default to true (safe assumption) when unknown
	locked := true
	if v, ok := signals["Locked"]; ok && v != nil {
		switch b := v.(type) {
		case bool:
			locked = b
		case string:
			locked = b == "true"
		case float64:
			locked = b > 0
		}
	}

	// SentryMode
	sentryMode := false
	if v, ok := signals["SentryMode"]; ok && v != nil {
		switch b := v.(type) {
		case bool:
			sentryMode = b
		case string:
			sentryMode = b == "true" || b == "On"
		case float64:
			sentryMode = b > 0
		}
	}

	// HvacPower is an enum ("On"/"Off") or bool
	isClimateOn := false
	if v, ok := signals["HvacPower"]; ok {
		switch hv := v.(type) {
		case bool:
			isClimateOn = hv
		case string:
			isClimateOn = enums.ParseHvacPower(hv)
		case float64:
			isClimateOn = hv > 0
		}
	}

	chargeState, _ := signalStr(signals, "ChargeState")
	isCharging := chargeState == enums.ChargeStateCharging || chargeState == "charging"

	return &WatchSummary{
		BatteryLevel: batteryLevel,
		RangeKm:      rangeKm,
		IsCharging:   isCharging,
		ChargeRate:   chargeRate,
		TimeToFull:   ttfMinutes,
		IsLocked:     locked,
		SentryMode:   sentryMode,
		InsideTemp:   insideTemp,
		OutsideTemp:  outsideTemp,
		IsClimateOn:  isClimateOn,
		LastUpdated:  time.Now().UTC().Format(time.RFC3339),
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
	case enums.StateOnline:
		return "🟢"
	case enums.StateAsleep:
		return "😴"
	case enums.StateDriving:
		return "🚗"
	case enums.StateCharging:
		return "⚡"
	default:
		return "⚫"
	}
}

func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
