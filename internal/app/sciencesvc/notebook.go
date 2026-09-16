package sciencesvc

import (
	"time"

	apiscience "github.com/ev-dev-labs/teslasync/internal/science"
)

// notebookInputs carries the already-built domain reports.
type notebookInputs struct {
	Electrochem apiscience.ElectrochemReport
	Thermal     apiscience.ThermalReport
	Weather     apiscience.WeatherReport
	Tires       apiscience.TireReport
}

// buildNotebook turns every fit into a notebook row. Unknown fits still
// produce rows (unknown=true) so the notebook records what was attempted.
func buildNotebook(vehicleID int64, vin string, from, to time.Time, in notebookInputs) apiscience.Notebook {
	nb := apiscience.Notebook{
		VehicleID: vehicleID, VIN: vin,
		Start: from.UTC(), End: to.UTC(),
		Entries: []apiscience.NotebookEntry{},
		Honesty: apiscience.NotebookHonesty,
	}
	e := in.Electrochem
	nb.Entries = append(nb.Entries,
		ocvEntry(vehicleID, vin, from, to, e),
		hysteresisEntry(vehicleID, vin, from, to, e),
		dcirEntry(vehicleID, vin, from, to, e),
		arrheniusEntry(vehicleID, vin, from, to, e),
		agingEntry(vehicleID, vin, from, to, e),
	)
	if len(in.Thermal.Fits) == 0 {
		nb.Entries = append(nb.Entries, thermalEntry(vehicleID, vin, from, to, apiscience.ThermalFit{Kind: "pack_cooldown", Unknown: true, SolarUnk: true}))
	}
	for _, f := range in.Thermal.Fits {
		nb.Entries = append(nb.Entries, thermalEntry(vehicleID, vin, from, to, f))
	}
	nb.Entries = append(nb.Entries,
		weatherEntry(vehicleID, vin, from, to, in.Weather),
		tireEntry(vehicleID, vin, from, to, in.Tires),
	)
	return nb
}

func ocvEntry(vehicleID int64, vin string, from, to time.Time, e apiscience.ElectrochemReport) apiscience.NotebookEntry {
	known := 0
	for _, b := range e.OCVBins {
		if !b.Unknown {
			known++
		}
	}
	en := apiscience.NewEntry(apiscience.EntryID("electrochem.ocv", vehicleID, from), "electrochem",
		"Rest voltage maps SOC per temp bin (pack-equivalent OCV).", vehicleID, vin, from, to, e.FirmwareEpoch, len(e.OCVPoints), "rest_ocv_binned")
	en.Parameters = map[string]any{"bins": len(e.OCVBins), "bins_known": known, "min_n_per_bin": apiscience.OCVBinMinN}
	en.SignalsUsed = e.SignalsUsed
	en.Missing = e.Missing
	en.Honesty = apiscience.ElectrochemHonesty
	en.Unknown = known == 0
	return en
}

func hysteresisEntry(vehicleID int64, vin string, from, to time.Time, e apiscience.ElectrochemReport) apiscience.NotebookEntry {
	en := apiscience.NewEntry(apiscience.EntryID("electrochem.hysteresis", vehicleID, from), "electrochem",
		"Charge-rest voltage exceeds discharge-rest voltage at equal SOC.", vehicleID, vin, from, to, e.FirmwareEpoch, len(e.OCVPoints), "hysteresis_soc_bins")
	en.Parameters = map[string]any{"bins": len(e.Hysteresis)}
	en.SignalsUsed = e.SignalsUsed
	en.Missing = e.Missing
	en.Honesty = apiscience.ElectrochemHonesty
	en.Unknown = true
	for _, b := range e.Hysteresis {
		if !b.Unknown {
			en.Unknown = false
		}
	}
	return en
}

func dcirEntry(vehicleID int64, vin string, from, to time.Time, e apiscience.ElectrochemReport) apiscience.NotebookEntry {
	en := apiscience.NewEntry(apiscience.EntryID("electrochem.dcir", vehicleID, from), "electrochem",
		"Apparent pack resistance from current steps over 1-10 s; not isolated ohmic resistance.", vehicleID, vin, from, to, e.FirmwareEpoch, len(e.IRPoints), "dcir_steps")
	en.Parameters = map[string]any{"ohmic_s": [2]float64{apiscience.IROhmicLoS, apiscience.IROhmicHiS}, "min_step_a": apiscience.IRStepMinA, "pulse_n": len(e.PulseIR)}
	en.SignalsUsed = e.SignalsUsed
	en.Missing = e.Missing
	en.Honesty = apiscience.ElectrochemHonesty
	en.Unknown = len(e.IRPoints) == 0
	return en
}

