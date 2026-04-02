package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// RegenHandler handles regenerative braking analytics HTTP requests.
type RegenHandler struct {
	db *database.DB
}

func NewRegenHandler(db *database.DB) *RegenHandler {
	return &RegenHandler{db: db}
}

func (h *RegenHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Per-drive regen stats (last 90 days)
	type driveRegen struct {
		ID               int64      `json:"id"`
		StartDate        time.Time  `json:"start_date"`
		Distance         float64    `json:"distance"`
		DurationMin      float64    `json:"duration_min"`
		SpeedAvg         *float64   `json:"speed_avg"`
		PowerMax         *float64   `json:"power_max"`
		PowerMin         *float64   `json:"power_min"`
		StartBatteryLvl  *int       `json:"start_battery_level"`
		EndBatteryLvl    *int       `json:"end_battery_level"`
		Efficiency       float64    `json:"efficiency"`
		RegenScore       float64    `json:"regen_score"`
	}

	driveRows, err := h.db.Pool.Query(ctx, `
		SELECT id, start_date, distance, duration_min, speed_avg,
			power_max, power_min,
			start_battery_level, end_battery_level,
			CASE WHEN distance > 0 THEN (start_battery_level - end_battery_level)::float / distance * 100 ELSE 0 END as efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance > 2 AND power_min IS NOT NULL
			AND start_date > NOW() - interval '90 days'
		ORDER BY start_date DESC`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get regen drive data")
		writeError(w, http.StatusInternalServerError, "failed to get regen data")
		return
	}
	defer driveRows.Close()

	var drives []driveRegen
	for driveRows.Next() {
		var d driveRegen
		if err := driveRows.Scan(&d.ID, &d.StartDate, &d.Distance, &d.DurationMin, &d.SpeedAvg,
			&d.PowerMax, &d.PowerMin, &d.StartBatteryLvl, &d.EndBatteryLvl, &d.Efficiency); err != nil {
			log.Error().Err(err).Msg("failed to scan regen drive row")
			continue
		}
		// Regen score: magnitude of power_min relative to speed (higher regen at lower speed = better)
		if d.PowerMin != nil {
			regenKW := math.Abs(*d.PowerMin)
			speedFactor := 1.0
			if d.SpeedAvg != nil && *d.SpeedAvg > 0 {
				speedFactor = regenKW / *d.SpeedAvg * 10
			}
			d.RegenScore = math.Min(math.Round(speedFactor*10)/10, 100)
		}
		drives = append(drives, d)
	}
	if drives == nil {
		drives = []driveRegen{}
	}

	// Monthly regen summary (last 12 months)
	type monthlySummary struct {
		Month         string  `json:"month"`
		DriveCount    int     `json:"drive_count"`
		AvgRegenPower float64 `json:"avg_regen_power_kw"`
		AvgSpeed      float64 `json:"avg_speed"`
		AvgEfficiency float64 `json:"avg_efficiency"`
	}

	monthRows, err := h.db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', start_date) as month,
			COUNT(*) as drive_count,
			AVG(ABS(COALESCE(power_min, 0))) as avg_regen_power_kw,
			AVG(speed_avg) as avg_speed,
			AVG(CASE WHEN distance > 0 THEN (start_battery_level - end_battery_level)::float / distance * 100 ELSE 0 END) as avg_efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance > 2
			AND start_date > NOW() - interval '12 months'
		GROUP BY month ORDER BY month`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get monthly regen data")
		writeError(w, http.StatusInternalServerError, "failed to get regen data")
		return
	}
	defer monthRows.Close()

	var monthly []monthlySummary
	for monthRows.Next() {
		var m monthlySummary
		var monthTime time.Time
		var avgSpeed, avgEff *float64
		if err := monthRows.Scan(&monthTime, &m.DriveCount, &m.AvgRegenPower, &avgSpeed, &avgEff); err != nil {
			log.Error().Err(err).Msg("failed to scan monthly regen row")
			continue
		}
		m.Month = monthTime.Format("2006-01")
		if avgSpeed != nil {
			m.AvgSpeed = math.Round(*avgSpeed*10) / 10
		}
		if avgEff != nil {
			m.AvgEfficiency = math.Round(*avgEff*10) / 10
		}
		m.AvgRegenPower = math.Round(m.AvgRegenPower*10) / 10
		monthly = append(monthly, m)
	}
	if monthly == nil {
		monthly = []monthlySummary{}
	}

	// Lifetime energy stats from motor snapshots
	var totalRegenKWh, totalDriveKWh float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(MAX(lifetime_energy_gained_regen) - MIN(lifetime_energy_gained_regen), 0),
			COALESCE(MAX(lifetime_energy_used_drive) - MIN(lifetime_energy_used_drive), 0)
		FROM motor_snapshots
		WHERE vehicle_id = $1 AND lifetime_energy_gained_regen IS NOT NULL`, vehicleID).Scan(&totalRegenKWh, &totalDriveKWh)
	if err != nil {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get lifetime energy stats")
		// Non-fatal; continue with zeros
	}

	regenRatio := 0.0
	if totalDriveKWh > 0 {
		regenRatio = totalRegenKWh / totalDriveKWh * 100
	}

	// Monthly average regen power
	var monthlyAvgRegen float64
	if len(monthly) > 0 {
		sum := 0.0
		for _, m := range monthly {
			sum += m.AvgRegenPower
		}
		monthlyAvgRegen = math.Round(sum/float64(len(monthly))*10) / 10
	}

	// Free charges equivalent (assuming ~60 kWh per full charge)
	freeCharges := 0.0
	if totalRegenKWh > 0 {
		freeCharges = math.Round(totalRegenKWh/60*10) / 10
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":          vehicleID,
		"total_regen_kwh":     math.Round(totalRegenKWh*100) / 100,
		"total_drive_kwh":     math.Round(totalDriveKWh*100) / 100,
		"regen_ratio":         math.Round(regenRatio*10) / 10,
		"monthly_avg_regen":   monthlyAvgRegen,
		"free_charges":        freeCharges,
		"monthly_summary":     monthly,
		"drives":              drives,
	})
}
