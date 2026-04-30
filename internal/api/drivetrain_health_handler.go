package api

import (
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// DrivetrainHealthHandler serves drivetrain health analytics.
type DrivetrainHealthHandler struct {
	db              *database.DB
	signalLogReader *database.SignalLogReader
}

func NewDrivetrainHealthHandler(db *database.DB, slr *database.SignalLogReader) *DrivetrainHealthHandler {
	return &DrivetrainHealthHandler{db: db, signalLogReader: slr}
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

	// Get latest battery module temps and battery temp from signal_log
	var moduleTempMax, moduleTempMin *float64
	var batteryTemp *float64
	if h.signalLogReader != nil {
		now := time.Now()
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "ModuleTempMax", now); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok {
				moduleTempMax = &v
			}
		}
		if val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "ModuleTempMin", now); err == nil && val != nil {
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

	// Get peak motor power from recent drives as a proxy for motor health
	var powerMax *float64
	var recentDrives int
	err = h.db.Pool.QueryRow(ctx, `
		SELECT MAX(avg_power_kw), COUNT(*)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL
		  AND start_ts > NOW() - interval '30 days'`, vehicleID,
	).Scan(&powerMax, &recentDrives)
	if err != nil {
		log.Debug().Err(err).Int64("vehicleID", vehicleID).Msg("drivetrain: no drive power data")
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
