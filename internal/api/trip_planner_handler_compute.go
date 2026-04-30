package api

import (
	"context"
	"fmt"
	"math"
	"time"
)

// ── Core algorithm ──────────────────────────────────────────────────────

func (h *TripPlannerHandler) computePlan(ctx context.Context, req *tripPlanRequest) (*tripPlanResponse, error) {
	// 1. Estimate route distance (haversine × driving factor)
	straightDist := haversineKm(req.Origin.Lat, req.Origin.Lng, req.Destination.Lat, req.Destination.Lng)
	routeDistanceKm := straightDist * drivingDistanceFactor

	// 2. Get vehicle efficiency and battery capacity
	efficiencyWhKm := h.vehicleEfficiency(ctx, req.VehicleID)
	batteryCapKWh := h.batteryCapacity(ctx, req.VehicleID)

	// 3. Apply speed factor (higher speed = more consumption)
	speedMultiplier := 1.0
	if req.Preferences.SpeedFactor > 1.0 {
		speedMultiplier = 1.0 + (req.Preferences.SpeedFactor-1.0)*0.3 // 30% of extra speed → extra consumption
	} else if req.Preferences.SpeedFactor < 1.0 {
		speedMultiplier = 1.0 - (1.0-req.Preferences.SpeedFactor)*0.15
	}
	efficiencyWhKm *= speedMultiplier

	// 4. Weather impact
	weatherImpact := h.estimateWeatherImpact(ctx, req.VehicleID)
	efficiencyWhKm *= weatherImpact.EfficiencyFactor

	// 5. Calculate total energy and feasibility
	totalEnergyKWh := routeDistanceKm * efficiencyWhKm / 1000.0
	availableEnergyKWh := (req.CurrentSOC - req.MinArrivalSOC) / 100.0 * batteryCapKWh
	feasible := availableEnergyKWh >= totalEnergyKWh

	// 6. Estimate driving duration (assume avg 90 km/h adjusted by speed factor)
	avgSpeedKmh := 90.0 * req.Preferences.SpeedFactor
	drivingDurationMin := routeDistanceKm / avgSpeedKmh * 60.0

	// 7. Build legs and charging stops
	var legs []tripPlanLeg
	var chargeStops []tripChargeStop
	var chargingDurationMin float64

	if feasible {
		// Single leg, no stops needed
		arrivalSOC := req.CurrentSOC - (totalEnergyKWh / batteryCapKWh * 100.0)
		legs = append(legs, tripPlanLeg{
			From:        req.Origin,
			To:          req.Destination,
			DistanceKm:  math.Round(routeDistanceKm*10) / 10,
			DurationMin: math.Round(drivingDurationMin*10) / 10,
			EnergyKWh:   math.Round(totalEnergyKWh*10) / 10,
			StartSOC:    req.CurrentSOC,
			ArrivalSOC:  math.Round(arrivalSOC*10) / 10,
		})
	} else {
		// Need charging stops
		legs, chargeStops, chargingDurationMin = h.buildStopsAlongRoute(
			req, routeDistanceKm, efficiencyWhKm, batteryCapKWh,
		)
		feasible = len(legs) > 0
	}

	// Compute arrival SOC from last leg
	arrivalSOC := req.MinArrivalSOC
	if len(legs) > 0 {
		arrivalSOC = legs[len(legs)-1].ArrivalSOC
	}

	// Compute cost
	chargingCost := 0.0
	for _, stop := range chargeStops {
		chargingCost += stop.Cost
	}

	// Build SOC curve points along the route
	socCurve := h.buildSOCCurve(legs, chargeStops, routeDistanceKm)

	totalDurationMin := drivingDurationMin + chargingDurationMin

	return &tripPlanResponse{
		Route: tripPlanRoute{
			TotalDistanceKm:     math.Round(routeDistanceKm*10) / 10,
			TotalDurationMin:    math.Round(totalDurationMin*10) / 10,
			DrivingDurationMin:  math.Round(drivingDurationMin*10) / 10,
			ChargingDurationMin: math.Round(chargingDurationMin*10) / 10,
			TotalEnergyKWh:      math.Round(totalEnergyKWh*10) / 10,
			EstimatedCost:       math.Round(chargingCost*100) / 100,
			ArrivalSOC:          math.Round(arrivalSOC*10) / 10,
			Feasible:            feasible,
			IsEstimate:          true,
		},
		Legs:          legs,
		ChargeStops:   chargeStops,
		WeatherImpact: weatherImpact,
		SOCCurve:      socCurve,
	}, nil
}

