package analytics

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	maxAnalyticsRecordsPerVehicle = 1000
)

func analyticsWindow(r *http.Request, now time.Time) (time.Time, time.Time, error) {
	query := r.URL.Query()
	start, end, err := apiparams.ParseDateRangeValues(query.Get("start"), query.Get("end"))
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	if !start.IsZero() || !end.IsZero() {
		return start, end, nil
	}

	if raw := query.Get("days"); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed <= 0 {
			return time.Time{}, time.Time{}, fmt.Errorf("days must be a positive integer")
		}
		return now.AddDate(0, 0, -parsed), now, nil
	}
	// No filter is the established all-history contract. The record cap below
	// continues to disclose a possibly incomplete aggregation via
	// partial_result rather than silently changing the requested time range.
	return time.Time{}, time.Time{}, nil
}

func (h *AnalyticsHandler) Fleet(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.analytics.fleet")
	defer span.End()
	now := time.Now().UTC()

	cutoff, endCutoff, err := analyticsWindow(r, now)
	if err != nil {
		span.RecordError(err)
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	traceID := span.SpanContext().TraceID().String()

	vehicles, err := h.vehicleRepo.GetAll(ctx)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", traceID).Msg("failed to get vehicles for analytics")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get analytics")
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
	hourCounts := make([]int, 24)       // drives per hour of day
	hourDistance := make([]float64, 24) // distance per hour of day
	dowCounts := make([]int, 7)         // drives per day of week
	dowDistance := make([]float64, 7)   // distance per DOW
	var allSpeedMax []float64
	var allDriveDurations []float64
	var allDriveDistances []float64
	var allDriveEfficiencies []float64
	var insideTemps []float64
	var outsideTemps []float64
	var tempVsEfficiency []map[string]interface{}               // for scatter: {temp, efficiency}
	var dailyDriveAgg = make(map[string]map[string]interface{}) // date -> {drives, distance, energy}

	// === Charging deep analytics accumulators ===
	chargerTypeMap := make(map[string]int) // charger type -> count
	var chargePowers []float64
	var chargeDurations []float64
	var chargeEnergies []float64
	var chargeCosts []float64
	var chargeStartBat []int
	hourChargeCounts := make([]int, 24) // charges per hour
	hourChargeEnergy := make([]float64, 24)
	var monthlyChargeAgg = make(map[string]map[string]interface{}) // month -> {energy, cost, sessions, avg_power}

	// === Battery health accumulators ===
	type batteryPoint struct {
		Date        string  `json:"date"`
		HealthScore float64 `json:"health_score"`
		CapacityWh  float64 `json:"capacity_wh"`
		Degradation float64 `json:"degradation_pct"`
		RangeKm     float64 `json:"range_km"`
		CycleCount  int     `json:"cycle_count"`
	}
	var batteryTrend []batteryPoint
	partialReasons := make(map[string]struct{})
	markPartial := func(reason string) {
		partialReasons[reason] = struct{}{}
	}

	for _, v := range vehicles {
		drives, err := h.driveRepo.GetByVehicle(ctx, v.ID, maxAnalyticsRecordsPerVehicle, 0, cutoff, endCutoff)
		if err != nil {
			span.RecordError(err)
			log.Error().Err(err).Int64("vehicle_id", v.ID).Str("trace_id", traceID).
				Msg("analytics: failed to get drives")
			markPartial("drive_query_failed")
			drives = nil
		} else if len(drives) >= maxAnalyticsRecordsPerVehicle {
			markPartial("drive_record_cap_reached")
		}
		sessions, err := h.chargingRepo.GetByVehicle(ctx, v.ID, maxAnalyticsRecordsPerVehicle, 0, cutoff, endCutoff)
		if err != nil {
			span.RecordError(err)
			log.Error().Err(err).Int64("vehicle_id", v.ID).Str("trace_id", traceID).
				Msg("analytics: failed to get charging sessions")
			markPartial("charging_query_failed")
			sessions = nil
		} else if len(sessions) >= maxAnalyticsRecordsPerVehicle {
			markPartial("charging_record_cap_reached")
		}
		// Per-vehicle battery health from latest signal snapshot via
		// StateReader.State at time.Now(). State() returns the forward-folded
		// current state, so the BatteryLevel signal is carried across
		// emissions. Errors are logged and skipped so a single vehicle's
		// failure does not 500 the entire fleet response.
		var snap signal.State
		var snapErr error
		if h.state == nil {
			markPartial("state_reader_unavailable")
		} else {
			snap, snapErr = h.state.State(ctx, v.ID, now)
		}
		if snapErr != nil {
			span.RecordError(snapErr)
			log.Error().Err(snapErr).Int64("vehicle_id", v.ID).Str("trace_id", traceID).
				Msg("analytics: failed to get latest signal snapshot")
			markPartial("state_query_failed")
		} else if snap != nil {
			if bl, ok := signal.Float64(snap["BatteryLevel"]); ok && bl > 0 {
				const nomCap = 75000.0
				const nomRange = 531.0
				batteryTrend = append(batteryTrend, batteryPoint{
					Date:        now.Format("2006-01-02"),
					HealthScore: bl,
					CapacityWh:  bl * nomCap / 100,
					Degradation: 100 - bl,
					RangeKm:     bl * nomRange / 100,
				})
			}
		}

		var dist float64
		var driveCount int
		for _, d := range drives {
			if !cutoff.IsZero() && d.StartTs.Before(cutoff) {
				continue
			}
			if !endCutoff.IsZero() && d.StartTs.After(endCutoff) {
				continue
			}
			distKm := d.DistanceM / 1000.0
			dist += distKm
			driveCount++

			// Hour & DOW
			hour := d.StartTs.Hour()
			hourCounts[hour]++
			hourDistance[hour] += distKm
			dow := int(d.StartTs.Weekday())
			dowCounts[dow]++
			dowDistance[dow] += distKm

			// Performance metrics
			if d.MaxSpeedMps != nil {
				// km/h for the speed-stats output bucket
				allSpeedMax = append(allSpeedMax, *d.MaxSpeedMps*3.6)
			}
			allDriveDurations = append(allDriveDurations, float64(d.DurationS)/60.0)
			allDriveDistances = append(allDriveDistances, distKm)

			// Efficiency per drive (Wh/km from EnergyUsedWh)
			if d.EnergyUsedWh != nil && d.DistanceM > 0 {
				eff := (*d.EnergyUsedWh) / distKm
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
			if d.OutsideTempAvgC != nil && distKm > 1 && d.EnergyUsedWh != nil {
				eff := (*d.EnergyUsedWh) / distKm
				if eff > 0 && eff < 1000 {
					tempVsEfficiency = append(tempVsEfficiency, map[string]interface{}{
						"temp":       math.Round(*d.OutsideTempAvgC*10) / 10,
						"efficiency": math.Round(eff*10) / 10,
						"distance":   math.Round(distKm*10) / 10,
					})
				}
			}

			// Daily aggregation
			dateKey := d.StartTs.Format("2006-01-02")
			if dailyDriveAgg[dateKey] == nil {
				dailyDriveAgg[dateKey] = map[string]interface{}{"drives": 0, "distance": 0.0}
			}
			dailyDriveAgg[dateKey]["drives"] = dailyDriveAgg[dateKey]["drives"].(int) + 1
			dailyDriveAgg[dateKey]["distance"] = dailyDriveAgg[dateKey]["distance"].(float64) + distKm
		}

		var energy, cost float64
		for _, s := range sessions {
			if !cutoff.IsZero() && s.StartedAt.Before(cutoff) {
				continue
			}
			if !endCutoff.IsZero() && s.StartedAt.After(endCutoff) {
				continue
			}
			if s.TotalEnergyAddedWh != nil {
				energy += (*s.TotalEnergyAddedWh / 1000.0)
			}
			if s.CostDecimal != nil {
				cost += *s.CostDecimal
			}

			// Charger type analytics
			ct := derefS(s.ChargerType)
			if ct == "" {
				ct = "Home/AC"
			}
			chargerTypeMap[ct]++

			// Charge power and duration
			if s.PeakPowerW != nil {
				chargePowers = append(chargePowers, (*s.PeakPowerW / 1000.0))
			}
			if dur := s.DurationMinutes(); dur != nil {
				chargeDurations = append(chargeDurations, *dur)
			}
			if s.TotalEnergyAddedWh != nil {
				chargeEnergies = append(chargeEnergies, (*s.TotalEnergyAddedWh / 1000.0))
			}
			if s.CostDecimal != nil {
				chargeCosts = append(chargeCosts, *s.CostDecimal)
			}
			if s.StartSocPct != nil {
				chargeStartBat = append(chargeStartBat, int(*s.StartSocPct))
			}

			// Hour of day
			chHour := s.StartedAt.Hour()
			hourChargeCounts[chHour]++
			if s.TotalEnergyAddedWh != nil {
				hourChargeEnergy[chHour] += (*s.TotalEnergyAddedWh / 1000.0)
			}

			// Monthly aggregation
			monthKey := s.StartedAt.Format("2006-01")
			if monthlyChargeAgg[monthKey] == nil {
				monthlyChargeAgg[monthKey] = map[string]interface{}{
					"energy": 0.0, "cost": 0.0, "sessions": 0, "power_sum": 0.0,
				}
			}
			if s.TotalEnergyAddedWh != nil {
				monthlyChargeAgg[monthKey]["energy"] = monthlyChargeAgg[monthKey]["energy"].(float64) + (*s.TotalEnergyAddedWh / 1000.0)
			}
			if s.CostDecimal != nil {
				monthlyChargeAgg[monthKey]["cost"] = monthlyChargeAgg[monthKey]["cost"].(float64) + *s.CostDecimal
			}
			monthlyChargeAgg[monthKey]["sessions"] = monthlyChargeAgg[monthKey]["sessions"].(int) + 1
			if s.PeakPowerW != nil {
				monthlyChargeAgg[monthKey]["power_sum"] = monthlyChargeAgg[monthKey]["power_sum"].(float64) + (*s.PeakPowerW / 1000.0)
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

		// Battery trend from cagg_battery_daily
		if h.db != nil {
			const btCap = 75000.0
			const btRange = 531.0
			// Build conditional SQL: cutoff/endCutoff are independently
			// optional, so only emit the bound clauses when set rather
			// than passing time.Time{} sentinel values that would silently
			// filter out all rows.
			query := `SELECT bucket, end_soc, min_soc, max_soc
				 FROM cagg_battery_daily
				 WHERE vehicle_id = $1`
			args := []any{v.ID}
			if !cutoff.IsZero() {
				args = append(args, cutoff)
				query += " AND bucket >= $" + strconv.Itoa(len(args))
			}
			if !endCutoff.IsZero() {
				args = append(args, endCutoff)
				query += " AND bucket <= $" + strconv.Itoa(len(args))
			}
			query += " ORDER BY bucket ASC"
			btRows, btErr := h.db.Pool.Query(ctx, query, args...)
			if btErr == nil {
				for btRows.Next() {
					var bucket time.Time
					var endSOC, minSOC, maxSOC *float64
					if scanErr := btRows.Scan(&bucket, &endSOC, &minSOC, &maxSOC); scanErr != nil {
						log.Warn().Err(scanErr).Int64("vehicle_id", v.ID).Str("trace_id", traceID).
							Msg("analytics: failed to scan battery trend row")
						markPartial("battery_trend_row_scan_failed")
						continue
					}
					soc := 0.0
					if endSOC != nil {
						soc = *endSOC
					}
					batteryTrend = append(batteryTrend, batteryPoint{
						Date:        bucket.Format("2006-01-02"),
						HealthScore: soc,
						CapacityWh:  soc * btCap / 100,
						Degradation: 100 - soc,
						RangeKm:     soc * btRange / 100,
					})
				}
				btRows.Close()
				if rowsErr := btRows.Err(); rowsErr != nil {
					span.RecordError(rowsErr)
					log.Warn().Err(rowsErr).Int64("vehicle_id", v.ID).Str("trace_id", traceID).
						Msg("analytics: failed to iterate battery trend")
					markPartial("battery_trend_query_failed")
				}
			} else {
				span.RecordError(btErr)
				log.Warn().Err(btErr).Int64("vehicle_id", v.ID).Str("trace_id", traceID).
					Msg("analytics: failed to query battery trend")
				markPartial("battery_trend_query_failed")
			}
		}
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
			"hour":    i,
			"charges": hourChargeCounts[i],
			"energy":  math.Round(hourChargeEnergy[i]*10) / 10,
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
	speedBuckets := []struct {
		Min, Max int
		Label    string
	}{
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
			"savings":   math.Round((gasCost-data["cost"].(float64))*100) / 100,
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
	batDistBuckets := []struct {
		Min, Max int
		Label    string
	}{
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
	distBuckets := []struct {
		Min, Max float64
		Label    string
	}{
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

	partialReasonList := make([]string, 0, len(partialReasons))
	for reason := range partialReasons {
		partialReasonList = append(partialReasonList, reason)
	}
	sort.Strings(partialReasonList)
	periodDays := 0
	if !cutoff.IsZero() {
		periodEnd := endCutoff
		if periodEnd.IsZero() {
			periodEnd = now
		}
		periodDays = int(periodEnd.Sub(cutoff).Hours()/24) + 1
	}

	// === Build total response ===
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"generated_at": now,
		"source":       "derived_fleet_analytics",
		"partial_result": map[string]interface{}{
			"is_partial": len(partialReasonList) > 0,
			"reasons":    partialReasonList,
		},
		// Core fleet stats (existing)
		"period_days":             periodDays,
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
			"hourly_pattern":        hourlyDriving,
			"day_of_week":           dowData,
			"speed_distribution":    speedDistribution,
			"distance_distribution": distDistribution,
			"speed_stats":           computeStats(allSpeedMax),
			"duration_stats":        computeStats(allDriveDurations),
			"distance_stats":        computeStats(allDriveDistances),
			"efficiency_stats":      computeStats(allDriveEfficiencies),
			"daily_trend":           dailyTrend,
			"temp_vs_efficiency":    tempVsEfficiency,
			"temperature":           tempStats,
		},

		// === NEW: Charging analytics ===
		"charging_analytics": map[string]interface{}{
			"hourly_pattern":     hourlyCharging,
			"charger_types":      chargerTypes,
			"monthly_trend":      monthlyCharge,
			"power_stats":        computeStats(chargePowers),
			"duration_stats":     computeStats(chargeDurations),
			"energy_stats":       computeStats(chargeEnergies),
			"cost_stats":         computeStats(chargeCosts),
			"start_battery_dist": chargeBatDist,
		},

		// === NEW: Battery health ===
		"battery_trend": batteryTrend,
	})
}