func arrheniusEntry(vehicleID int64, vin string, from, to time.Time, e apiscience.ElectrochemReport) apiscience.NotebookEntry {
	a := e.Arrhenius
	en := apiscience.NewEntry(apiscience.EntryID("electrochem.arrhenius", vehicleID, from), "electrochem",
		"ln(IR_pack) is linear in 1/T with activation energy Ea.", vehicleID, vin, from, to, e.FirmwareEpoch, a.N, "arrhenius_ln_ir_vs_inv_t")
	en.Parameters = map[string]any{"ea_j_per_mol": a.EaJPerMol, "temp_bins": a.TempBins, "temp_span_c": a.TempSpanC, "r2": a.R2}
	en.CI = map[string]any{"ea_ci95_low": a.EaCI95Low, "ea_ci95_high": a.EaCI95High}
	en.CIMethod = apiscience.CIStudentT
	en.SignalsUsed = e.SignalsUsed
	en.Missing = e.Missing
	en.Honesty = apiscience.ArrheniusHonesty
	en.Unknown = a.Unknown
	return en
}

func agingEntry(vehicleID int64, vin string, from, to time.Time, e apiscience.ElectrochemReport) apiscience.NotebookEntry {
	a := e.Aging
	en := apiscience.NewEntry(apiscience.EntryID("electrochem.aging", vehicleID, from), "electrochem",
		"Capacity proxy trends over time; throughput and rest exposure do not identify cycle/calendar aging.", vehicleID, vin, from, to, e.FirmwareEpoch, a.ProxyN, "capacity_proxy_slope_holdout")
	en.Parameters = map[string]any{"throughput_wh": a.ThroughputWh, "equiv_full_cycles": a.EquivFullCycles, "rest_hours": a.RestHours, "high_soc_rest_hours": a.HighSocRestHours, "slope_wh_per_day": a.ProxySlopeWhPerD, "capacity_proxy_wh": e.CapacityProxy}
	en.CI = map[string]any{"slope_ci95_low": a.ProxyCI95Low, "slope_ci95_high": a.ProxyCI95High}
	en.CIMethod = apiscience.CIStudentT
	frac := 0.2
	en.HoldoutFrac = &frac
	en.HoldoutRMSE = a.HoldoutRMSEWh
	en.SignalsUsed = e.SignalsUsed
	en.Missing = e.Missing
	en.Honesty = apiscience.AgingHonesty
	en.Unknown = a.Unknown
	return en
}

func thermalEntry(vehicleID int64, vin string, from, to time.Time, f apiscience.ThermalFit) apiscience.NotebookEntry {
	if !f.Start.IsZero() && !f.End.IsZero() {
		from, to = f.Start, f.End
	}
	en := apiscience.NewEntry(apiscience.EntryID("thermal."+f.Kind, vehicleID, from), "thermal",
		"Lumped heat capacity cools exponentially toward ambient with tau.", vehicleID, vin, from, to, "", f.N, "loglinear_cooldown")
	en.Parameters = map[string]any{"kind": f.Kind, "tau_s": f.TauS, "t_inf_c": f.TInfC, "r2": f.R2}
	en.CI = map[string]any{"tau_ci95_low": f.TauCI95Low, "tau_ci95_high": f.TauCI95High}
	en.CIMethod = apiscience.CIStudentT
	en.ResidualRMSE = f.ResidualC
	en.SignalsUsed = []string{"ModuleTempMax", "InsideTemp", "OutsideTemp", "SentryMode"}
	en.Missing = []string{"battery_inlet_temp", "solar_irradiance"}
	en.Honesty = apiscience.ThermalHonesty
	en.Unknown = f.Unknown
	return en
}

func weatherEntry(vehicleID int64, vin string, from, to time.Time, w apiscience.WeatherReport) apiscience.NotebookEntry {
	en := apiscience.NewEntry(apiscience.EntryID("weather.coupling", vehicleID, from), "weather",
		"Twin drive residual correlates with air density and wind at drive start.", vehicleID, vin, from, to, "", len(w.Points), "pearson_residual_vs_weather")
	en.Parameters = map[string]any{"density_r": w.DensityR, "wind_r": w.WindR, "rain_n": w.RainN, "dry_n": w.DryN}
	en.SignalsUsed = w.SignalsUsed
	en.Missing = w.Missing
	en.Honesty = apiscience.WeatherHonesty
	en.Unknown = w.WeatherUnk || (w.DensityR == nil && w.WindR == nil)
	return en
}

func tireEntry(vehicleID int64, vin string, from, to time.Time, t apiscience.TireReport) apiscience.NotebookEntry {
	n := 0
	for _, c := range []*float64{t.FLKpa, t.FRKpa, t.RLKpa, t.RRKpa} {
		if c != nil {
			n++
		}
	}
	en := apiscience.NewEntry(apiscience.EntryID("tires.underinflation", vehicleID, from), "tires",
		"Underinflation adds rolling energy per the labeled linear model.", vehicleID, vin, from, to, "", n, "underinflation_linear_model")
	en.Parameters = map[string]any{"imbalance_kpa": t.ImbalanceKpa, "recommended_kpa": t.RecommendedKpa, "underinflation_frac": t.UnderinflFrac, "extra_wh": t.ExtraWh, "distance_m": t.DistanceM, "gain": apiscience.UnderinflationGain}
	en.Parameters["extra_model_low"] = t.ExtraModelLow
	en.Parameters["extra_model_high"] = t.ExtraModelHigh
	en.SignalsUsed = t.SignalsUsed
	en.Missing = t.Missing
	en.Honesty = apiscience.TireHonesty
	en.Unknown = t.Unknown
	return en
}