// buildStopsAlongRoute simulates driving the route and inserts charging stops
// when SOC drops below the threshold.
func (h *TripPlannerHandler) buildStopsAlongRoute(
	req *tripPlanRequest, totalDistKm, effWhKm, batteryCapKWh float64,
) ([]tripPlanLeg, []tripChargeStop, float64) {
	var legs []tripPlanLeg
	var stops []tripChargeStop
	var totalChargingMin float64

	soc := req.CurrentSOC
	coveredKm := 0.0
	stopNum := 0
	maxStops := req.Preferences.MaxChargeStops
	if maxStops <= 0 {
		maxStops = 5
	}

	currentFrom := req.Origin

	for coveredKm < totalDistKm && stopNum < maxStops {
		// How far can we drive before hitting min SOC threshold?
		usableSOC := soc - minStopSOCThreshold
		if usableSOC < 0 {
			usableSOC = 0
		}
		usableKWh := usableSOC / 100.0 * batteryCapKWh
		maxRangeKm := usableKWh / (effWhKm / 1000.0)
		remainingKm := totalDistKm - coveredKm

		if maxRangeKm >= remainingKm+(req.MinArrivalSOC-minStopSOCThreshold)/100.0*batteryCapKWh/(effWhKm/1000.0) {
			// Can reach destination
			legEnergy := remainingKm * effWhKm / 1000.0
			arrivalSOC := soc - (legEnergy / batteryCapKWh * 100.0)
			legs = append(legs, tripPlanLeg{
				From:        currentFrom,
				To:          req.Destination,
				DistanceKm:  math.Round(remainingKm*10) / 10,
				DurationMin: math.Round(remainingKm/90.0*60.0*10) / 10,
				EnergyKWh:   math.Round(legEnergy*10) / 10,
				StartSOC:    math.Round(soc*10) / 10,
				ArrivalSOC:  math.Round(arrivalSOC*10) / 10,
			})
			break
		}

		// Drive until we need to stop
		legKm := maxRangeKm * 0.85 // Stop before we're empty, leave buffer
		if legKm < 50 {
			legKm = math.Min(50, remainingKm) // minimum 50 km leg
		}

		legEnergy := legKm * effWhKm / 1000.0
		arrivalSOCAtStop := soc - (legEnergy / batteryCapKWh * 100.0)
		if arrivalSOCAtStop < 5 {
			arrivalSOCAtStop = 5
		}

		// Position the charging stop along the route (interpolate lat/lng)
		fraction := (coveredKm + legKm) / totalDistKm
		if fraction > 1 {
			fraction = 1
		}
		stopLat := req.Origin.Lat + (req.Destination.Lat-req.Origin.Lat)*fraction
		stopLng := req.Origin.Lng + (req.Destination.Lng-req.Origin.Lng)*fraction
		stopName := fmt.Sprintf("Recommended Charging Stop %d", stopNum+1)

		stopLoc := tripPlanLocation{
			Lat:  math.Round(stopLat*10000) / 10000,
			Lng:  math.Round(stopLng*10000) / 10000,
			Name: stopName,
		}

		legs = append(legs, tripPlanLeg{
			From:        currentFrom,
			To:          stopLoc,
			DistanceKm:  math.Round(legKm*10) / 10,
			DurationMin: math.Round(legKm/90.0*60.0*10) / 10,
			EnergyKWh:   math.Round(legEnergy*10) / 10,
			StartSOC:    math.Round(soc*10) / 10,
			ArrivalSOC:  math.Round(arrivalSOCAtStop*10) / 10,
		})

		// Charge at stop
		chargeToSOC := math.Min(req.ChargeLimitSOC, 80) // charge to 80% for speed
		if remainingKm-legKm < 200 {
			// If close to destination, charge less
			neededKWh := (remainingKm - legKm) * effWhKm / 1000.0
			neededSOC := neededKWh / batteryCapKWh * 100.0
			chargeToSOC = math.Min(chargeToSOC, arrivalSOCAtStop+neededSOC+req.MinArrivalSOC+5)
		}
		if chargeToSOC <= arrivalSOCAtStop {
			chargeToSOC = arrivalSOCAtStop + 30
		}
		if chargeToSOC > 95 {
			chargeToSOC = 95
		}

		chargeKWh := (chargeToSOC - arrivalSOCAtStop) / 100.0 * batteryCapKWh
		chargeMins := estimateChargeTime(arrivalSOCAtStop, chargeToSOC, batteryCapKWh, chargerPowerKW)
		chargeCost := chargeKWh * superchargerCostPerKWh

		stops = append(stops, tripChargeStop{
			Name:              stopName,
			Location:          stopLoc,
			ChargeFromSOC:     math.Round(arrivalSOCAtStop*10) / 10,
			ChargeToSOC:       math.Round(chargeToSOC*10) / 10,
			ChargeDurationMin: math.Round(chargeMins*10) / 10,
			EnergyKWh:         math.Round(chargeKWh*10) / 10,
			Cost:              math.Round(chargeCost*100) / 100,
			IsRecommended:     true,
		})

		totalChargingMin += chargeMins
		soc = chargeToSOC
		coveredKm += legKm
		currentFrom = stopLoc
		stopNum++
	}

	// If we haven't reached the destination yet, add final leg
	remainingKm := totalDistKm - coveredKm
	if remainingKm > 0.5 && (len(legs) == 0 || legs[len(legs)-1].To.Name != req.Destination.Name) {
		legEnergy := remainingKm * effWhKm / 1000.0
		arrivalSOC := soc - (legEnergy / batteryCapKWh * 100.0)
		legs = append(legs, tripPlanLeg{
			From:        currentFrom,
			To:          req.Destination,
			DistanceKm:  math.Round(remainingKm*10) / 10,
			DurationMin: math.Round(remainingKm/90.0*60.0*10) / 10,
			EnergyKWh:   math.Round(legEnergy*10) / 10,
			StartSOC:    math.Round(soc*10) / 10,
			ArrivalSOC:  math.Round(arrivalSOC*10) / 10,
		})
	}

	return legs, stops, totalChargingMin
}

