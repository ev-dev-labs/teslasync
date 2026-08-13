package energyflow

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// EnergyFlowHandler returns the real-time per-vehicle energy flow snapshot
// (charging power, pack voltage / current, energy remaining, charge state)
// derived from the signal-log change feed via signal.StateReader
// (ADR-002).
//
// The legacy *signaldb.SignalLogReader.SnapshotAt
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
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var dcPower, acPower, energyRemaining, packVoltage, packCurrent, soc *float64
	var chargeState *string

	snap, err := h.live.LiveState(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to read energy flow state")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read energy flow state")
		return
	}

	if v, ok := signal.Float64(snap["DCChargingPower"]); ok {
		// Preserve this endpoint's established kW response contract while
		// live signal state remains canonical W.
		kw := v / 1000.0
		dcPower = &kw
	}
	if v, ok := signal.Float64(snap["ACChargingPower"]); ok {
		kw := v / 1000.0
		acPower = &kw
	}
	if v, ok := signal.Float64(snap["EnergyRemaining"]); ok {
		energyRemaining = &v
	}
	if v, ok := signal.Float64(snap["PackVoltage"]); ok {
		packVoltage = &v
	}
	if v, ok := signal.Float64(snap["PackCurrent"]); ok {
		packCurrent = &v
	}
	if v, ok := signal.Float64(snap["BatteryLevel"]); ok {
		soc = &v
	}
	if s, ok := snap["ChargeState"].(string); ok {
		chargeState = &s
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"dc_charging_power": dcPower,
		"ac_charging_power": acPower,
		"energy_remaining":  energyRemaining,
		"pack_voltage":      packVoltage,
		"pack_current":      packCurrent,
		"soc":               soc,
		"charge_state":      chargeState,
	})
}
