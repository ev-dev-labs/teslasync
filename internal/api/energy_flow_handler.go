package api

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// EnergyFlowHandler returns real-time energy flow data from charging telemetry.
type EnergyFlowHandler struct {
	db *database.DB
}

func NewEnergyFlowHandler(db *database.DB) *EnergyFlowHandler {
	return &EnergyFlowHandler{db: db}
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

	_ = h.db.Pool.QueryRow(ctx, `
		SELECT
			dc_charging_power,
			(signals->>'ac_charging_power')::double precision,
			(signals->>'energy_remaining')::double precision,
			(signals->>'pack_voltage')::double precision,
			(signals->>'pack_current')::double precision,
			battery_level,
			charge_state
		FROM charging_telemetry
		WHERE vehicle_id = $1
		ORDER BY created_at DESC
		LIMIT 1`, vehicleID).Scan(
		&dcPower, &acPower, &energyRemaining,
		&packVoltage, &packCurrent, &soc, &chargeState,
	)

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
