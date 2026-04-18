package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	cmdFSM "github.com/ev-dev-labs/teslasync/internal/fsm/command"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// CommandHandler handles vehicle command HTTP requests.
type CommandHandler struct {
	vehicleRepo  *database.VehicleRepo
	commandRepo  *database.CommandLogRepo
	settingsRepo *database.SettingsRepo
	teslaClient  *tesla.Client
}

func NewCommandHandler(db *database.DB, tc *tesla.Client) *CommandHandler {
	return &CommandHandler{
		vehicleRepo:  database.NewVehicleRepo(db),
		commandRepo:  database.NewCommandLogRepo(db),
		settingsRepo: database.NewSettingsRepo(db),
		teslaClient:  tc,
	}
}

// allowedCommands is the whitelist of Tesla commands that can be sent via the API.
// Names must match the frontend command names and the `commands` map in tesla/client.go.
var allowedCommands = map[string]bool{
	"wake_up":                 true,
	"lock":                    true,
	"unlock":                  true,
	"honk_horn":               true,
	"flash_lights":            true,
	"climate_on":              true,
	"climate_off":             true,
	"set_temps":               true,
	"charge_start":            true,
	"charge_stop":             true,
	"set_charge_limit":        true,
	"open_charge_port":        true,
	"close_charge_port":       true,
	"charge_max_range":        true,
	"charge_standard":         true,
	"set_charging_amps":       true,
	"actuate_frunk":           true,
	"actuate_trunk":           true,
	"set_sentry_mode":         true,
	"vent_windows":            true,
	"close_windows":           true,
	"remote_start_drive":      true,
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
	"guest_mode_on":                true,
	"guest_mode_off":               true,
	"erase_user_data":              true,
	"trigger_homelink":             true,
}

func (h *CommandHandler) SendCommand(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
		writeError(w, http.StatusConflict, "Tesla API calls are suspended")
		return
	}
	// Check if commands endpoint is enabled in polling config
	if pc, err := h.settingsRepo.GetPollingConfig(r.Context()); err == nil && !pc.Commands {
		writeAppError(w, r, ErrTeslaEndpointDisabled.WithMessage("vehicle commands endpoint is disabled in polling config"))
		return
	}

	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	var body struct {
		Command string            `json:"command"`
		Params  map[string]string `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Command == "" {
		writeError(w, http.StatusBadRequest, "command is required")
		return
	}

	if !allowedCommands[body.Command] {
		writeError(w, http.StatusBadRequest, "unknown command: "+body.Command)
		return
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

	// Marshal params for logging
	paramsJSON, _ := json.Marshal(body.Params)

	// Track command lifecycle via FSM
	fsm := cmdFSM.NewExecutionFSM(0, vehicleID, body.Command)

	// Check if vehicle is awake (state from DB)
	if vehicle.State == "asleep" || vehicle.State == "offline" {
		fsm.MarkVehicleAsleep()
		// Tesla client handles wake internally, but we track the lifecycle
		fsm.MarkWakeConfirmed()
		fsm.StartSending()
	} else {
		fsm.MarkVehicleAwake()
	}

	// Execute command via Tesla API
	cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, body.Command, body.Params)

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

	// Log the command
	cl := &models.CommandLog{
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
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   errMsg,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"result":  status,
	})
}
