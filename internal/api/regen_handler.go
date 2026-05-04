package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
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

	// Look up vehicle-specific battery capacity
	capacityKWh, capacitySource := lookupVehicleCapacity(ctx, h.db, vehicleID)

	// Per-drive regen stats (last 90 days). Phase-42 SI canonical drives
	// schema (migration 000172): distance_m, duration_s, avg_speed_mps,
	// avg_power_w, start_soc_pct, end_soc_pct, started_at. JSON shape kept
	// (now-SI-suffixed names: duration_s, avg_speed_mps, avg_power_w,
	// start_soc_pct, end_soc_pct) — frontend already mismatched these field
	// names against the legacy backend tags so the rename is forward-compatible.
	type driveRegen struct {
		ID              int64     `json:"id"`
		StartDate       time.Time `json:"start_date"`
		Distance        float64   `json:"distance"`
		DurationS       float64   `json:"duration_s"`
		SpeedAvgMps     *float64  `json:"avg_speed_mps"`
		PowerMaxW       *float64  `json:"avg_power_w"`
		PowerMinW       *float64  `json:"min_power_w"`
		StartSocPct     *float64  `json:"start_soc_pct"`
		EndSocPct       *float64  `json:"end_soc_pct"`
		Efficiency      float64   `json:"efficiency"`
		RegenScore      float64   `json:"regen_score"`
	}

	driveRows, err := h.db.Pool.Query(ctx, `
		SELECT id, started_at, distance_m, duration_s, avg_speed_mps,
			avg_power_w, NULL::float8,
			start_soc_pct::float8, end_soc_pct::float8,
			CASE WHEN distance_m > 0
			     THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
			     ELSE 0 END as efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3
			AND started_at > NOW() - interval '90 days'
		ORDER BY started_at DESC`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get regen drive data")
		writeError(w, http.StatusInternalServerError, "failed to get regen data")
		return
	}
	defer driveRows.Close()

	var drives []driveRegen
	for driveRows.Next() {
		var d driveRegen
		var distM *float64
		var durS *int64
		if err := driveRows.Scan(&d.ID, &d.StartDate, &distM, &durS, &d.SpeedAvgMps,
			&d.PowerMaxW, &d.PowerMinW, &d.StartSocPct, &d.EndSocPct, &d.Efficiency); err != nil {
			log.Error().Err(err).Msg("failed to scan regen drive row")
			continue
		}
		// Distance reported in miles (legacy "distance" field semantics preserved).
		if distM != nil {
			d.Distance = *distM / driveStatsMetersPerMile
		}
		if durS != nil {
			d.DurationS = float64(*durS)
		}
		// Regen score: based on regen power (W) relative to speed (m/s).
		if d.PowerMinW != nil {
			regenW := math.Abs(*d.PowerMinW)
			speedFactor := 1.0
			if d.SpeedAvgMps != nil && *d.SpeedAvgMps > 0 {
				// Preserves the legacy ratio shape (kW / mph * 10).
				speedFactor = (regenW / driveStatsKilo) / (*d.SpeedAvgMps / driveStatsMpsPerMph) * 10
			}
			d.RegenScore = math.Min(math.Round(speedFactor*10)/10, 100)
		}
		drives = append(drives, d)
	}
	if drives == nil {
		drives = []driveRegen{}
	}

	// Monthly regen summary (last 12 months). avg_power_w averaged in W
	// then converted to kW in Go to keep the response key
	// avg_regen_power_kw stable for the frontend.
	type monthlySummary struct {
		Month         string  `json:"month"`
		DriveCount    int     `json:"drive_count"`
		AvgRegenPower float64 `json:"avg_regen_power_kw"`
		AvgSpeed      float64 `json:"avg_speed"`
		AvgEfficiency float64 `json:"avg_efficiency"`
	}

	monthRows, err := h.db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', started_at) as month,
			COUNT(*) as drive_count,
			AVG(ABS(COALESCE(avg_power_w, 0))) as avg_regen_power_w,
			AVG(avg_speed_mps) as avg_speed_mps,
			AVG(CASE WHEN distance_m > 0
			         THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
			         ELSE 0 END) as avg_efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3
			AND started_at > NOW() - interval '12 months'
		GROUP BY month ORDER BY month`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
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
		var avgPowerW, avgSpeedMps, avgEff *float64
		if err := monthRows.Scan(&monthTime, &m.DriveCount, &avgPowerW, &avgSpeedMps, &avgEff); err != nil {
			log.Error().Err(err).Msg("failed to scan monthly regen row")
			continue
		}
		m.Month = monthTime.Format("2006-01")
		// Convert SI -> legacy display units at the response boundary.
		if avgPowerW != nil {
			m.AvgRegenPower = math.Round((*avgPowerW/driveStatsKilo)*10) / 10
		}
		if avgSpeedMps != nil {
			m.AvgSpeed = math.Round((*avgSpeedMps/driveStatsMpsPerMph)*10) / 10
		}
		if avgEff != nil {
			m.AvgEfficiency = math.Round(*avgEff*10) / 10
		}
		monthly = append(monthly, m)
	}
	if monthly == nil {
		monthly = []monthlySummary{}
	}

	// Lifetime regen/drive energy — not available in current schema, use
	// aggregated cagg_fleet_stats regen totals when available.
	var totalRegenKWh, totalDriveKWh float64
	if err := h.db.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(total_regen_kwh), 0),
			COALESCE(SUM(total_energy_kwh), 0)
		FROM cagg_fleet_stats
		WHERE vehicle_id = $1`, vehicleID).Scan(&totalRegenKWh, &totalDriveKWh); err != nil && err != pgx.ErrNoRows {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("regen: cagg_fleet_stats query failed")
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

	// Free charges equivalent (based on vehicle-specific estimated capacity)
	freeCharges := 0.0
	if totalRegenKWh > 0 && capacityKWh > 0 {
		freeCharges = math.Round(totalRegenKWh/capacityKWh*10) / 10
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
		// Capacity estimate metadata
		"battery_capacity_kwh": capacityKWh,
		"capacity_source":      capacitySource,
	})
}
