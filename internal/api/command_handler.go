package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
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
	"actuate_frunk":           true,
	"actuate_trunk":           true,
	"set_sentry_mode":         true,
	"vent_windows":            true,
	"close_windows":           true,
	"remote_start_drive":      true,
	"set_scheduled_departure": true,
	"set_scheduled_charging":  true,
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

	// Execute command via Tesla API
	cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, body.Command, body.Params)

	status := "success"
	errMsg := ""
	if cmdErr != nil {
		status = "failed"
		errMsg = cmdErr.Error()
	}

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
