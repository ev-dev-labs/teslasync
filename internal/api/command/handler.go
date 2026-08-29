package command

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/database"

	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	cmdFSM "github.com/ev-dev-labs/teslasync/internal/fsm/command"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// CommandHandler handles vehicle command HTTP requests.
type CommandHandler struct {
	vehicleRepo  *vehicledb.VehicleRepo
	commandRepo  *energydb.CommandLogRepo
	settingsRepo *settingsdb.SettingsRepo
	teslaClient  *tesla.Client
	redisCache   *signal.RedisSignalCache
}

func NewCommandHandler(db *database.DB, tc *tesla.Client) *CommandHandler {
	return &CommandHandler{
		vehicleRepo:  vehicledb.NewVehicleRepo(db),
		commandRepo:  energydb.NewCommandLogRepo(db),
		settingsRepo: settingsdb.NewSettingsRepo(db),
		teslaClient:  tc,
	}
}

// WithRedisCache sets the Redis signal cache for reading vehicle wake state.
func (h *CommandHandler) WithRedisCache(cache *signal.RedisSignalCache) *CommandHandler {
	h.redisCache = cache
	return h
}

// allowedCommands is the whitelist of Tesla commands that can be sent via the API.
// Names must match the frontend command names and the `commands` map in tesla/client.go.
var allowedCommands = map[string]bool{
	"wake_up":                      true,
	"wake":                         true,
	"lock":                         true,
	"unlock":                       true,
	"honk_horn":                    true,
	"honk":                         true,
	"flash_lights":                 true,
	"flash":                        true,
	"climate_on":                   true,
	"climate_off":                  true,
	"set_temps":                    true,
	"charge_start":                 true,
	"charge_stop":                  true,
	"set_charge_limit":             true,
	"open_charge_port":             true,
	"close_charge_port":            true,
	"charge_port_open":             true,
	"charge_port_close":            true,
	"charge_max_range":             true,
	"charge_standard":              true,
	"set_charging_amps":            true,
	"actuate_frunk":                true,
	"actuate_trunk":                true,
	"frunk":                        true,
	"frunk_open":                   true,
	"trunk_open":                   true,
	"set_sentry_mode":              true,
	"sentry_on":                    true,
	"sentry_off":                   true,
	"speed_limit_on":               true,
	"speed_limit_off":              true,
	"vent_windows":                 true,
	"close_windows":                true,
	"remote_start_drive":           true,
	"set_scheduled_departure":      true,
	"set_scheduled_charging":       true,
	"add_charge_schedule":          true,
	"remove_charge_schedule":       true,
	"add_precondition_schedule":    true,
	"remove_precondition_schedule": true,
	"boombox_fart":                 true,
	"boombox_ping":                 true,
	"remote_boombox":               true,
	"bioweapon_on":                 true,
	"bioweapon_off":                true,
	"cop_on":                       true,
	"cop_fan_only":                 true,
	"cop_off":                      true,
	"set_cop_temp":                 true,
	"climate_keeper_off":           true,
	"climate_keeper_on":            true,
	"dog_mode":                     true,
	"camp_mode":                    true,
	"preconditioning_max":          true,
	"preconditioning_reset":        true,
	"seat_heater":                  true,
	"seat_cooler":                  true,
	"auto_seat_climate":            true,
	"steering_wheel_heat":          true,
	"steering_wheel_level":         true,
	"auto_steering_heat":           true,
	"guest_mode_on":                true,
	"guest_mode_off":               true,
	"erase_user_data":              true,
	"valet_on":                     true,
	"valet_off":                    true,
	"set_valet_mode":               true,
	"reset_valet_pin":              true,
	"set_pin_to_drive":             true,
	"reset_pin_to_drive_pin":       true,
	"clear_pin_to_drive_admin":     true,
	"trigger_homelink":             true,
	"media_toggle_playback":        true,
	"media_next_track":             true,
	"media_prev_track":             true,
	"media_next_fav":               true,
	"media_prev_fav":               true,
	"media_volume_down":            true,
	"adjust_volume":                true,
	"navigation_request":           true,
	"navigation_gps_request":       true,
	"navigation_sc_request":        true,
	"schedule_software_update":     true,
	"cancel_software_update":       true,
	"speed_limit_set_limit":        true,
	"speed_limit_clear_pin":        true,
	"speed_limit_clear_pin_admin":  true,
	"sunroof_vent":                 true,
	"sunroof_close":                true,
	"sunroof_stop":                 true,
	"set_vehicle_name":             true,
}

