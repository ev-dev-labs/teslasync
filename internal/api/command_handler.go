package api

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/models"
	"github.com/teslasync/teslasync/internal/tesla"
)

// CommandHandler handles vehicle command HTTP requests.
type CommandHandler struct {
	vehicleRepo  *database.VehicleRepo
	commandRepo  *database.CommandLogRepo
	teslaClient  *tesla.Client
}

func NewCommandHandler(db *database.DB, tc *tesla.Client) *CommandHandler {
	return &CommandHandler{
		vehicleRepo: database.NewVehicleRepo(db),
		commandRepo: database.NewCommandLogRepo(db),
		teslaClient: tc,
	}
}

func (h *CommandHandler) SendCommand(w http.ResponseWriter, r *http.Request) {
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
	cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VehicleID, body.Command, body.Params)

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
