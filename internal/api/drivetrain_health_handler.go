package api

import (
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DrivetrainHealthHandler serves drivetrain health analytics.
//
// Phase-39 migration: the legacy database.SignalLogReader's per-signal
// helper has been replaced with the canonical signal.StateReader
// (ADR-002 / phase-39). Both per-signal lookups (ModuleTempMax,
// ModuleTempMin) resolve "value as of now" — a forward-folded read at
// time.Now() — so they map 1:1 onto StateReader.SignalAt with identical
// semantics. We retain the per-signal pattern (rather than a single
// StateReader.State call) to preserve the existing behavior where each
// individual signal's absence falls through independently to its zero
// fallback in the derived rear-motor / front-motor / inverter / battery
// temp projections.
//
// As part of this migration, transport errors from state.SignalAt now
// propagate to the caller as a 500 instead of being silently swallowed.
// The legacy silent-swallow returned a payload with zero-valued temps,
// which is indistinguishable on the frontend from "vehicle truly idle /
// brand-new vehicle with no signal_log history" — masking a real
// signal-store / pgx outage behind a "drivetrain looks dead" panel.
type DrivetrainHealthHandler struct {
	db    *database.DB
	state signal.StateReader
}

func NewDrivetrainHealthHandler(db *database.DB, state signal.StateReader) *DrivetrainHealthHandler {
	return &DrivetrainHealthHandler{db: db, state: state}
}

func (h *DrivetrainHealthHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Get latest battery module temps and battery temp from the canonical
	// signal.StateReader. The two reads feed the rear-motor / front-motor /
	// inverter / battery temp projections below.
	var moduleTempMax, moduleTempMin *float64
	var batteryTemp *float64
	if h.state != nil {
		now := time.Now()
		val, err := h.state.SignalAt(ctx, vehicleID, "ModuleTempMax", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "ModuleTempMax").Msg("drivetrain: failed to read signal state")
			writeError(w, http.StatusInternalServerError, "failed to read drivetrain state")
			return
		}
		if val != nil {
			if v, ok := toFloatOk(val); ok {
				moduleTempMax = &v
			}
		}
		val, err = h.state.SignalAt(ctx, vehicleID, "ModuleTempMin", now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "ModuleTempMin").Msg("drivetrain: failed to read signal state")
			writeError(w, http.StatusInternalServerError, "failed to read drivetrain state")
			return
		}
		if val != nil {
			if v, ok := toFloatOk(val); ok {
				moduleTempMin = &v
			}
		}
	}
	if moduleTempMax == nil && moduleTempMin == nil {
		log.Debug().Int64("vehicleID", vehicleID).Msg("drivetrain: no module temp data")
	}

	// Derive battery temp from module temps average
	if moduleTempMax != nil && moduleTempMin != nil {
		avg := (*moduleTempMax + *moduleTempMin) / 2
		batteryTemp = &avg
	} else if moduleTempMax != nil {
		batteryTemp = moduleTempMax
	} else if moduleTempMin != nil {
		batteryTemp = moduleTempMin
	}

	// Get peak motor power from recent drives as a proxy for motor health.
	// Phase-42 SI canonical drives schema (migration 000185): avg_power_w
	// (Watts), started_at, ended_at. powerMaxW is currently unused by the
	// response; kept on the SELECT so the row count and the aggregate share
	// a single round-trip.
	var powerMaxW *float64
	var recentDrives int
	if h.db != nil {
		err = h.db.Pool.QueryRow(ctx, `
		SELECT MAX(avg_power_w), COUNT(*)
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL
		  AND started_at > NOW() - interval '30 days'`, vehicleID,
		).Scan(&powerMaxW, &recentDrives)
		if err != nil {
			log.Debug().Err(err).Int64("vehicleID", vehicleID).Msg("drivetrain: no drive power data")
		}
	}

	// Derive motor temperatures from module temps (Tesla reports battery module temps,
	// not individual motor temps directly; we use these as proxies)
	var frontMotorTemp, rearMotorTemp, inverterTemp, battTempC *float64

	if moduleTempMax != nil {
		v := math.Round(*moduleTempMax*10) / 10
		rearMotorTemp = &v
		// Inverter typically runs ~5-10°C above battery module temp
		inv := math.Round((*moduleTempMax+7)*10) / 10
		inverterTemp = &inv
	}
	if moduleTempMin != nil {
		v := math.Round(*moduleTempMin*10) / 10
		frontMotorTemp = &v
	}
	if batteryTemp != nil {
		v := math.Round(*batteryTemp*10) / 10
		battTempC = &v
	} else if moduleTempMax != nil && moduleTempMin != nil {
		avg := math.Round((*moduleTempMax+*moduleTempMin)/2*10) / 10
		battTempC = &avg
	}

	// Determine overall health based on temps and recent drive activity
	motorStatus := "Normal"
	overallHealth := "good"

	maxTemp := 0.0
	if moduleTempMax != nil {
		maxTemp = *moduleTempMax
	}
	if inverterTemp != nil && *inverterTemp > maxTemp {
		maxTemp = *inverterTemp
	}

	if maxTemp > 80 {
		overallHealth = "critical"
		motorStatus = "Overheating"
	} else if maxTemp > 60 {
		overallHealth = "warning"
		motorStatus = "Warm"
	}

	if recentDrives == 0 && overallHealth == "good" {
		motorStatus = "Idle"
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"front_motor_temp_c": frontMotorTemp,
		"rear_motor_temp_c":  rearMotorTemp,
		"inverter_temp_c":    inverterTemp,
		"battery_temp_c":     battTempC,
		"motor_status":       motorStatus,
		"overall_health":     overallHealth,
	})
}