func (h *CommandHandler) SendCommand(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		httpx.WriteError(w, http.StatusConflict, "Tesla API calls are suspended")
		return
	}

	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	var body struct {
		Command string                 `json:"command"`
		Params  map[string]interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Command == "" {
		httpx.WriteError(w, http.StatusBadRequest, "command is required")
		return
	}

	if !allowedCommands[body.Command] {
		httpx.WriteError(w, http.StatusBadRequest, "unknown command: "+body.Command)
		return
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

	paramsJSON, _ := json.Marshal(body.Params)
	fsm := cmdFSM.NewExecutionFSM(0, vehicleID, body.Command)

	if h.redisCache != nil {
		if shift, err := h.redisCache.GetSignal(r.Context(), vehicleID, "ShiftState"); err == nil && shift != nil {
			fsm.MarkVehicleAwake()
		}
	} else {
		// Without Redis freshness, leave wake handling to the Tesla client.
		fsm.MarkVehicleAwake()
	}

	cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, body.Command, body.Params)

	// Propagate Tesla third-party token expiry as a distinct error code so the
	// frontend can surface the reauth banner and
	// queue the failed mutation for replay after reconnect. Logged + counted
	// as a normal command failure so the metrics path stays consistent.
	if cmdErr != nil && errors.Is(cmdErr, tesla.ErrUnauthorized) {
		fsm.MarkFailed(&cmdFSM.CommandError{
			StatusCode: http.StatusUnauthorized,
			Message:    cmdErr.Error(),
			Category:   "auth",
		})
		cl := &vehiclemodel.CommandLog{
			VehicleID: vehicleID,
			Command:   body.Command,
			Params:    string(paramsJSON),
			Status:    "failed",
			Error:     cmdErr.Error(),
		}
		if logErr := h.commandRepo.Create(r.Context(), cl); logErr != nil {
			log.Error().Err(logErr).Msg("failed to log command")
		}
		log.Warn().Int64("vehicle_id", vehicleID).Str("command", body.Command).
			Msg("Tesla command rejected: third-party token expired")
		httpx.WriteTeslaTokenExpired(w)
		return
	}

	// Fleet API daily budget errors are a distinct, structured failure mode:
	// they cannot succeed by retrying the same request (ErrBudgetExceeded
	// cannot clear until the next UTC reset) or indicate the budget evidence
	// store itself is unreachable (ErrBudgetUnavailable). Surface both as
	// their real HTTP status instead of falling through to the generic
	// network/500 classification below, matching WriteTeslaTokenExpired's
	// precedent for distinguishing Tesla sentinel errors.
	if cmdErr != nil {
		if failure, matched := httpx.ClassifyTeslaBudgetError(cmdErr); matched {
			fsm.MarkFailed(&cmdFSM.CommandError{
				StatusCode: failure.StatusCode,
				Message:    failure.Message,
				Category:   failure.Category,
			})
			cl := &vehiclemodel.CommandLog{
				VehicleID: vehicleID,
				Command:   body.Command,
				Params:    string(paramsJSON),
				Status:    "failed",
				Error:     cmdErr.Error(),
			}
			if logErr := h.commandRepo.Create(r.Context(), cl); logErr != nil {
				log.Error().Err(logErr).Msg("failed to log command")
			}
			log.Warn().Err(cmdErr).Int64("vehicle_id", vehicleID).Str("command", body.Command).
				Str("category", failure.Category).Msg("Tesla command rejected: Fleet API budget constraint")
			httpx.WriteError(w, failure.StatusCode, failure.Message)
			return
		}
	}

	if cmdErr != nil {
		category := "network"
		fsm.MarkFailed(&cmdFSM.CommandError{
			StatusCode: 500,
			Message:    cmdErr.Error(),
			Category:   category,
		})
	} else {
		fsm.MarkSucceeded()
	}

	status := "success"
	errMsg := ""
	if cmdErr != nil {
		status = "failed"
		errMsg = cmdErr.Error()
	}

	log.Info().Str("command", body.Command).Int64("vehicle_id", vehicleID).
		Str("fsm_state", string(fsm.State())).Str("status_msg", fsm.StatusMessage()).
		Msg("command executed via FSM")

	cl := &vehiclemodel.CommandLog{
		VehicleID: vehicleID,
		Command:   body.Command,
		Params:    string(paramsJSON),
		Status:    status,
		Error:     errMsg,
	}
	if logErr := h.commandRepo.Create(r.Context(), cl); logErr != nil {
		log.Error().Err(logErr).Msg("failed to log command")
	}

	if cmdErr != nil {
		log.Error().Err(cmdErr).Str("command", body.Command).Int64("vehicleID", vehicleID).Msg("command failed")
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   errMsg,
		})
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"result":  status,
	})
}

// LatestCommands returns the most recent command per command name for a vehicle.
func (h *CommandHandler) LatestCommands(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	items, err := h.commandRepo.GetLatestByVehicle(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest commands")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch command history")
		return
	}
	if items == nil {
		items = []*vehiclemodel.CommandLog{}
	}
	httpx.WriteJSON(w, http.StatusOK, items)
}

// CommandHistory returns recent command logs for a vehicle.
func (h *CommandHandler) CommandHistory(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	items, err := h.commandRepo.GetHistoryByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get command history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch command history")
		return
	}
	if items == nil {
		items = []*vehiclemodel.CommandLog{}
	}
	httpx.WriteJSON(w, http.StatusOK, items)
}
