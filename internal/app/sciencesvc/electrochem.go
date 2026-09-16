package sciencesvc

import (
	"math"
	"sort"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	apiscience "github.com/ev-dev-labs/teslasync/internal/science"
)

// defaultNominalPackWh is a labeled default for equivalent-full-cycle
// conversion. It is reported on the payload; never a silent assumption.
const defaultNominalPackWh = 75000.0

// buildElectrochem assembles the flagship report from window samples and
// charge sessions (throughput). Fits use only the latest contiguous
// firmware epoch; previous epochs never become adjacent by filtering.
func buildElectrochem(vehicleID int64, vin string, from, to time.Time, samples []physics.Sample, charges []*chargingmodel.ChargingSession, truncated bool) apiscience.ElectrochemReport {
	rep := apiscience.ElectrochemReport{
		VehicleID: vehicleID, VIN: vin,
		Start: from.UTC(), End: to.UTC(),
		OCVPoints: []apiscience.OCVPoint{}, OCVBins: []apiscience.OCVBin{},
		Hysteresis: []apiscience.HysteresisBin{}, IRPoints: []apiscience.IRPoint{},
		PulseIR:     []apiscience.IRPoint{},
		SignalsUsed: []string{"PackVoltage", "PackCurrent", "Soc", "EnergyRemaining", "ModuleTempMin", "ModuleTempMax", "BrickVoltageMin", "BrickVoltageMax", "Gear", "DetailedChargeState", "Version"},
		Missing:     []string{},
		Truncated:   truncated,
		Honesty:     apiscience.ElectrochemHonesty,
	}
	rep.Missing = append(rep.Missing,
		"cell_voltage_per_cell", "cell_current_per_cell", "battery_inlet_temp",
		"lithium_inventory_signal", "charge_dc_current_steps_below_5A")
	for _, s := range samples {
		if s.ElectricalUnaligned {
			rep.Missing = append(rep.Missing, "asynchronous_voltage_current_excluded_from_dcir")
			break
		}
	}
	rep.FirmwareEpoch = apiscience.DominantFirmware(samples)
	rep.PooledEpochs = false
	rep.Arrhenius = apiscience.ArrheniusFit{Unknown: true, Honesty: apiscience.ArrheniusHonesty}
	rep.Aging = apiscience.AgingSplit{Unknown: true, Honesty: apiscience.AgingHonesty}
	rep.CapacityUnk = true

	sorted := append([]physics.Sample(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })
	if len(sorted) > 0 {
		epoch := sorted[len(sorted)-1].Firmware
		first := len(sorted) - 1
		for first > 0 && sorted[first-1].Firmware == epoch {
			first--
		}
		if first > 0 {
			rep.Missing = append(rep.Missing, "earlier_firmware_epochs_excluded")
		}
		sorted = sorted[first:]
		rep.FirmwareEpoch = epoch
		if epoch == "" {
			rep.FirmwareEpoch = "unknown"
		}
	}

	// Rest OCV + hysteresis.
	windows := apiscience.FindRest(sorted)
	brickByTime := map[time.Time][2]float64{}
	for _, s := range sorted {
		if s.BrickMinV != nil && s.BrickMaxV != nil {
			brickByTime[s.At] = [2]float64{*s.BrickMinV, *s.BrickMaxV}
		}
	}
	for _, w := range windows {
		p := apiscience.OCVPoint{
			At: w.End.UTC(), OCVPackV: w.V, SocPct: w.SocPct,
			TempC: w.TempC, Direction: w.Direction, DwellS: w.DwellS, EnergyWh: w.EnergyWh,
		}
		if b, ok := brickByTime[w.End]; ok {
			spread := (b[1] - b[0]) * 1000
			p.BrickSpreadMV = &spread
		}
		rep.OCVPoints = append(rep.OCVPoints, p)
	}
	rep.OCVBins = apiscience.OCVBins(rep.OCVPoints)
	rep.Hysteresis = apiscience.Hysteresis(rep.OCVPoints)

	// DCIR: split drive vs charge context by charge language.
	isCharging := func(s physics.Sample) bool {
		return s.DetailedChargeState == "Charging" || s.DetailedChargeState == "Starting" ||
			s.ChargeState == "Charging" || s.ChargeState == "Starting"
	}
	for i := 1; i < len(sorted); i++ {
		if isCharging(sorted[i-1]) != isCharging(sorted[i]) {
			continue
		}
		context := "drive_step"
		if isCharging(sorted[i]) {
			context = "charge_step"
		}
		points := apiscience.DCIR(sorted[i-1:i+1], context)
		rep.IRPoints = append(rep.IRPoints, points...)
		if context == "charge_step" {
			rep.PulseIR = append(rep.PulseIR, points...)
		}
	}
	rep.Arrhenius = apiscience.Arrhenius(rep.IRPoints)

	// Aging: throughput from sessions + rest hours + capacity proxy slope.
	var throughput float64
	throughputKnown := !truncated && len(charges) > 0
	for _, c := range charges {
		if c == nil || c.TotalEnergyAddedWh == nil || c.EndedAt == nil ||
			c.StartedAt.Before(from) || c.EndedAt.After(to) || c.EndedAt.Before(c.StartedAt) {
			throughputKnown = false
			continue
		}
		energy := *c.TotalEnergyAddedWh
		if energy < 0 || math.IsNaN(energy) || math.IsInf(energy, 0) {
			throughputKnown = false
			continue
		}
		throughput += energy
	}
	var restH, hiSocH float64
	for _, w := range windows {
		h := w.DwellS / 3600
		restH += h
		if w.SocPct > 80 {
			hiSocH += h
		}
	}
	aging := apiscience.AgingSplit{
		RestHours: restH, HighSocRestHours: hiSocH,
		Unknown: true, Honesty: apiscience.AgingHonesty,
	}
	if throughputKnown {
		aging.ThroughputWh = &throughput
		cycles := throughput / defaultNominalPackWh
		aging.EquivFullCycles = &cycles
	} else {
		rep.Missing = append(rep.Missing, "complete_in_window_charging_session_energy")
	}
	aging.NominalPackWh = defaultNominalPackWh
	aging.NominalPackSource = "assumed_reference_not_vehicle_capacity"
	if slope, lo, hi, n, rmse, ok := apiscience.CapacityProxy(rep.OCVPoints); ok {
		aging.ProxySlopeWhPerD, aging.ProxyCI95Low, aging.ProxyCI95High = &slope, &lo, &hi
		aging.ProxyN = n
		aging.HoldoutRMSEWh = rmse
		aging.Unknown = false
		if len(rep.OCVPoints) > 0 {
			last := rep.OCVPoints[len(rep.OCVPoints)-1]
			if last.EnergyWh != nil && last.SocPct > 1 {
				proxy := *last.EnergyWh / (last.SocPct / 100)
				rep.CapacityProxy = &proxy
				rep.CapacityUnk = false
			}
		}
	}
	rep.Aging = aging
	rep.Missing = dedupeStrings(rep.Missing)
	return rep
}

func dedupeStrings(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
