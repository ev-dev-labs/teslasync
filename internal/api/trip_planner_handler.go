package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
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

// TripPlannerHandler provides trip planning with range estimation and
// charging stop optimization.
//
// Phase-39 migration (ADR-002 / phase-39): all signal_log reads — current
// SOC (BatteryLevel) and current Location at the request boundary, plus
// EnergyRemaining and BatteryLevel inside batteryCapacity — now resolve
// through the canonical signal.StateReader instead of the legacy
// *database.SignalLogReader. Each lookup maps 1:1 onto StateReader.SignalAt
// with identical semantics (forward-folded read at time.Now()).
//
// As part of this migration, transport errors from state.SignalAt at the
// request boundary now propagate to the caller as a 500 instead of being
// silently swallowed behind hardcoded defaults (CurrentSOC = 80, "origin
// is required" 400). The legacy silent-default behavior was indistinguishable
// on the frontend from "client really wants the default 80% / really forgot
// to pass an origin" and would route every plan from the wrong starting
// SOC / wrong origin during a signal-store outage.
//
// The "signal value never emitted" case (StateReader returns (nil, nil))
// is still handled by falling through to the existing default / 400
// fallbacks, matching the legacy "missing data" UX.
type TripPlannerHandler struct {
	db    *database.DB
	cache *cache.Store
	state signal.StateReader
}

// NewTripPlannerHandler creates a new TripPlannerHandler.
func NewTripPlannerHandler(db *database.DB, cache *cache.Store, state signal.StateReader) *TripPlannerHandler {
	return &TripPlannerHandler{db: db, cache: cache, state: state}
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

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// Seed CurrentSOC from canonical StateReader when not provided.
	// BatteryLevel as of now is a forward-folded read that maps 1:1 onto
	// StateReader.SignalAt with identical semantics. Transport errors
	// propagate as 500 (legacy silently fell through to the hardcoded
	// 80% default below, which masked signal-store outages behind
	// plausible-but-wrong plans).
	if req.CurrentSOC <= 0 && h.state != nil {
		val, err := h.state.SignalAt(ctx, req.VehicleID, "BatteryLevel", time.Now())
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Str("signal", "BatteryLevel").Msg("trip planner: failed to read current SOC")
			writeError(w, http.StatusInternalServerError, "failed to read current battery state")
			return
		}
		if soc, ok := toFloatOk(val); ok && soc > 0 {
			req.CurrentSOC = soc
		}
	}

	// Seed Origin from canonical StateReader when not provided. The
	// "Location" signal is a JSONB compound carrying Lat/Lng; SignalAt
	// returns it as the raw decoded map without flattening (per the
	// state_reader_log.go contract: only State performs the Lat/Lng
	// unpack at the State-map level). Transport errors propagate as 500
	// (legacy silently fell through to the "origin is required" 400,
	// which masked signal-store outages behind a misleading client error).
	if req.Origin.Lat == 0 && req.Origin.Lng == 0 && h.state != nil {
		val, err := h.state.SignalAt(ctx, req.VehicleID, "Location", time.Now())
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Str("signal", "Location").Msg("trip planner: failed to read current location")
			writeError(w, http.StatusInternalServerError, "failed to read current location")
			return
		}
		if loc, ok := val.(map[string]any); ok {
			if lat, ok := toFloatOk(loc["Lat"]); ok {
				req.Origin.Lat = lat
			}
			if lng, ok := toFloatOk(loc["Lng"]); ok {
				req.Origin.Lng = lng
			}
		}
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

	plan, err := h.computePlan(ctx, &req)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("trip plan computation failed")
		writeError(w, http.StatusInternalServerError, "failed to compute trip plan")
		return
	}

	writeJSON(w, http.StatusOK, plan)
}
