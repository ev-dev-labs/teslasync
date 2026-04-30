package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Default assumptions for trip planning.
const (
	defaultBatteryCapacityKWh = 75.0
	defaultEfficiencyWhKm     = 160.0 // Wh/km for a Model 3/Y at moderate speeds
	drivingDistanceFactor     = 1.30  // straight-line → driving distance multiplier
	defaultElectricityCost    = 0.12  // $/kWh
	superchargerCostPerKWh    = 0.35  // $/kWh at Supercharger
	minStopSOCThreshold       = 15.0  // SOC% at which we must stop
	chargerPowerKW            = 250.0 // typical V3 Supercharger peak power
)

// TripPlannerHandler provides trip planning with range estimation and charging stop optimization.
type TripPlannerHandler struct {
	db              *database.DB
	cache           *cache.Store
	signalLogReader *database.SignalLogReader
}

// NewTripPlannerHandler creates a new TripPlannerHandler.
func NewTripPlannerHandler(db *database.DB, cache *cache.Store, slr *database.SignalLogReader) *TripPlannerHandler {
	return &TripPlannerHandler{db: db, cache: cache, signalLogReader: slr}
}

// ── Handlers ────────────────────────────────────────────────────────────

// Plan handles POST /trip-planner/plan
func (h *TripPlannerHandler) Plan(w http.ResponseWriter, r *http.Request) {
	var req tripPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.VehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	if req.Origin.Lat == 0 && req.Origin.Lng == 0 {
		writeError(w, http.StatusBadRequest, "origin is required")
		return
	}
	if req.Destination.Lat == 0 && req.Destination.Lng == 0 {
		writeError(w, http.StatusBadRequest, "destination is required")
		return
	}

	// Apply defaults
	if req.CurrentSOC <= 0 {
		req.CurrentSOC = 80
	}
	if req.ChargeLimitSOC <= 0 {
		req.ChargeLimitSOC = 90
	}
	if req.MinArrivalSOC <= 0 {
		req.MinArrivalSOC = 20
	}
	if req.Preferences.SpeedFactor <= 0 {
		req.Preferences.SpeedFactor = 1.0
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	plan, err := h.computePlan(ctx, &req)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("trip plan computation failed")
		writeError(w, http.StatusInternalServerError, "failed to compute trip plan")
		return
	}

	writeJSON(w, http.StatusOK, plan)
}
