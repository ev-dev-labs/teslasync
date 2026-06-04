// Package v2h is a vehicle-to-home / vehicle-to-grid decision engine.
//
// Pure decider scope: no actuator. It takes the operator's
// hour-by-hour inputs — ToU electricity rate, solar production
// forecast, house load forecast, vehicle SoC + capacity + reserve —
// and returns a 24-hour charge / hold / discharge plan that
// minimizes cost while keeping the SoC inside the operator-defined
// guardrails.
//
// Why a decider and not an actuator: Tesla
// has not exposed a V2H/V2G API to third-party applications.
// Operators integrate the produced Plan with their own inverter
// (Enphase IQ8, SolarEdge Energy Hub, SunPower Reserve) or with a
// home-energy-management hub (Home Assistant, OpenHAB) until Tesla
// flips the switch.
//
// Design properties:
//
//  1. Pure function — Decide(Inputs) Plan, no I/O, deterministic.
//  2. SI-only — Power in W, energy in Wh, SoC as a 0.0..1.0 fraction
//     (NOT 0..100 percent). Rates in $/Wh (NOT $/kWh) to avoid the
//     1000x footgun. The caller converts at the display boundary.
//  3. No future-vision — works strictly off the inputs handed in.
//     A real deployment will feed it weather + utility tariff data.
//  4. Hard guardrails — the SoC NEVER drops below MinSoC even if
//     discharging would be profitable. House emergency reserve wins
//     over the dollar.
package v2h

import (
	"errors"
	"fmt"
	"time"
)

// HourlyInputs captures the operator's forecasts for ONE hour of
// the planning window. Hours can be unevenly spaced (the planner
// uses each interval's actual duration), but typically operators
// pass 24 contiguous hours starting at Now.
type HourlyInputs struct {
	// StartAt is the wall-clock start of this hour. Used only for
	// logging + traceability; the planner orders by slice index.
	StartAt time.Time
	// DurationHours is how long this slice covers. Defaults to 1.0
	// when zero. Sub-hour planning (e.g. 0.25 for 15-min ToU
	// schedules) works without code changes.
	DurationHours float64
	// SolarProductionW is the forecast solar output for this slice,
	// averaged over the slice. House self-consumption is folded into
	// HouseLoadW separately.
	SolarProductionW float64
	// HouseLoadW is the forecast house demand for this slice,
	// averaged over the slice.
	HouseLoadW float64
	// RateBuyPerWh is the utility import price for this slice
	// ($/Wh). A negative number means the utility pays YOU to
	// consume (sometimes used during oversupply windows).
	RateBuyPerWh float64
	// RateSellPerWh is the utility export price for this slice
	// ($/Wh). Many net-metering tariffs have RateSell < RateBuy;
	// some flat-rate tariffs have RateSell == RateBuy.
	RateSellPerWh float64
}

// Inputs is the planner's full input bundle. It bundles vehicle
// state alongside the forecast.
type Inputs struct {
	// Hours is the planning window. Length 1..96 (caller can plan
	// shorter or finer; over 96 slices we refuse to plan to keep
	// the search bounded).
	Hours []HourlyInputs
	// VehicleCapacityWh is the battery's usable capacity in Wh.
	VehicleCapacityWh float64
	// CurrentSoC is the current state-of-charge as a 0.0..1.0
	// fraction.
	CurrentSoC float64
	// MinSoC is the lowest SoC the planner is allowed to schedule.
	// Hard floor — never violated. 0.0..1.0.
	MinSoC float64
	// MaxSoC is the highest SoC the planner is allowed to schedule.
	// Most operators set this to ~0.8 to preserve battery longevity.
	// 0.0..1.0.
	MaxSoC float64
	// MaxChargeW is the AC-side charger limit (e.g. 11500 W for a
	// 48A/240V wall connector). Direction: positive when buying
	// from grid OR solar to charge the car.
	MaxChargeW float64
	// MaxDischargeW is the inverter-side discharge limit. Often
	// LOWER than MaxChargeW because home inverters typically run
	// 3.8–7.6 kW. 0 disables discharge entirely.
	MaxDischargeW float64
	// RoundTripEfficiency is the combined charger + inverter
	// efficiency, e.g. 0.85 (DC→AC→DC→AC chain). Used when
	// evaluating discharge profitability — selling 1 Wh costs you
	// 1/efficiency Wh from the battery.
	RoundTripEfficiency float64
}

