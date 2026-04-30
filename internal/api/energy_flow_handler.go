package api

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// EnergyFlowHandler returns real-time energy flow data from signal_log.
type EnergyFlowHandler struct {
	db              *database.DB
	signalLogReader *database.SignalLogReader
}

func NewEnergyFlowHandler(db *database.DB, slr *database.SignalLogReader) *EnergyFlowHandler {
	return &EnergyFlowHandler{db: db, signalLogReader: slr}
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

	if h.signalLogReader != nil {
		now := time.Now()
		snap, err := h.signalLogReader.SnapshotAt(ctx, vehicleID, now)
		if err == nil && snap != nil {
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
		}
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

// urlParamVehicleID extracts vehicleID from chi URL param.
func urlParamVehicleID(r *http.Request) string {
	return chi.URLParam(r, "vehicleID")
}