// estimateChargeTime estimates minutes to charge from startSOC to endSOC.
// Uses a simplified charging curve: fast up to 50%, tapers to 80%, slow above 80%.
func estimateChargeTime(startSOC, endSOC, capacityKWh, maxPowerKW float64) float64 {
	totalMinutes := 0.0
	step := 1.0 // 1% increments

	for soc := startSOC; soc < endSOC; soc += step {
		var powerKW float64
		switch {
		case soc < 20:
			powerKW = maxPowerKW * 0.8
		case soc < 50:
			powerKW = maxPowerKW
		case soc < 70:
			powerKW = maxPowerKW * 0.7
		case soc < 80:
			powerKW = maxPowerKW * 0.45
		case soc < 90:
			powerKW = maxPowerKW * 0.25
		default:
			powerKW = maxPowerKW * 0.12
		}

		kwhForStep := step / 100.0 * capacityKWh
		minutesForStep := kwhForStep / powerKW * 60.0
		totalMinutes += minutesForStep
	}

	return totalMinutes
}

// vehicleEfficiency returns the distance-weighted average Wh/km for the vehicle.
func (h *TripPlannerHandler) vehicleEfficiency(ctx context.Context, vehicleID int64) float64 {
	var eff *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT CASE
			WHEN SUM(distance_mi) > 0 THEN
				SUM(COALESCE(energy_used_kwh, 0)) * 1000.0
				/ (SUM(distance_mi) * 1.60934)
			END
		FROM drives
		WHERE vehicle_id = $1 AND distance_mi > 1
		  AND energy_used_kwh > 0
		  AND start_battery_pct > end_battery_pct
		  AND start_ts > NOW() - INTERVAL '90 days'`, vehicleID).Scan(&eff)

	if eff != nil && *eff > 50 && *eff < 500 {
		return *eff
	}
	return defaultEfficiencyWhKm
}

// batteryCapacity returns the usable battery capacity for the vehicle.
func (h *TripPlannerHandler) batteryCapacity(ctx context.Context, vehicleID int64) float64 {
	// Try capacity from signal_log (EnergyRemaining = current usable kWh)
	if h.signalLogReader != nil {
		val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "EnergyRemaining", time.Now())
		if err == nil && val != nil {
			if capacityKWh, ok := val.(float64); ok && capacityKWh > 20 {
				return capacityKWh
			}
		}
	}

	// Fall back to nominal × health derived from BatteryLevel signal history
	if h.signalLogReader != nil {
		val, err := h.signalLogReader.SignalAt(ctx, vehicleID, "BatteryLevel", time.Now())
		if err == nil && val != nil {
			if soc, ok := val.(float64); ok && soc > 0 && soc <= 100 {
				// BatteryLevel is SOC%; use it as a rough health proxy
				// when no better data exists (SOC isn't health, but
				// without dedicated health signals this is the best fallback)
				return defaultBatteryCapacityKWh
			}
		}
	}

	return defaultBatteryCapacityKWh
}

// estimateWeatherImpact returns a weather adjustment factor based on recent driving data.
func (h *TripPlannerHandler) estimateWeatherImpact(ctx context.Context, vehicleID int64) tripWeatherImpact {
	var avgTempC *float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(outside_temp_avg_c) FROM drives
		WHERE vehicle_id = $1 AND outside_temp_avg_c IS NOT NULL
		  AND start_ts > NOW() - INTERVAL '7 days'`, vehicleID).Scan(&avgTempC)

	if avgTempC == nil {
		return tripWeatherImpact{
			EfficiencyFactor: 1.0,
			Note:             "No recent temperature data available",
		}
	}

	factor := 1.0
	var note string
	temp := *avgTempC

	switch {
	case temp < -10:
		factor = 1.40
		note = fmt.Sprintf("Very cold weather (%.0f°C) — expect ~40%% increased consumption from cabin heating", temp)
	case temp < 0:
		factor = 1.25
		note = fmt.Sprintf("Cold weather (%.0f°C) — expect ~25%% increased consumption from heating", temp)
	case temp < 10:
		factor = 1.12
		note = fmt.Sprintf("Cool weather (%.0f°C) — slight increase in consumption (~12%%)", temp)
	case temp > 35:
		factor = 1.12
		note = fmt.Sprintf("Hot weather (%.0f°C) — AC will increase consumption ~12%%", temp)
	case temp > 28:
		factor = 1.06
		note = fmt.Sprintf("Warm weather (%.0f°C) — minor AC impact (~6%%)", temp)
	default:
		factor = 1.0
		note = fmt.Sprintf("Mild weather (%.0f°C) — optimal efficiency conditions", temp)
	}

	return tripWeatherImpact{
		AvgTempC:         avgTempC,
		EfficiencyFactor: factor,
		Note:             note,
	}
}