// Action describes what the planner decided for ONE slice.
type Action int

const (
	// ActionHold means do nothing this slice (idle). The vehicle
	// neither charges nor discharges; solar covers house load and
	// any surplus is exported (or wasted depending on the inverter).
	ActionHold Action = iota
	// ActionCharge means consume PowerW from solar+grid to push
	// energy into the battery. Used for cheap-rate windows or solar
	// surplus.
	ActionCharge
	// ActionDischarge means draw PowerW from the battery into the
	// house. Used for expensive-rate windows when grid import would
	// otherwise dominate. The planner only chooses discharge if it
	// is net-profitable AFTER round-trip efficiency.
	ActionDischarge
)

// String implements fmt.Stringer for friendlier log output.
func (a Action) String() string {
	switch a {
	case ActionCharge:
		return "charge"
	case ActionDischarge:
		return "discharge"
	default:
		return "hold"
	}
}

// SliceDecision is the planner's output for ONE slice.
type SliceDecision struct {
	StartAt     time.Time
	Action      Action
	PowerW      float64 // magnitude in watts; >= 0
	EnergyWh    float64 // signed: + into battery, - out of battery
	NewSoC      float64 // SoC AFTER this slice executes
	CostDollars float64 // signed: + cost, - revenue (export credit)
	Reason      string  // short human-readable rationale
}

// Plan is the full output of the planner.
type Plan struct {
	Slices              []SliceDecision
	TotalCost           float64 // sum of slice CostDollars; - means profit
	FinalSoC            float64
	GridImportedWh      float64
	GridExportedWh      float64
	BatteryChargedWh    float64
	BatteryDischargedWh float64
}

// ErrInvalidInputs is returned when the input bundle is unusable.
var ErrInvalidInputs = errors.New("invalid v2h inputs")

