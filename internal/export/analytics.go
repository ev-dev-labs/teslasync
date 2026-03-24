package export

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// processAnalytics generates a fleet analytics report as JSON.
// This mirrors the computation from analytics_handler.Fleet() but runs
// asynchronously in the export worker, avoiding HTTP timeouts for large fleets.
func (p *Processor) processAnalytics(ctx context.Context, req *models.ExportJobRequest) (*ProcessResult, error) {
	vehicles, err := p.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, err
	}

	// Parse cutoff from request dates
	cutoff := time.Now().UTC().AddDate(0, 0, -30) // default 30 days
	if req.StartDate != nil {
		cutoff = *req.StartDate
	}

	batRepo := database.NewBatterySnapshotRepo(p.db)

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

	hourCounts := make([]int, 24)
	hourDistance := make([]float64, 24)
	dowCounts := make([]int, 7)
	dowDistance := make([]float64, 7)
	var allSpeedMax, allDriveDurations, allDriveDistances, allDriveEfficiencies []float64
	var insideTemps, outsideTemps []float64
	var tempVsEfficiency []map[string]interface{}
	dailyDriveAgg := make(map[string]map[string]interface{})
	var totalRangeUsed float64

	chargerTypeMap := make(map[string]int)
	var chargePowers, chargeDurations, chargeEnergies, chargeCosts, chargeEfficiencies []float64
	var chargeStartBat []int
	hourChargeCounts := make([]int, 24)
	hourChargeEnergy := make([]float64, 24)
	monthlyChargeAgg := make(map[string]map[string]interface{})

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
		if req.VehicleID != nil && v.ID != *req.VehicleID {
			continue
		}

		// Fetch all data for this vehicle (paginated)
		var allDrives []*models.Drive
		offset := 0
		for {
			drives, _ := p.driveRepo.GetByVehicle(ctx, v.ID, 500, offset, time.Time{}, time.Time{})
			if len(drives) == 0 {
				break
			}
			allDrives = append(allDrives, drives...)
			offset += len(drives)
			if len(drives) < 500 {
				break
			}
		}

		var allSessions []*models.ChargingSession
		offset = 0
		for {
			sessions, _ := p.chargingRepo.GetByVehicle(ctx, v.ID, 500, offset, time.Time{}, time.Time{})
			if len(sessions) == 0 {
				break
			}
			allSessions = append(allSessions, sessions...)
			offset += len(sessions)
			if len(sessions) < 500 {
				break
			}
		}

		batSnaps, _ := batRepo.GetByVehicle(ctx, v.ID, 365)

		var dist float64
		var driveCount int
		for _, d := range allDrives {
			if d.StartDate.Before(cutoff) {
				continue
			}
			dist += d.Distance
			driveCount++

			hour := d.StartDate.Hour()
			hourCounts[hour]++
			hourDistance[hour] += d.Distance
			dow := int(d.StartDate.Weekday())
			dowCounts[dow]++
			dowDistance[dow] += d.Distance

			if d.SpeedMax != nil {
				allSpeedMax = append(allSpeedMax, *d.SpeedMax)
			}
			allDriveDurations = append(allDriveDurations, d.DurationMin)
			allDriveDistances = append(allDriveDistances, d.Distance)

			if d.StartBatteryLvl != nil && d.EndBatteryLvl != nil && d.Distance > 0 {
				totalRangeUsed += float64(*d.StartBatteryLvl - *d.EndBatteryLvl)
			}
			if d.Distance > 0 && d.StartRangeKm != nil && d.EndRangeKm != nil {
				eff := ((*d.StartRangeKm - *d.EndRangeKm) / d.Distance) * 100
				if eff > 0 && eff < 500 {
					allDriveEfficiencies = append(allDriveEfficiencies, eff)
				}
			}
			if d.OutsideTempAvg != nil {
				outsideTemps = append(outsideTemps, *d.OutsideTempAvg)
			}
			if d.InsideTempAvg != nil {
				insideTemps = append(insideTemps, *d.InsideTempAvg)
			}
			if d.OutsideTempAvg != nil && d.Distance > 1 && d.StartRangeKm != nil && d.EndRangeKm != nil {
				eff := ((*d.StartRangeKm - *d.EndRangeKm) / d.Distance) * 100
				if eff > 0 && eff < 500 {
					tempVsEfficiency = append(tempVsEfficiency, map[string]interface{}{
						"temp":       math.Round(*d.OutsideTempAvg*10) / 10,
						"efficiency": math.Round(eff*10) / 10,
						"distance":   math.Round(d.Distance*10) / 10,
					})
				}
			}

			dateKey := d.StartDate.Format("2006-01-02")
			if dailyDriveAgg[dateKey] == nil {
				dailyDriveAgg[dateKey] = map[string]interface{}{"drives": 0, "distance": 0.0}
			}
			dailyDriveAgg[dateKey]["drives"] = dailyDriveAgg[dateKey]["drives"].(int) + 1
			dailyDriveAgg[dateKey]["distance"] = dailyDriveAgg[dateKey]["distance"].(float64) + d.Distance
		}

		var energy, cost float64
		for _, s := range allSessions {
			if s.StartDate.Before(cutoff) {
				continue
			}
			energy += s.ChargeEnergyAdded
			if s.Cost != nil {
				cost += *s.Cost
			}

			ct := "Home/AC"
			if s.FastChargerType != nil && *s.FastChargerType != "" {
				ct = *s.FastChargerType
			}
			chargerTypeMap[ct]++

			if s.ChargerPower != nil {
				chargePowers = append(chargePowers, *s.ChargerPower)
			}
			chargeDurations = append(chargeDurations, s.DurationMin)
			chargeEnergies = append(chargeEnergies, s.ChargeEnergyAdded)
			if s.Cost != nil {
				chargeCosts = append(chargeCosts, *s.Cost)
			}
			chargeStartBat = append(chargeStartBat, s.StartBatteryLevel)

			if s.ChargeEnergyUsed != nil && *s.ChargeEnergyUsed > 0 {
				chargeEfficiencies = append(chargeEfficiencies, (s.ChargeEnergyAdded / *s.ChargeEnergyUsed) * 100)
			}

			chHour := s.StartDate.Hour()
			hourChargeCounts[chHour]++
			hourChargeEnergy[chHour] += s.ChargeEnergyAdded

			monthKey := s.StartDate.Format("2006-01")
			if monthlyChargeAgg[monthKey] == nil {
				monthlyChargeAgg[monthKey] = map[string]interface{}{
					"energy": 0.0, "cost": 0.0, "sessions": 0, "power_sum": 0.0,
				}
			}
			monthlyChargeAgg[monthKey]["energy"] = monthlyChargeAgg[monthKey]["energy"].(float64) + s.ChargeEnergyAdded
			if s.Cost != nil {
				monthlyChargeAgg[monthKey]["cost"] = monthlyChargeAgg[monthKey]["cost"].(float64) + *s.Cost
			}
			monthlyChargeAgg[monthKey]["sessions"] = monthlyChargeAgg[monthKey]["sessions"].(int) + 1
			if s.ChargerPower != nil {
				monthlyChargeAgg[monthKey]["power_sum"] = monthlyChargeAgg[monthKey]["power_sum"].(float64) + *s.ChargerPower
			}
		}

		effic := 0.0
		if dist > 0 && energy > 0 {
			effic = (energy * 1000) / dist
		}

		comparisons = append(comparisons, vehicleStats{
			ID: v.ID, Name: v.DisplayName, Drives: driveCount,
			Distance: dist, Energy: energy, Efficiency: effic,
		})

		fleetDist += dist
		fleetEnergy += energy
		fleetCost += cost
		fleetDrives += driveCount
		fleetSessions += len(allSessions)

		for _, bs := range batSnaps {
			batteryTrend = append(batteryTrend, batteryPoint{
				Date: bs.CreatedAt.Format("2006-01-02"), HealthScore: bs.HealthScore,
				CapacityKWh: bs.CapacityKWh, Degradation: bs.DegradationPct,
				RangeKm: bs.EstRangeKm, CycleCount: bs.CycleCount,
			})
		}
	}

	fleetEffic := 0.0
	if fleetDist > 0 && fleetEnergy > 0 {
		fleetEffic = (fleetEnergy * 1000) / fleetDist
	}

	if comparisons == nil {
		comparisons = []vehicleStats{}
	}

	// Build hourly patterns
	hourlyDriving := make([]map[string]interface{}, 24)
	hourlyCharging := make([]map[string]interface{}, 24)
	for i := 0; i < 24; i++ {
		hourlyDriving[i] = map[string]interface{}{"hour": i, "drives": hourCounts[i], "distance": math.Round(hourDistance[i]*10) / 10}
		hourlyCharging[i] = map[string]interface{}{"hour": i, "charges": hourChargeCounts[i], "energy": math.Round(hourChargeEnergy[i]*10) / 10}
	}

	dayNames := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	dowData := make([]map[string]interface{}, 7)
	for i := 0; i < 7; i++ {
		avgDist := 0.0
		if dowCounts[i] > 0 {
			avgDist = dowDistance[i] / float64(dowCounts[i])
		}
		dowData[i] = map[string]interface{}{"day": dayNames[i], "drives": dowCounts[i], "distance": math.Round(dowDistance[i]*10) / 10, "avg_distance": math.Round(avgDist*10) / 10}
	}

	// Monthly charging trends
	monthlyCharge := make([]map[string]interface{}, 0, len(monthlyChargeAgg))
	for m, data := range monthlyChargeAgg {
		sessions := data["sessions"].(int)
		avgPower := 0.0
		if sessions > 0 {
			avgPower = data["power_sum"].(float64) / float64(sessions)
		}
		gasCost := data["energy"].(float64) * 0.14 * 8.5
		monthlyCharge = append(monthlyCharge, map[string]interface{}{
			"month": m, "energy": math.Round(data["energy"].(float64)*100) / 100,
			"cost": math.Round(data["cost"].(float64)*100) / 100, "sessions": sessions,
			"avg_power": math.Round(avgPower*10) / 10, "gas_cost": math.Round(gasCost*100) / 100,
			"savings": math.Round((gasCost-data["cost"].(float64))*100) / 100,
		})
	}
	sort.Slice(monthlyCharge, func(i, j int) bool { return monthlyCharge[i]["month"].(string) < monthlyCharge[j]["month"].(string) })

	dailyTrend := make([]map[string]interface{}, 0, len(dailyDriveAgg))
	for d, data := range dailyDriveAgg {
		dailyTrend = append(dailyTrend, map[string]interface{}{"date": d, "drives": data["drives"], "distance": math.Round(data["distance"].(float64)*10) / 10})
	}
	sort.Slice(dailyTrend, func(i, j int) bool { return dailyTrend[i]["date"].(string) < dailyTrend[j]["date"].(string) })

	if len(tempVsEfficiency) > 200 {
		tempVsEfficiency = tempVsEfficiency[:200]
	}
	sort.Slice(batteryTrend, func(i, j int) bool { return batteryTrend[i].Date < batteryTrend[j].Date })

	result := map[string]interface{}{
		"period_days":             int(time.Since(cutoff).Hours()/24) + 1,
		"total_vehicles":          len(vehicles),
		"total_distance_km":       math.Round(fleetDist*10) / 10,
		"total_drives":            fleetDrives,
		"total_charging_sessions": fleetSessions,
		"total_energy_kwh":        math.Round(fleetEnergy*100) / 100,
		"total_cost":              math.Round(fleetCost*100) / 100,
		"avg_efficiency_wh_km":    math.Round(fleetEffic*10) / 10,
		"vehicle_comparison":      comparisons,
		"drive_analytics": map[string]interface{}{
			"hourly_pattern":      hourlyDriving,
			"day_of_week":         dowData,
			"speed_stats":         computeStats(allSpeedMax),
			"duration_stats":      computeStats(allDriveDurations),
			"distance_stats":      computeStats(allDriveDistances),
			"efficiency_stats":    computeStats(allDriveEfficiencies),
			"daily_trend":         dailyTrend,
			"temp_vs_efficiency":  tempVsEfficiency,
			"temperature":         map[string]interface{}{"inside": computeStats(insideTemps), "outside": computeStats(outsideTemps)},
		},
		"charging_analytics": map[string]interface{}{
			"hourly_pattern":  hourlyCharging,
			"charger_types":   mapToSlice(chargerTypeMap, "type", "count"),
			"monthly_trend":   monthlyCharge,
			"power_stats":     computeStats(chargePowers),
			"duration_stats":  computeStats(chargeDurations),
			"energy_stats":    computeStats(chargeEnergies),
			"cost_stats":      computeStats(chargeCosts),
			"efficiency_stats": computeStats(chargeEfficiencies),
		},
		"battery_trend": batteryTrend,
	}

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(result); err != nil {
		return nil, err
	}

	return &ProcessResult{
		FileName:    "teslasync-analytics-report.json",
		Data:        buf.Bytes(),
		RecordCount: fleetDrives + fleetSessions,
	}, nil
}

func computeStats(vals []float64) map[string]interface{} {
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

func mapToSlice(m map[string]int, keyName, valName string) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(m))
	for k, v := range m {
		result = append(result, map[string]interface{}{keyName: k, valName: v})
	}
	sort.Slice(result, func(i, j int) bool { return result[i][valName].(int) > result[j][valName].(int) })
	return result
}
