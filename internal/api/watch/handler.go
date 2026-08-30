package watch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiauthctx"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// vehicleReader is the narrow slice of the vehicle repository the watch
// handlers depend on. Defined as an interface so handlers can be exercised with
// in-memory fakes; *vehicledb.VehicleRepo satisfies it in production.
type vehicleReader interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
}

// settingsReader exposes only the API-suspension check the command path needs.
type settingsReader interface {
	IsAPISuspended(ctx context.Context) (bool, error)
}

// teslaCommander is the subset of *tesla.Client used to authenticate and
// dispatch watch commands.
type teslaCommander interface {
	HasValidToken() bool
	SendCommand(ctx context.Context, vin, command string, params map[string]interface{}) error
}

// signalReader reads a vehicle's live signal snapshot from the Redis cache.
type signalReader interface {
	GetAll(ctx context.Context, vehicleID int64) (map[string]interface{}, error)
}

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

// Handler handles lightweight watch-optimized endpoints.
type Handler struct {
	db           *database.DB
	vehicleRepo  vehicleReader
	settingsRepo settingsReader
	teslaClient  teslaCommander
	redisCache   signalReader
}

// NewHandler wires watch endpoints to vehicle/settings repos and Tesla commands.
func NewHandler(db *database.DB, tc *tesla.Client) *Handler {
	return &Handler{
		db:           db,
		vehicleRepo:  vehicledb.NewVehicleRepo(db),
		settingsRepo: settingsdb.NewSettingsRepo(db),
		teslaClient:  tc,
	}
}

// WithRedisCache sets the Redis signal cache for reading live vehicle state.
// A nil cache is ignored so the handler keeps its graceful degrade path
// (queryWatchSummary reports the cache as unavailable rather than panicking on
// an interface that wraps a typed-nil pointer).
func (h *Handler) WithRedisCache(cache *signal.RedisSignalCache) *Handler {
	if cache != nil {
		h.redisCache = cache
	}
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
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := resolveWatchVehicleID(r, h.vehicleRepo)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil || vehicle == nil {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	summary, err := h.queryWatchSummary(r.Context(), vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("no live state for watch summary")
		// Fall back to durable vehicle metadata when live state is unavailable.
		httpx.WriteJSON(w, http.StatusOK, WatchSummary{
			VehicleName: vehicle.DisplayName,
			State:       "unknown",
			IsLocked:    true,
			LastUpdated: vehicle.UpdatedAt.Format(time.RFC3339),
		})
		return
	}

	summary.VehicleName = vehicle.DisplayName

	httpx.WriteJSON(w, http.StatusOK, summary)
}

// Complication returns the absolute minimum data for Apple Watch complications.
func (h *Handler) Complication(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := resolveWatchVehicleID(r, h.vehicleRepo)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	summary, err := h.queryWatchSummary(r.Context(), vehicleID)
	if err != nil {
		vehicle, vErr := h.vehicleRepo.GetByID(r.Context(), vehicleID)
		if vErr != nil || vehicle == nil {
			httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, WatchComplication{
			Battery:  "—",
			Range:    "—",
			State:    stateEmoji("unknown"),
			Charging: false,
		})
		return
	}

	rangeStr := strconv.Itoa(int(summary.RangeKm)) + "km"
	httpx.WriteJSON(w, http.StatusOK, WatchComplication{
		Battery:  strconv.Itoa(summary.BatteryLevel) + "%",
		Range:    rangeStr,
		State:    stateEmoji(summary.State),
		Charging: summary.IsCharging,
	})
}

// Command executes a simplified vehicle command from a watch.
func (h *Handler) Command(w http.ResponseWriter, r *http.Request) {
	perms, _ := apiauthctx.PermissionsFromContext(r.Context())
	if perms != "read-write" && perms != "admin" {
		httpx.WriteError(w, http.StatusForbidden, "API key requires read-write or admin permissions for commands")
		return
	}

	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		httpx.WriteError(w, http.StatusConflict, "Tesla API calls are suspended")
		return
	}

	var body struct {
		VehicleID int64  `json:"vehicle_id"`
		Command   string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Command == "" {
		httpx.WriteError(w, http.StatusBadRequest, "command is required")
		return
	}

	if !watchCommands[body.Command] {
		httpx.WriteError(w, http.StatusBadRequest, "unsupported watch command: "+body.Command)
		return
	}

	vehicleID := body.VehicleID
	if vehicleID == 0 {
		vehicles, err := h.vehicleRepo.GetAll(r.Context())
		if err != nil || len(vehicles) == 0 {
			httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
			return
		}
		vehicleID = vehicles[0].ID
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil || vehicle == nil {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, body.Command, nil)
	if cmdErr != nil {
		// Fleet API daily budget errors are a distinct, structured failure
		// mode — surface the real HTTP status instead of the generic
		// 200/success:false envelope below so watch clients (and any
		// resilience layer inspecting status codes) can tell "budget
		// exhausted, don't retry" apart from "command failed, maybe retry".
		if failure, matched := httpx.ClassifyTeslaBudgetError(cmdErr); matched {
			log.Warn().Err(cmdErr).
				Str("command", body.Command).
				Int64("vehicle_id", vehicleID).
				Msg("watch command rejected: Fleet API budget constraint")
			httpx.WriteError(w, failure.StatusCode, failure.Message)
			return
		}
		log.Error().Err(cmdErr).
			Str("command", body.Command).
			Int64("vehicle_id", vehicleID).
			Msg("watch command failed")
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": "Command failed: " + cmdErr.Error(),
		})
		return
	}

	log.Info().
		Str("command", body.Command).
		Int64("vehicle_id", vehicleID).
		Msg("watch command sent")

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Command sent successfully",
	})
}

// queryWatchSummary reads only the fields needed for a watch display
// from the Redis signal cache.
func (h *Handler) queryWatchSummary(ctx context.Context, vehicleID int64) (*WatchSummary, error) {
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

	// Watch clients currently expect kilometers while RatedRange is legacy miles.
	ratedRange, _ := signalFloat(signals, "RatedRange")
	rangeKm := ratedRange * 1.60934

	insideTemp, _ := signalFloat(signals, "InsideTemp")
	outsideTemp, _ := signalFloat(signals, "OutsideTemp")
	chargeRate, _ := signalFloat(signals, "ChargeRateMilePerHour")

	// Watch clients display TimeToFullCharge in minutes.
	ttf, _ := signalFloat(signals, "TimeToFullCharge")
	ttfMinutes := ttf * 60

	// Default to locked when freshness is unknown.
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

	// HvacPower may be an enum, bool, or numeric cache value.
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
func resolveWatchVehicleID(r *http.Request, repo vehicleReader) (int64, error) {
	if vidStr := r.URL.Query().Get("vehicle_id"); vidStr != "" {
		vid, err := strconv.ParseInt(vidStr, 10, 64)
		if err != nil || vid <= 0 {
			return 0, fmt.Errorf("invalid vehicle_id")
		}
		return vid, nil
	}
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

func signalFloat(signals map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			return toFloatOk(v)
		}
	}
	return 0, false
}

func signalInt(signals map[string]interface{}, keys ...string) (int, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if f, fok := toFloatOk(v); fok {
				return int(f), true
			}
		}
	}
	return 0, false
}

func signalStr(signals map[string]interface{}, keys ...string) (string, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if s, ok2 := v.(string); ok2 && s != "" {
				return s, true
			}
		}
	}
	return "", false
}

func toFloatOk(v interface{}) (float64, bool) {
	return signal.Float64(v)
}