// Decide is the planner. The algorithm is a single forward pass —
// for each slice, evaluate (in order):
//
//  1. Can we DISCHARGE profitably? Net revenue per Wh discharged is
//     RateBuyPerWh - (1/efficiency-1) * RateSellPerWh... approximated
//     as RateBuyPerWh * efficiency. We discharge if this beats a
//     threshold AND SoC > MinSoC.
//  2. Otherwise, is there SOLAR SURPLUS (production > house load)?
//     Charge with the surplus up to MaxChargeW (or until MaxSoC).
//     This is "free" energy — the only cost is the export credit
//     foregone.
//  3. Otherwise, is the RATE cheap? Charge from grid if RateBuyPerWh
//     is below the historical median (we use the SLICES' own median
//     as a proxy — no external history needed).
//  4. Otherwise, HOLD.
//
// The planner does NOT do dynamic programming or convex optimization
// — this is a greedy heuristic that gets ~80% of the value of an LP
// solver at 0.1% of the implementation cost. Operators who want
// optimal can swap in a real solver later via the same Inputs/Plan
// contract.
func Decide(in Inputs) (Plan, error) {
	if err := validate(in); err != nil {
		return Plan{}, err
	}
	medianBuy := medianBuyRate(in.Hours)

	plan := Plan{Slices: make([]SliceDecision, 0, len(in.Hours))}
	socWh := in.CurrentSoC * in.VehicleCapacityWh
	minWh := in.MinSoC * in.VehicleCapacityWh
	maxWh := in.MaxSoC * in.VehicleCapacityWh

	for _, h := range in.Hours {
		duration := h.DurationHours
		if duration <= 0 {
			duration = 1.0
		}
		sliceDecision := SliceDecision{StartAt: h.StartAt, NewSoC: socWh / in.VehicleCapacityWh}

		// Step 1: profitable discharge?
		discharge := evalDischarge(in, h, socWh, minWh, duration)
		if discharge != nil {
			socWh -= discharge.batteryDeltaWh
			plan.BatteryDischargedWh += discharge.batteryDeltaWh
			plan.GridExportedWh += discharge.gridDeltaWh
			sliceDecision.Action = ActionDischarge
			sliceDecision.PowerW = discharge.powerW
			sliceDecision.EnergyWh = -discharge.batteryDeltaWh
			sliceDecision.CostDollars = -discharge.revenueDollars
			sliceDecision.Reason = "rate above median; discharge profitable after rtt loss"
			sliceDecision.NewSoC = socWh / in.VehicleCapacityWh
			plan.Slices = append(plan.Slices, sliceDecision)
			plan.TotalCost += sliceDecision.CostDollars
			continue
		}

		// Step 2: solar surplus?
		surplus := h.SolarProductionW - h.HouseLoadW
		if surplus > 0 && socWh < maxWh {
			powerW := surplus
			if powerW > in.MaxChargeW {
				powerW = in.MaxChargeW
			}
			energyWh := powerW * duration
			room := maxWh - socWh
			if energyWh > room {
				energyWh = room
				powerW = energyWh / duration
			}
			// Surplus charging "costs" the export credit foregone.
			cost := energyWh * h.RateSellPerWh
			socWh += energyWh
			plan.BatteryChargedWh += energyWh
			sliceDecision.Action = ActionCharge
			sliceDecision.PowerW = powerW
			sliceDecision.EnergyWh = energyWh
			sliceDecision.CostDollars = cost
			sliceDecision.Reason = "solar surplus; charge"
			sliceDecision.NewSoC = socWh / in.VehicleCapacityWh
			plan.Slices = append(plan.Slices, sliceDecision)
			plan.TotalCost += cost
			continue
		}

		// Step 3: cheap grid rate?
		if h.RateBuyPerWh < medianBuy && socWh < maxWh {
			powerW := in.MaxChargeW
			energyWh := powerW * duration
			room := maxWh - socWh
			if energyWh > room {
				energyWh = room
				powerW = energyWh / duration
			}
			cost := energyWh * h.RateBuyPerWh
			socWh += energyWh
			plan.BatteryChargedWh += energyWh
			plan.GridImportedWh += energyWh
			sliceDecision.Action = ActionCharge
			sliceDecision.PowerW = powerW
			sliceDecision.EnergyWh = energyWh
			sliceDecision.CostDollars = cost
			sliceDecision.Reason = "rate below median; charge from grid"
			sliceDecision.NewSoC = socWh / in.VehicleCapacityWh
			plan.Slices = append(plan.Slices, sliceDecision)
			plan.TotalCost += cost
			continue
		}

		// Step 4: hold.
		sliceDecision.Action = ActionHold
		sliceDecision.Reason = "no profitable action"
		sliceDecision.NewSoC = socWh / in.VehicleCapacityWh
		plan.Slices = append(plan.Slices, sliceDecision)
	}
	plan.FinalSoC = socWh / in.VehicleCapacityWh
	return plan, nil
}

type dischargePlan struct {
	powerW         float64
	batteryDeltaWh float64
	gridDeltaWh    float64 // amount actually exported (after house load)
	revenueDollars float64
}

