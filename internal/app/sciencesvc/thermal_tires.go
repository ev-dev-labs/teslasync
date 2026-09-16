package sciencesvc

import (
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/physics"
	apiscience "github.com/ev-dev-labs/teslasync/internal/science"
)

// buildThermal fits pack and cabin cooldowns over Park windows. Sentry-on
// samples are excluded by the fitter (active load, not passive).
func buildThermal(vehicleID int64, from, to time.Time, samples []physics.Sample, truncated bool) apiscience.ThermalReport {
	rep := apiscience.ThermalReport{
		VehicleID: vehicleID, Start: from.UTC(), End: to.UTC(),
		Fits:        []apiscience.ThermalFit{},
		SignalsUsed: []string{"ModuleTempMax", "InsideTemp", "OutsideTemp", "SentryMode", "HvacPower", "PreconditioningEnabled", "BatteryHeaterOn", "Gear"},
		Missing:     []string{"battery_inlet_temp", "solar_irradiance"},
		Truncated:   truncated,
		Honesty:     apiscience.ThermalHonesty,
	}
	sorted := append([]physics.Sample(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })
	temps := apiscience.TempSamplesFromPhysics(sorted)
	var park []apiscience.TempSample
	flush := func() {
		if len(park) > 0 {
			rep.Fits = append(rep.Fits, apiscience.FitCooldown(park, true), apiscience.FitCooldown(park, false))
			park = nil
		}
	}
	for i, s := range sorted {
		if s.HvacPowerW == nil {
			rep.Missing = append(rep.Missing, "hvac_power_observation")
		}
		if s.Gear != "P" || s.SentryOn || s.Preconditioning || s.BatteryHeaterOn || (s.HvacPowerW != nil && *s.HvacPowerW > 0) {
			flush()
			continue
		}
		if i > 0 && (s.At.Sub(sorted[i-1].At) > apiscience.ThermalMaxGap || s.Firmware != sorted[i-1].Firmware) {
			flush()
		}
		park = append(park, temps[i])
	}
	flush()
	if len(rep.Fits) == 0 {
		rep.Fits = append(rep.Fits, apiscience.FitCooldown(nil, true), apiscience.FitCooldown(nil, false))
	}
	rep.Missing = dedupeStrings(rep.Missing)
	return rep
}

// buildTires reports TPMS corners plus the labeled underinflation model.
// Base rolling Wh comes from the twin solve when mass is configured;
// otherwise the extra-Wh estimate stays unknown.
func buildTires(vehicleID int64, from, to time.Time, samples []physics.Sample, recommendedKpa *float64, twin *physics.Ledger, truncated bool) apiscience.TireReport {
	rep := apiscience.TireReport{
		VehicleID: vehicleID, Start: from.UTC(), End: to.UTC(),
		RecommendedKpa: recommendedKpa,
		Unknown:        true,
		SignalsUsed:    []string{"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr", "Odometer", "VehicleSpeed"},
		Missing:        []string{"steering_angle", "yaw_rate", "slip_ratio", "tpms_temperature"},
		Honesty:        apiscience.TireHonesty,
	}
	if truncated {
		rep.Missing = append(rep.Missing, "sample_cap_hit")
	}
	var odo0, odo1 *float64
	for _, s := range samples {
		if s.TpmsFLKpa != nil {
			rep.FLKpa = s.TpmsFLKpa
		}
		if s.TpmsFRKpa != nil {
			rep.FRKpa = s.TpmsFRKpa
		}
		if s.TpmsRLKpa != nil {
			rep.RLKpa = s.TpmsRLKpa
		}
		if s.TpmsRRKpa != nil {
			rep.RRKpa = s.TpmsRRKpa
		}
		if s.OdometerM != nil {
			if odo0 == nil {
				odo0 = s.OdometerM
			}
			odo1 = s.OdometerM
		}
	}
	corners := []*float64{rep.FLKpa, rep.FRKpa, rep.RLKpa, rep.RRKpa}
	vals := []float64{}
	for _, c := range corners {
		if c != nil {
			vals = append(vals, *c)
		}
	}
	if len(vals) > 0 {
		rep.Unknown = false
	}
	if len(vals) == 4 {
		mn, mx := vals[0], vals[0]
		for _, v := range vals[1:] {
			if v < mn {
				mn = v
			}
			if v > mx {
				mx = v
			}
		}
		imb := mx - mn
		rep.ImbalanceKpa = &imb
	}
	if odo0 != nil && odo1 != nil && *odo1 > *odo0 {
		d := *odo1 - *odo0
		rep.DistanceM = &d
	}
	rep.UnderinflFrac = apiscience.UnderinflationFrac(rep.FLKpa, rep.FRKpa, rep.RLKpa, rep.RRKpa, recommendedKpa)
	if rep.UnderinflFrac == nil {
		rep.Missing = append(rep.Missing, "recommended_kpa_or_tpms")
		rep.Missing = dedupeStrings(rep.Missing)
		return rep
	}
	var base *float64
	if twin != nil && twin.Drive != nil && twin.Drive.RollingWh.ValueWh != nil {
		base = twin.Drive.RollingWh.ValueWh
	}
	deficit := apiscience.DistanceWeightedDeficit(samples, recommendedKpa)
	if truncated || (twin != nil && twin.UnknownHours > 0) {
		deficit = nil
	}
	if deficit == nil {
		rep.Missing = append(rep.Missing, "continuous_pressure_speed_coverage")
	}
	if est, lo, hi, ok := apiscience.UnderinflationWh(base, deficit); ok {
		rep.ExtraWh, rep.ExtraModelLow, rep.ExtraModelHigh = &est, &lo, &hi
	} else {
		rep.Missing = append(rep.Missing, "mass_kg_for_rolling_baseline")
	}
	rep.Missing = dedupeStrings(rep.Missing)
	return rep
}
