package api

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// EnergyFlowHandler returns the real-time per-vehicle energy flow snapshot
// (charging power, pack voltage / current, energy remaining, charge state)
// derived from the signal-log change feed via signal.StateReader
// (ADR-002 / phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader.SnapshotAt
// helper has been replaced with the canonical signal.StateReader. The
// /vehicles/{vehicleID}/energy/flow endpoint is a "current values" view —
// it always renders forward-folded state at time.Now() — so it maps
// 1:1 onto StateReader.State. The legacy raw-snapshot path returned a
// flat map[string]any; State returns the same forward-folded shape with
// stronger semantics ("value as of `at`" per ADR-002), so the projection
// loop below is unchanged apart from being typed against signal.State.
type EnergyFlowHandler struct {
	db    *database.DB
	state signal.StateReader
	live  signal.LiveStateReader
}

func NewEnergyFlowHandler(db *database.DB, state signal.StateReader, live signal.LiveStateReader) *EnergyFlowHandler {
	return &EnergyFlowHandler{db: db, state: state, live: live}
}

func (h *EnergyFlowHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var dcPower, acPower, energyRemaining, packVoltage, packCurrent, soc *float64
	var chargeState *string

	snap, err := h.live.LiveState(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to read energy flow state")
		writeError(w, http.StatusInternalServerError, "failed to read energy flow state")
		return
	}

	if v, ok := toFloatOk(snap["DCChargingPower"]); ok {
		dcPower = &v
	}
	if v, ok := toFloatOk(snap["ACChargingPower"]); ok {
		acPower = &v
	}
	if v, ok := toFloatOk(snap["EnergyRemaining"]); ok {
		energyRemaining = &v
	}
	if v, ok := toFloatOk(snap["PackVoltage"]); ok {
		packVoltage = &v
	}
	if v, ok := toFloatOk(snap["PackCurrent"]); ok {
		packCurrent = &v
	}
	if v, ok := toFloatOk(snap["BatteryLevel"]); ok {
		soc = &v
	}
	if s, ok := snap["ChargeState"].(string); ok {
		chargeState = &s
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dc_charging_power": dcPower,
		"ac_charging_power": acPower,
		"energy_remaining":  energyRemaining,
		"pack_voltage":      packVoltage,
		"pack_current":      packCurrent,
		"soc":               soc,
		"charge_state":      chargeState,
	})
}

// urlParamVehicleID extracts vehicleID from chi URL param. Retained here
// (rather than collocated with EnergyFlowHandler usage) because
// battery_cells_handler.go also depends on this helper.
func urlParamVehicleID(r *http.Request) string {
	return chi.URLParam(r, "vehicleID")
}