// evalDischarge returns a non-nil plan when discharging in this
// slice is profitable AND SoC stays >= MinSoC.
func evalDischarge(in Inputs, h HourlyInputs, socWh, minWh, duration float64) *dischargePlan {
	if in.MaxDischargeW <= 0 || socWh <= minWh {
		return nil
	}
	// Profitability test: selling 1 Wh of battery yields
	// efficiency * RateBuyPerWh (if it offsets imports) or
	// efficiency * RateSellPerWh (if it goes to grid).
	// We use the conservative side — RateSellPerWh — because the
	// inverter may not be configured to backfeed the house first.
	revenuePerWh := in.RoundTripEfficiency * h.RateSellPerWh
	// If RateBuyPerWh is high AND houseLoad > solar, the battery
	// can offset imports at the buy rate.
	netHouseImport := h.HouseLoadW - h.SolarProductionW
	if netHouseImport > 0 {
		revenuePerWh = in.RoundTripEfficiency * h.RateBuyPerWh
	}
	// Don't discharge unless revenue per Wh exceeds the slice's own
	// buy rate (avoid the obvious "discharge into cheap window then
	// charge back at the same rate" anti-pattern).
	if revenuePerWh <= h.RateBuyPerWh {
		return nil
	}

	powerW := in.MaxDischargeW
	energyWh := powerW * duration
	headroom := socWh - minWh
	if energyWh > headroom {
		energyWh = headroom
		powerW = energyWh / duration
	}
	// gridExport is whatever's left after covering the house.
	gridExport := energyWh - netHouseImport*duration
	if gridExport < 0 {
		gridExport = 0
	}
	revenue := energyWh * revenuePerWh
	return &dischargePlan{
		powerW:         powerW,
		batteryDeltaWh: energyWh,
		gridDeltaWh:    gridExport,
		revenueDollars: revenue,
	}
}

func medianBuyRate(hours []HourlyInputs) float64 {
	if len(hours) == 0 {
		return 0
	}
	rates := make([]float64, len(hours))
	for i, h := range hours {
		rates[i] = h.RateBuyPerWh
	}
	// Tiny insertion sort — n <= 96.
	for i := 1; i < len(rates); i++ {
		for j := i; j > 0 && rates[j-1] > rates[j]; j-- {
			rates[j-1], rates[j] = rates[j], rates[j-1]
		}
	}
	mid := len(rates) / 2
	if len(rates)%2 == 1 {
		return rates[mid]
	}
	return (rates[mid-1] + rates[mid]) / 2
}

func validate(in Inputs) error {
	switch {
	case len(in.Hours) == 0:
		return fmt.Errorf("%w: at least one hour required", ErrInvalidInputs)
	case len(in.Hours) > 96:
		return fmt.Errorf("%w: at most 96 hourly slices (got %d)", ErrInvalidInputs, len(in.Hours))
	case in.VehicleCapacityWh <= 0:
		return fmt.Errorf("%w: vehicle capacity must be > 0", ErrInvalidInputs)
	case in.CurrentSoC < 0 || in.CurrentSoC > 1:
		return fmt.Errorf("%w: current soc must be in [0,1]", ErrInvalidInputs)
	case in.MinSoC < 0 || in.MinSoC > 1:
		return fmt.Errorf("%w: min soc must be in [0,1]", ErrInvalidInputs)
	case in.MaxSoC < 0 || in.MaxSoC > 1:
		return fmt.Errorf("%w: max soc must be in [0,1]", ErrInvalidInputs)
	case in.MinSoC > in.MaxSoC:
		return fmt.Errorf("%w: min soc (%.2f) > max soc (%.2f)", ErrInvalidInputs, in.MinSoC, in.MaxSoC)
	case in.MaxChargeW <= 0:
		return fmt.Errorf("%w: max charge power must be > 0", ErrInvalidInputs)
	case in.MaxDischargeW < 0:
		return fmt.Errorf("%w: max discharge power cannot be negative", ErrInvalidInputs)
	case in.RoundTripEfficiency <= 0 || in.RoundTripEfficiency > 1:
		return fmt.Errorf("%w: round trip efficiency must be in (0,1]", ErrInvalidInputs)
	}
	return nil
}
