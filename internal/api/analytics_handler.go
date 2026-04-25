package api

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AnalyticsHandler handles fleet analytics HTTP requests.
type AnalyticsHandler struct {
	vehicleRepo    *database.VehicleRepo
	driveRepo      *database.DriveRepo
	chargingRepo   *database.ChargingRepo
	positionRepo   *database.PositionRepo
}

func NewAnalyticsHandler(db *database.DB) *AnalyticsHandler {
	return &AnalyticsHandler{
		vehicleRepo:  database.NewVehicleRepo(db),
		driveRepo:    database.NewDriveRepo(db),
		chargingRepo: database.NewChargingRepo(db),
		positionRepo: database.NewPositionRepo(db),
	}
}

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (h *AnalyticsHandler) Fleet(w http.ResponseWriter, r *http.Request) {
	var cutoff time.Time
	if s := r.URL.Query().Get("start"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			cutoff = t
		}
	}
	if cutoff.IsZero() {
		days := 30
		if d := r.URL.Query().Get("days"); d != "" {
			if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 3650 {
				days = parsed
			}
		}
		cutoff = time.Now().UTC().AddDate(0, 0, -days)
	}

	vehicles, err := h.vehicleRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get vehicles for analytics")
		writeError(w, http.StatusInternalServerError, "failed to get analytics")
		return
	}

	// === Per-vehicle stats ===
	type vehicleStats struct {
		ID         int64   `json:"id"`
		Name       string  `json:"name"`
		Drives     int     `json:"drives"`
		Distance   float64 `json:"distance"`
		Energy     float64 `json:"energy"`
		Efficiency float64 `json:"efficiency"`
	}

	var comparisons []vehicleStats
	var fleetDist, fleetEnergy, fleetCost float64
	var fleetDrives, fleetSessions int

	// === Drive deep analytics accumulators ===
	hourCounts := make([]int, 24)        // drives per hour of day
	hourDistance := make([]float64, 24)   // distance per hour of day
	dowCounts := make([]int, 7)          // drives per day of week
	dowDistance := make([]float64, 7)    // distance per DOW
	var allSpeedMax []float64
	var allDriveDurations []float64
	var allDriveDistances []float64
	var allDriveEfficiencies []float64
	var insideTemps []float64
	var outsideTemps []float64
	var tempVsEfficiency []map[string]interface{}      // for scatter: {temp, efficiency}
	var dailyDriveAgg = make(map[string]map[string]interface{}) // date -> {drives, distance, energy}

	// === Charging deep analytics accumulators ===
	chargerTypeMap := make(map[string]int)    // charger type -> count
	var chargePowers []float64
	var chargeDurations []float64
	var chargeEnergies []float64
	var chargeCosts []float64
	var chargeStartBat []int
	hourChargeCounts:= make([]int, 24)          // charges per hour
	hourChargeEnergy := make([]float64, 24)
	var monthlyChargeAgg = make(map[string]map[string]interface{}) // month -> {energy, cost, sessions, avg_power}

	// === Battery health accumulators ===
	type batteryPoint struct {
		Date        string  `json:"date"`
		HealthScore float64 `json:"health_score"`
		CapacityKWh float64 `json:"capacity_kwh"`
		Degradation float64 `json:"degradation_pct"`
		RangeKm     float64 `json:"range_km"`
		CycleCount  int     `json:"cycle_count"`
	}
	var batteryTrend []batteryPoint

	for _, v := range vehicles {
		drives, err := h.driveRepo.GetByVehicle(r.Context(), v.ID, 2000, 0, cutoff, time.Time{})
		if err != nil {
			log.Error().Err(err).Int64("vehicleID", v.ID).Msg("analytics: failed to get drives")
			drives = nil
		}
		sessions, err := h.chargingRepo.GetByVehicle(r.Context(), v.ID, 2000, 0, cutoff, time.Time{})
		if err != nil {
			log.Error().Err(err).Int64("vehicleID", v.ID).Msg("analytics: failed to get charging sessions")
			sessions = nil
		}
		// Battery health trend: derive from signal_log in future update
		// TODO: implement via SignalLogReader.SignalTracePivot for BatteryLevel

		var dist float64
		var driveCount int
		for _, d := range drives {
			if d.StartTs.Before(cutoff) {
				continue
			}
			dist += d.DistanceMi
			driveCount++

			// Hour & DOW
			hour := d.StartTs.Hour()
			hourCounts[hour]++
			hourDistance[hour] += d.DistanceMi
			dow := int(d.StartTs.Weekday())
			dowCounts[dow]++
			dowDistance[dow] += d.DistanceMi

			// Performance metrics
			if d.MaxSpeedMph != nil {
				allSpeedMax = append(allSpeedMax, *d.MaxSpeedMph)
			}
			allDriveDurations = append(allDriveDurations, d.DurationMin)
			allDriveDistances = append(allDriveDistances, d.DistanceMi)

			// Efficiency per drive (Wh/mi from EnergyUsedKwh)
			if d.EnergyUsedKwh != nil && d.DistanceMi > 0 {
				eff := (*d.EnergyUsedKwh * 1000) / d.DistanceMi
				if eff > 0 && eff < 1000 {
					allDriveEfficiencies = append(allDriveEfficiencies, eff)
				}
			}

			// Temperature
			if d.OutsideTempAvgC != nil {
				outsideTemps = append(outsideTemps, *d.OutsideTempAvgC)
			}
			if d.InsideTempAvgC != nil {
				insideTemps = append(insideTemps, *d.InsideTempAvgC)
			}
			// Temp vs efficiency scatter
			if d.OutsideTempAvgC != nil && d.DistanceMi > 1 && d.EnergyUsedKwh != nil {
				eff := (*d.EnergyUsedKwh * 1000) / d.DistanceMi
				if eff > 0 && eff < 1000 {
					tempVsEfficiency = append(tempVsEfficiency, map[string]interface{}{
						"temp":       math.Round(*d.OutsideTempAvgC*10) / 10,
						"efficiency": math.Round(eff*10) / 10,
						"distance":   math.Round(d.DistanceMi*10) / 10,
					})
				}
			}

			// Daily aggregation
			dateKey := d.StartTs.Format("2006-01-02")
			if dailyDriveAgg[dateKey] == nil {
				dailyDriveAgg[dateKey] = map[string]interface{}{"drives": 0, "distance": 0.0}
			}
			dailyDriveAgg[dateKey]["drives"] = dailyDriveAgg[dateKey]["drives"].(int) + 1
			dailyDriveAgg[dateKey]["distance"] = dailyDriveAgg[dateKey]["distance"].(float64) + d.DistanceMi
		}

		var energy, cost float64
		for _, s := range sessions {
			if s.StartTs.Before(cutoff) {
				continue
			}
			if s.EnergyAddedKwh != nil {
				energy += *s.EnergyAddedKwh
			}
			if s.Cost != nil {
				cost += *s.Cost
			}

			// Charger type analytics
			ct := derefS(s.ChargerType)
			if ct == "" {
				ct = "Home/AC"
			}
			chargerTypeMap[ct]++

			// Charge power and duration
			if s.ChargerPowerKwMax != nil {
				chargePowers = append(chargePowers, *s.ChargerPowerKwMax)
			}
			if s.DurationMin != nil {
				chargeDurations = append(chargeDurations, *s.DurationMin)
			}
			if s.EnergyAddedKwh != nil {
				chargeEnergies = append(chargeEnergies, *s.EnergyAddedKwh)
			}
			if s.Cost != nil {
				chargeCosts = append(chargeCosts, *s.Cost)
			}
			if s.StartBatteryPct != nil {
				chargeStartBat = append(chargeStartBat, int(*s.StartBatteryPct))
			}

			// Hour of day
			chHour := s.StartTs.Hour()
			hourChargeCounts[chHour]++
			if s.EnergyAddedKwh != nil {
				hourChargeEnergy[chHour] += *s.EnergyAddedKwh
			}

			// Monthly aggregation
			monthKey := s.StartTs.Format("2006-01")
			if monthlyChargeAgg[monthKey] == nil {
				monthlyChargeAgg[monthKey] = map[string]interface{}{
					"energy": 0.0, "cost": 0.0, "sessions": 0, "power_sum": 0.0,
				}
			}
			if s.EnergyAddedKwh != nil {
				monthlyChargeAgg[monthKey]["energy"] = monthlyChargeAgg[monthKey]["energy"].(float64) + *s.EnergyAddedKwh
			}
			if s.Cost != nil {
				monthlyChargeAgg[monthKey]["cost"] = monthlyChargeAgg[monthKey]["cost"].(float64) + *s.Cost
			}
			monthlyChargeAgg[monthKey]["sessions"] = monthlyChargeAgg[monthKey]["sessions"].(int) + 1
			if s.ChargerPowerKwMax != nil {
				monthlyChargeAgg[monthKey]["power_sum"] = monthlyChargeAgg[monthKey]["power_sum"].(float64) + *s.ChargerPowerKwMax
			}
		}

		effic := 0.0
		if dist > 0 && energy > 0 {
			effic = (energy * 1000) / dist
		}

		comparisons = append(comparisons, vehicleStats{
			ID:         v.ID,
			Name:       v.DisplayName,
			Drives:     driveCount,
			Distance:   dist,
			Energy:     energy,
			Efficiency: effic,
		})

		fleetDist += dist
		fleetEnergy += energy
		fleetCost += cost
		fleetDrives += driveCount
		fleetSessions += len(sessions)

		// Battery trend — TODO: derive from signal_log
		// for _, bs := range batSnaps { ... }
	}

	fleetEffic := 0.0
	if fleetDist > 0 && fleetEnergy > 0 {
		fleetEffic = (fleetEnergy * 1000) / fleetDist
	}

	// Find most efficient vehicle
	var mostEfficient interface{}
	if len(comparisons) > 0 {
		best := comparisons[0]
		for _, c := range comparisons[1:] {
			if c.Efficiency > 0 && (best.Efficiency == 0 || c.Efficiency < best.Efficiency) {
				best = c
			}
		}
		if best.Efficiency > 0 {
			mostEfficient = map[string]interface{}{
				"id":         best.ID,
				"name":       best.Name,
				"efficiency": best.Efficiency,
			}
		}
	}

	if comparisons == nil {
		comparisons = []vehicleStats{}
	}

	// === Build hourly patterns ===
	hourlyDriving := make([]map[string]interface{}, 24)
	for i := 0; i < 24; i++ {
		hourlyDriving[i] = map[string]interface{}{
			"hour":     i,
			"drives":   hourCounts[i],
			"distance": math.Round(hourDistance[i]*10) / 10,
		}
	}
	hourlyCharging := make([]map[string]interface{}, 24)
	for i := 0; i < 24; i++ {
		hourlyCharging[i] = map[string]interface{}{
			"hour":     i,
			"charges":  hourChargeCounts[i],
			"energy":   math.Round(hourChargeEnergy[i]*10) / 10,
		}
	}

	// === Day of week ===
	dayNames := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	dowData := make([]map[string]interface{}, 7)
	for i := 0; i < 7; i++ {
		avgDist := 0.0
		if dowCounts[i] > 0 {
			avgDist = dowDistance[i] / float64(dowCounts[i])
		}
		dowData[i] = map[string]interface{}{
			"day":          dayNames[i],
			"drives":       dowCounts[i],
			"distance":     math.Round(dowDistance[i]*10) / 10,
			"avg_distance": math.Round(avgDist*10) / 10,
		}
	}

	// === Speed distribution (buckets) ===
	speedBuckets := []struct{ Min, Max int; Label string }{
		{0, 30, "0-30"}, {30, 60, "30-60"}, {60, 90, "60-90"},
		{90, 120, "90-120"}, {120, 150, "120-150"}, {150, 999, "150+"},
	}
	speedDistribution := make([]map[string]interface{}, len(speedBuckets))
	for i, b := range speedBuckets {
		cnt := 0
		for _, s := range allSpeedMax {
			if s >= float64(b.Min) && s < float64(b.Max) {
				cnt++
			}
		}
		speedDistribution[i] = map[string]interface{}{
			"range": b.Label,
			"count": cnt,
		}
	}

	// === Charger type breakdown ===
	chargerTypes := make([]map[string]interface{}, 0, len(chargerTypeMap))
	for t, c := range chargerTypeMap {
		chargerTypes = append(chargerTypes, map[string]interface{}{
			"type":  t,
			"count": c,
		})
	}
	sort.Slice(chargerTypes, func(i, j int) bool {
		return chargerTypes[i]["count"].(int) > chargerTypes[j]["count"].(int)
	})

	// === Charger brand breakdown (removed — field no longer in model) ===

	// === Monthly charging trends ===
	monthlyCharge := make([]map[string]interface{}, 0, len(monthlyChargeAgg))
	for m, data := range monthlyChargeAgg {
		sessions := data["sessions"].(int)
		avgPower := 0.0
		if sessions > 0 {
			avgPower = data["power_sum"].(float64) / float64(sessions)
		}
		gasCost := data["energy"].(float64) * 0.14 * 8.5 // Equivalent gas cost
		monthlyCharge = append(monthlyCharge, map[string]interface{}{
			"month":     m,
			"energy":    math.Round(data["energy"].(float64)*100) / 100,
			"cost":      math.Round(data["cost"].(float64)*100) / 100,
			"sessions":  sessions,
			"avg_power": math.Round(avgPower*10) / 10,
			"gas_cost":  math.Round(gasCost*100) / 100,
			"savings":   math.Round((gasCost - data["cost"].(float64))*100) / 100,
		})
	}
	sort.Slice(monthlyCharge, func(i, j int) bool {
		return monthlyCharge[i]["month"].(string) < monthlyCharge[j]["month"].(string)
	})

	// === Daily driving trend ===
	dailyTrend := make([]map[string]interface{}, 0, len(dailyDriveAgg))
	for d, data := range dailyDriveAgg {
		dailyTrend = append(dailyTrend, map[string]interface{}{
			"date":     d,
			"drives":   data["drives"],
			"distance": math.Round(data["distance"].(float64)*10) / 10,
		})
	}
	sort.Slice(dailyTrend, func(i, j int) bool {
		return dailyTrend[i]["date"].(string) < dailyTrend[j]["date"].(string)
	})

	// === Compute statistics ===
	computeStats := func(vals []float64) map[string]interface{} {
		if len(vals) == 0 {
			return map[string]interface{}{"min": 0, "max": 0, "avg": 0, "median": 0, "p95": 0, "count": 0}
		}
		sorted := make([]float64, len(vals))
		copy(sorted, vals)
		sort.Float64s(sorted)
		sum := 0.0
		for _, v := range sorted {
			sum += v
		}
		p95Idx := int(float64(len(sorted)) * 0.95)
		if p95Idx >= len(sorted) {
			p95Idx = len(sorted) - 1
		}
		medIdx := len(sorted) / 2
		return map[string]interface{}{
			"min":    math.Round(sorted[0]*10) / 10,
			"max":    math.Round(sorted[len(sorted)-1]*10) / 10,
			"avg":    math.Round((sum/float64(len(sorted)))*10) / 10,
			"median": math.Round(sorted[medIdx]*10) / 10,
			"p95":    math.Round(sorted[p95Idx]*10) / 10,
			"count":  len(sorted),
		}
	}

	// === Charge start battery distribution ===
	batDistBuckets := []struct{ Min, Max int; Label string }{
		{0, 10, "0-10%"}, {10, 20, "10-20%"}, {20, 30, "20-30%"},
		{30, 40, "30-40%"}, {40, 50, "40-50%"}, {50, 60, "50-60%"},
		{60, 70, "60-70%"}, {70, 80, "70-80%"}, {80, 90, "80-90%"}, {90, 101, "90-100%"},
	}
	chargeBatDist := make([]map[string]interface{}, len(batDistBuckets))
	for i, b := range batDistBuckets {
		cnt := 0
		for _, bat := range chargeStartBat {
			if bat >= b.Min && bat < b.Max {
				cnt++
			}
		}
		chargeBatDist[i] = map[string]interface{}{
			"range": b.Label,
			"count": cnt,
		}
	}

	// === Distance distribution ===
	distBuckets := []struct{ Min, Max float64; Label string }{
		{0, 5, "0-5"}, {5, 15, "5-15"}, {15, 30, "15-30"},
		{30, 50, "30-50"}, {50, 100, "50-100"}, {100, 200, "100-200"}, {200, 99999, "200+"},
	}
	distDistribution := make([]map[string]interface{}, len(distBuckets))
	for i, b := range distBuckets {
		cnt := 0
		for _, d := range allDriveDistances {
			if d >= b.Min && d < b.Max {
				cnt++
			}
		}
		distDistribution[i] = map[string]interface{}{
			"range": b.Label,
			"count": cnt,
		}
	}

	// === Temperature stats ===
	tempStats := map[string]interface{}{
		"inside":  computeStats(insideTemps),
		"outside": computeStats(outsideTemps),
	}

	// Cap scatter data at 200 points
	if len(tempVsEfficiency) > 200 {
		tempVsEfficiency = tempVsEfficiency[:200]
	}

	// Sort battery trend chronologically
	sort.Slice(batteryTrend, func(i, j int) bool {
		return batteryTrend[i].Date < batteryTrend[j].Date
	})

	// === Build total response ===
	writeJSON(w, http.StatusOK, map[string]interface{}{
		// Core fleet stats (existing)
		"period_days":             int(time.Since(cutoff).Hours()/24) + 1,
		"total_vehicles":          len(vehicles),
		"total_distance_km":       math.Round(fleetDist*10) / 10,
		"total_drives":            fleetDrives,
		"total_charging_sessions": fleetSessions,
		"total_energy_kwh":        math.Round(fleetEnergy*100) / 100,
		"total_cost":              math.Round(fleetCost*100) / 100,
		"avg_efficiency_wh_km":    math.Round(fleetEffic*10) / 10,
		"most_efficient_vehicle":  mostEfficient,
		"vehicle_comparison":      comparisons,

		// === NEW: Drive analytics ===
		"drive_analytics": map[string]interface{}{
			"hourly_pattern":       hourlyDriving,
			"day_of_week":          dowData,
			"speed_distribution":   speedDistribution,
			"distance_distribution": distDistribution,
			"speed_stats":          computeStats(allSpeedMax),
			"duration_stats":       computeStats(allDriveDurations),
			"distance_stats":       computeStats(allDriveDistances),
			"efficiency_stats":     computeStats(allDriveEfficiencies),
			"daily_trend":          dailyTrend,
			"temp_vs_efficiency":   tempVsEfficiency,
			"temperature":          tempStats,
		},

		// === NEW: Charging analytics ===
		"charging_analytics": map[string]interface{}{
			"hourly_pattern":       hourlyCharging,
			"charger_types":        chargerTypes,
			"monthly_trend":        monthlyCharge,
			"power_stats":          computeStats(chargePowers),
			"duration_stats":       computeStats(chargeDurations),
			"energy_stats":         computeStats(chargeEnergies),
			"cost_stats":           computeStats(chargeCosts),
			"start_battery_dist":   chargeBatDist,
		},

		// === NEW: Battery health ===
		"battery_trend": batteryTrend,
	})
}