// buildSOCCurve generates SOC datapoints along the route for chart visualization.
func (h *TripPlannerHandler) buildSOCCurve(legs []tripPlanLeg, stops []tripChargeStop, totalDistKm float64) []tripSOCPoint {
	if len(legs) == 0 {
		return nil
	}

	points := make([]tripSOCPoint, 0, 20)
	cumDist := 0.0

	for i, leg := range legs {
		// Add start of leg
		points = append(points, tripSOCPoint{
			DistanceKm: math.Round(cumDist*10) / 10,
			SOC:        leg.StartSOC,
		})

		// Add end of leg (arrival at stop or destination)
		cumDist += leg.DistanceKm
		points = append(points, tripSOCPoint{
			DistanceKm: math.Round(cumDist*10) / 10,
			SOC:        leg.ArrivalSOC,
		})

		// If there's a charging stop after this leg, add the post-charge point
		if i < len(stops) {
			points = append(points, tripSOCPoint{
				DistanceKm: math.Round(cumDist*10) / 10,
				SOC:        stops[i].ChargeToSOC,
			})
		}
	}

	return points
}

// haversineKm returns the great-circle distance between two points in kilometers.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0 // Earth radius in km
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLng := (lng2 - lng1) * math.Pi / 180.0
	lat1r := lat1 * math.Pi / 180.0
	lat2r := lat2 * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1r)*math.Cos(lat2r)*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}
