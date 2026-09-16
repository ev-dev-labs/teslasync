package physics

import (
	"math"
	"sort"
	"time"
)

// Solve reconstructs the energy/force ledger for one window. It never
// invents telemetry: terms without inputs are unknown (nil), never zero.
// Residual absorbs unknown predicted terms and is disclosed via Missing.
func Solve(w Window) *Ledger {
	p := w.Params
	if p.UnknownGapS <= 0 {
		p.UnknownGapS = DefaultUnknownGapS
	}
	if p.RhoAirKgM3 <= 0 {
		p.RhoAirKgM3 = DefaultAirDensityKgM3
	}
	if p.DrivetrainEff <= 0 || p.DrivetrainEff > 1 {
		p.DrivetrainEff = DefaultDrivetrainEff
	}

	samples := append([]Sample(nil), w.Samples...)
	sort.Slice(samples, func(i, j int) bool { return samples[i].At.Before(samples[j].At) })

	acc := newAccumulator(p)
	var prev *Sample
	var hvacHold, firmwareHold *Sample
	for i := range samples {
		cur := &samples[i]
		if cur.At.Before(w.Start) || cur.At.After(w.End) {
			continue
		}
		if prev != nil {
			dt := cur.At.Sub(prev.At).Seconds()
			if dt <= 0 {
				prev = cur
				continue
			}
			if dt > p.UnknownGapS {
				acc.gap(prev.At, cur.At, "gap")
				prev = cur
				hvacHold = cur
				firmwareHold = cur
				continue
			}
			acc.interval(*prev, *cur, dt, hvacHold, firmwareHold)
		} else {
			acc.rangeObserve(*cur)
			acc.tireObserve(*cur)
			acc.thermalObserve(*cur, 0, false)
			acc.chargeObserve(*cur, *cur)
			if cur.At.After(w.Start) {
				acc.gap(w.Start, cur.At, "no_samples")
			}
		}
		prev = cur
		if cur.HvacPowerW != nil || cur.Preconditioning {
			hvacHold = cur
		}
		if cur.Firmware != "" {
			firmwareHold = cur
		}
	}
	if prev != nil && w.End.After(prev.At) {
		acc.gap(prev.At, w.End, "no_samples")
	}
	if prev == nil && w.End.After(w.Start) {
		acc.gap(w.Start, w.End, "no_samples")
	}
	_ = hvacHold
	_ = firmwareHold

	return acc.ledger(w)
}

// accumulator folds intervals into per-term totals.
type accumulator struct {
	p Params

	// Measured pack energy (discharge-positive Wh).
	measuredWh         float64
	measuredHave       bool
	usedPackVI         bool
	usedEnergyD        bool
	measuredMissing    bool
	speedMissing       bool
	positiveWorkLossWh float64
	chargeEnergyWh     float64
	chargeEnergyHave   bool

	// Predicted terms (Wh).
	aeroWh, rollingWh, gradeWh, inertialWh, accessoryWh float64
	aeroHave, rollingHave, gradeHave, accessoryHave     bool
	gradeBlocked, accessoryBlocked                      bool
	hvacSeen                                            bool

	// Regen / friction (Wh).
	regenWh      float64
	regenHave    bool
	frictionWh   float64
	frictionHave bool

	// Charge terms.
	wallWh, precondWh     float64
	wallHave, precondHave bool
	acSeen, dcSeen        bool

	// Park terms.
	parkS               float64
	parkHave            bool
	parkEnergyWh        float64
	parkEnergyHave      bool
	parkAccessoryActive bool
	parkContradiction   bool
	gearSeen            bool

	// Thermal pairs for correlation.
	thermT                                                      []float64
	thermP                                                      []float64
	packMin, packMax, packStart, packEnd, insideSum, outsideSum *float64
	insideN, outsideN                                           int
	packSeen                                                    bool

	// Range endpoints.
	firstOdo, lastOdo, firstEnergy, lastEnergy *float64
	rated, est, ideal                          *float64
	energyLatest                               *float64

	// Tires latest.
	fl, fr, rl, rr *float64

	// Epochs.
	epochs map[string]*epochAcc

	// Charge language edges.
	completeAt, unplugAt *time.Time
	lastChargeState      string
	chargeSeen           bool
	pluggedComplete      bool

	points []DynamicsPoint
	gaps   []UnknownInterval

	missing map[string]bool
}

type epochAcc struct {
	measured, mech, hvac float64
	have                 bool
	count                int
}

func newAccumulator(p Params) *accumulator {
	return &accumulator{
		p:       p,
		epochs:  map[string]*epochAcc{},
		missing: map[string]bool{},
	}
}

func (a *accumulator) gap(from, to time.Time, reason string) {
	if !to.After(from) {
		return
	}
	if to.Sub(from) <= time.Nanosecond {
		return
	}
	a.gaps = append(a.gaps, UnknownInterval{
		StartedAt: from.UTC(),
		EndedAt:   to.UTC(),
		DurationS: to.Sub(from).Seconds(),
		Reason:    reason,
	})
}

// packPowerW returns discharge-positive pack power for a sample.
// Tesla PackCurrent is charge-positive, so discharge power negates V*I.
func packPowerW(s Sample) (float64, bool) {
	if s.PackVoltageV == nil || s.PackCurrentA == nil {
		return 0, false
	}
	return -(*s.PackVoltageV) * (*s.PackCurrentA), true
}

func fptr(v float64) *float64 { v2 := v; return &v2 }

func (a *accumulator) interval(prev, cur Sample, dt float64, hvacHold, fwHold *Sample) {
	massKnown := a.p.MassKg != nil
	var mass float64
	if massKnown {
		mass = *a.p.MassKg
	}

	// Pack power: prefer V*I trapezoid, else energy-derivative step.
	p0, ok0 := packPowerW(prev)
	p1, ok1 := packPowerW(cur)
	var pAvg float64
	var pHave bool
	var methodVI bool
	if ok0 && ok1 {
		pAvg = (p0 + p1) / 2
		pHave = true
		methodVI = true
	} else if prev.EnergyRemainingWh != nil && cur.EnergyRemainingWh != nil {
		pAvg = -(*cur.EnergyRemainingWh - *prev.EnergyRemainingWh) / dt * 3600
		pHave = true
	}
	dtH := dt / 3600
	chargeState := prev.DetailedChargeState
	if chargeState == "" {
		chargeState = prev.ChargeState
	}
	if pHave && (chargeState == "Charging" || chargeState == "Starting") {
		a.chargeEnergyWh -= pAvg * dtH
		a.chargeEnergyHave = true
	}
	if pHave {
		a.measuredWh += pAvg * dtH
		a.measuredHave = true
		if methodVI {
			a.usedPackVI = true
		} else {
			a.usedEnergyD = true
		}
	} else {
		a.measuredMissing = true
		a.missing["PackVoltage/PackCurrent/EnergyRemaining"] = true
	}

	// Speed trapezoid for dissipative terms.
	v0, v1 := 0.0, 0.0
	vHave := prev.SpeedMps != nil && cur.SpeedMps != nil
	if vHave {
		v0, v1 = math.Abs(*prev.SpeedMps), math.Abs(*cur.SpeedMps)
	}
	if vHave {
		before := a.aeroWh + a.rollingWh + a.gradeWh + a.inertialWh
		vAvg := (v0 + v1) / 2
		v3 := (v0*v0*v0 + v1*v1*v1) / 2
		a.aeroWh += 0.5 * a.p.RhoAirKgM3 * a.p.CdAM2 * v3 * dt / 3600
		a.aeroHave = true
		if massKnown {
			a.rollingWh += a.p.Crr * mass * GravityMps2 * vAvg * dt / 3600
			a.rollingHave = true
			a.inertialWh += 0.5 * mass * (v1*v1 - v0*v0) / 3600
		} else {
			a.missing["mass_kg"] = true
		}
		// Grade needs both elevations while moving.
		moving := (math.Abs(v0)+math.Abs(v1))/2 > WalkingSpeedMps
		if moving {
			if prev.ElevationM != nil && cur.ElevationM != nil && massKnown {
				a.gradeWh += mass * GravityMps2 * (*cur.ElevationM - *prev.ElevationM) / 3600
				a.gradeHave = true
			} else {
				a.gradeBlocked = true
				if !massKnown {
					a.missing["mass_kg"] = true
				} else {
					a.missing["elevation"] = true
				}
			}
		}
		work := a.aeroWh + a.rollingWh + a.gradeWh + a.inertialWh - before
		if work > 0 {
			a.positiveWorkLossWh += work * (1/a.p.DrivetrainEff - 1)
		}
	} else {
		a.speedMissing = true
		a.missing["VehicleSpeed"] = true
	}

	// Accessory: step-hold on last-known HVAC power.
	hvacW, hvacOK := holdHvac(hvacHold, prev, cur)
	if hvacOK {
		a.accessoryWh += hvacW * dtH
		a.accessoryHave = true
		a.hvacSeen = true
	} else {
		a.accessoryBlocked = true
		a.missing["HvacPower"] = true
	}

	// Regen: negative (absorbing) pack power while moving.
	if pHave && vHave && (math.Abs(v0)+math.Abs(v1))/2 > WalkingSpeedMps {
		neg := 0.0
		n := 0
		if ok0 && p0 < 0 {
			neg += p0
			n++
		} else if ok0 {
			n++
		}
		if ok1 && p1 < 0 {
			neg += p1
			n++
		} else if ok1 {
			n++
		}
		if !ok0 || !ok1 {
			// Energy-derivative path: single average over the interval.
			if pAvg < 0 {
				neg = 2 * pAvg
			}
			n = 2
		}
		if n == 2 {
			a.regenWh += -neg / 2 * dtH
			a.regenHave = true
		}
	}

	// Dynamics point + friction residual (needs mass, speed, power).
	a.dynamicsPoint(prev, cur, dt, pAvg, pHave, mass, massKnown)

	// Charge wall + precondition.
	wallW := 0.0
	wallOK := false
	if prev.ACPowerW != nil && cur.ACPowerW != nil && (*prev.ACPowerW > 0 || *cur.ACPowerW > 0) {
		wallW = (*prev.ACPowerW + *cur.ACPowerW) / 2
		wallOK = true
		a.acSeen = true
	} else if prev.DCPowerW != nil && cur.DCPowerW != nil {
		wallW = (*prev.DCPowerW + *cur.DCPowerW) / 2
		wallOK = true
		a.dcSeen = true
	}
	if wallOK {
		a.wallWh += wallW * dtH
		a.wallHave = true
	}
	if cur.Preconditioning || prev.Preconditioning {
		if hvacOK {
			a.precondWh += hvacW * dtH
			a.precondHave = true
		} else {
			a.missing["HvacPower(precondition)"] = true
		}
	}

	// Park accumulation: Gear=P frames only.
	if cur.Gear != "" || prev.Gear != "" {
		a.gearSeen = true
	}
	if cur.Gear == "P" && prev.Gear == "P" {
		a.parkS += dt
		a.parkHave = true
		if pHave {
			a.parkEnergyWh += pAvg * dtH
			a.parkEnergyHave = true
		}
		if cur.SentryOn || cur.CabinOverheatOn || cur.Preconditioning || cur.ClimateKeeper {
			a.parkAccessoryActive = true
		}
	}
	// Contradiction: Gear=P with speed above walking pace.
	for _, s := range []Sample{prev, cur} {
		if s.Gear == "P" && s.SpeedMps != nil && *s.SpeedMps > WalkingSpeedMps {
			a.parkContradiction = true
		}
	}

	// Thermal observations.
	a.thermalObserve(cur, pAvg, pHave)

	// Range / tire latest.
	a.rangeObserve(cur)
	a.tireObserve(cur)

	// Charge language edges.
	a.chargeObserve(prev, cur)

	// Epoch split by firmware (step-hold).
	fw := ""
	if fwHold != nil {
		fw = fwHold.Firmware
	}
	if fw == "" {
		fw = cur.Firmware
	}
	if fw == "" {
		fw = "unknown"
	}
	ep := a.epochs[fw]
	if ep == nil {
		ep = &epochAcc{}
		a.epochs[fw] = ep
	}
	ep.count++
	if pHave {
		ep.measured += pAvg * dtH
		ep.have = true
		mech, hvac := a.intervalPredicted(prev, cur, dt, hvacW, hvacOK, mass, massKnown)
		ep.mech += mech
		ep.hvac += hvac
	}
}

// intervalPredicted recomputes the known predicted terms for one interval,
// split into mechanical work and accessory so epochs can apply the same
// drivetrain-loss model as the window totals.
func (a *accumulator) intervalPredicted(prev, cur Sample, dt float64, hvacW float64, hvacOK bool, mass float64, massKnown bool) (mech, hvac float64) {
	if prev.SpeedMps != nil && cur.SpeedMps != nil {
		v0, v1 := *prev.SpeedMps, *cur.SpeedMps
		vAvg := (v0 + v1) / 2
		v3 := (v0*v0*v0 + v1*v1*v1) / 2
		mech += 0.5 * a.p.RhoAirKgM3 * a.p.CdAM2 * v3 * dt / 3600
		if massKnown {
			mech += a.p.Crr * mass * GravityMps2 * vAvg * dt / 3600
			mech += 0.5 * mass * (v1*v1 - v0*v0) / 3600
			if prev.ElevationM != nil && cur.ElevationM != nil {
				mech += mass * GravityMps2 * (*cur.ElevationM - *prev.ElevationM) / 3600
			}
		}
	}
	if hvacOK {
		hvac += hvacW * dt / 3600
	}
	return mech, hvac
}

// holdHvac returns the step-hold HVAC power for an interval.
func holdHvac(hold *Sample, prev, cur Sample) (float64, bool) {
	if prev.HvacPowerW != nil {
		return *prev.HvacPowerW, true
	}
	if hold != nil && hold.HvacPowerW != nil {
		return *hold.HvacPowerW, true
	}
	// Preconditioning flag without a power signal is not a number.
	return 0, false
}

func (a *accumulator) dynamicsPoint(prev, cur Sample, dt float64, pAvg float64, pHave bool, mass float64, massKnown bool) {
	pt := DynamicsPoint{At: cur.At.UTC(), Unknown: true}
	if cur.SpeedMps != nil {
		pt.SpeedMps = cur.SpeedMps
	}
	if prev.SpeedMps != nil && cur.SpeedMps != nil {
		accel := (*cur.SpeedMps - *prev.SpeedMps) / dt
		pt.AccelMps2 = fptr(accel)
		if massKnown {
			force := mass * accel
			pt.ForceLongN = fptr(force)
			pt.PowerMechW = fptr(force * *cur.SpeedMps)
		} else {
			a.missing["mass_kg"] = true
		}
	}
	if pHave {
		p := pAvg
		pt.PowerPackW = &p
	}
	// Friction residual during deceleration.
	if pt.AccelMps2 != nil && *pt.AccelMps2 < 0 && cur.SpeedMps != nil && *cur.SpeedMps > WalkingSpeedMps && massKnown && pHave && prev.ElevationM != nil && cur.ElevationM != nil {
		speed := (*prev.SpeedMps + *cur.SpeedMps) / 2
		need := -mass * *pt.AccelMps2 * speed
		regen := 0.0
		if pAvg < 0 {
			regen = -pAvg / a.p.DrivetrainEff
		}
		v := speed
		diss := 0.5*a.p.RhoAirKgM3*a.p.CdAM2*v*v*v + a.p.Crr*mass*GravityMps2*v
		grade := mass * GravityMps2 * (*cur.ElevationM - *prev.ElevationM) / dt
		friction := need - regen - diss - grade
		if friction < 0 {
			friction = 0
		}
		pt.FrictionBrakeW = fptr(friction)
		pt.Unknown = false
		a.frictionWh += friction * dt / 3600
		a.frictionHave = true
	} else if pt.AccelMps2 != nil && pt.PowerPackW != nil && massKnown {
		pt.Unknown = false
	}
	a.points = append(a.points, pt)
}

func (a *accumulator) thermalObserve(cur Sample, pAvg float64, pHave bool) {
	if cur.PackTempMaxC != nil {
		t := *cur.PackTempMaxC
		if a.packMax == nil || t > *a.packMax {
			a.packMax = fptr(t)
		}
		if a.packMin == nil || t < *a.packMin {
			a.packMin = fptr(t)
		}
		if a.packStart == nil {
			a.packStart = fptr(t)
		}
		a.packEnd = fptr(t)
		a.packSeen = true
		if pHave {
			a.thermT = append(a.thermT, t)
			a.thermP = append(a.thermP, math.Abs(pAvg))
		}
	}
	if cur.PackTempMinC != nil {
		t := *cur.PackTempMinC
		if a.packMin == nil || t < *a.packMin {
			a.packMin = fptr(t)
		}
		a.packSeen = true
	}
	if cur.InsideTempC != nil {
		if a.insideSum == nil {
			a.insideSum = fptr(0)
		}
		*a.insideSum += *cur.InsideTempC
		a.insideN++
	}
	if cur.OutsideTempC != nil {
		if a.outsideSum == nil {
			a.outsideSum = fptr(0)
		}
		*a.outsideSum += *cur.OutsideTempC
		a.outsideN++
	}
}

func (a *accumulator) rangeObserve(cur Sample) {
	if cur.OdometerM != nil {
		if a.firstOdo == nil {
			a.firstOdo = cur.OdometerM
		}
		a.lastOdo = cur.OdometerM
	}
	if cur.EnergyRemainingWh != nil {
		if a.firstEnergy == nil {
			a.firstEnergy = cur.EnergyRemainingWh
		}
		a.lastEnergy = cur.EnergyRemainingWh
		a.energyLatest = cur.EnergyRemainingWh
	}
	if cur.RatedRangeM != nil {
		a.rated = cur.RatedRangeM
	}
	if cur.EstRangeM != nil {
		a.est = cur.EstRangeM
	}
	if cur.IdealRangeM != nil {
		a.ideal = cur.IdealRangeM
	}
}

func (a *accumulator) tireObserve(cur Sample) {
	if cur.TpmsFLKpa != nil {
		a.fl = cur.TpmsFLKpa
	}
	if cur.TpmsFRKpa != nil {
		a.fr = cur.TpmsFRKpa
	}
	if cur.TpmsRLKpa != nil {
		a.rl = cur.TpmsRLKpa
	}
	if cur.TpmsRRKpa != nil {
		a.rr = cur.TpmsRRKpa
	}
}

func (a *accumulator) chargeObserve(prev, cur Sample) {
	state := cur.DetailedChargeState
	if state == "" {
		state = cur.ChargeState
	}
	if state != "" {
		a.chargeSeen = true
	}
	if state == "Complete" && a.completeAt == nil {
		t := cur.At.UTC()
		a.completeAt = &t
	}
	if state == "Complete" && cur.ChargePortLatch == "Engaged" {
		a.pluggedComplete = true
	}
	if a.completeAt != nil && a.unplugAt == nil {
		if state == "Disconnected" {
			t := cur.At.UTC()
			a.unplugAt = &t
		}
	}
	a.lastChargeState = state
}

func (a *accumulator) ledger(w Window) *Ledger {
	missing := make([]string, 0, len(a.missing))
	for k := range a.missing {
		missing = append(missing, k)
	}
	sort.Strings(missing)

	unknownHours := 0.0
	for _, g := range a.gaps {
		unknownHours += g.DurationS / 3600
	}

	out := &Ledger{
		VehicleID:      w.VehicleID,
		Kind:           w.Kind,
		Start:          w.Start.UTC(),
		End:            w.End.UTC(),
		Unknown:        a.gaps,
		UnknownHours:   unknownHours,
		MissingSignals: missing,
		Honesty:        LedgerHonesty,
	}
	if out.Unknown == nil {
		out.Unknown = []UnknownInterval{}
	}

	out.Dynamics = a.dynamicsLedger()
	out.Drive = a.driveLedger(w)
	out.Charge = a.chargeLedger(w)
	out.Park = a.parkLedger()
	out.Thermal = a.thermalLedger()
	out.Range = a.rangeLedger(w)
	out.Tires = a.tireLedger()
	out.Epochs = a.epochLedgers()
	out.BlackBox = a.blackBox(w.End)

	contra := []string{}
	if a.parkContradiction {
		contra = append(contra, "gear_P_with_speed")
	}
	if len(contra) > 0 {
		out.Contradictions = contra
	}
	return out
}

func (a *accumulator) dynamicsLedger() *LongitudinalDynamics {
	d := &LongitudinalDynamics{
		Points:     a.points,
		MassSource: a.p.MassSource,
		Unknown:    true,
		Honesty:    RegenHonesty,
	}
	if d.Points == nil {
		d.Points = []DynamicsPoint{}
	}
	if a.p.MassKg != nil {
		d.MassKg = a.p.MassKg
	} else {
		d.Missing = append(d.Missing, "mass_kg")
	}
	if a.regenHave {
		d.RegenWh = fptr(a.regenWh)
	} else {
		d.Missing = append(d.Missing, "PackVoltage/PackCurrent")
	}
	if a.frictionHave {
		d.FrictionWh = fptr(a.frictionWh)
	}
	for _, pt := range a.points {
		if !pt.Unknown {
			d.Unknown = false
			break
		}
	}
	if len(a.points) == 0 {
		d.Missing = append(d.Missing, "VehicleSpeed")
	}
	return d
}

func (a *accumulator) driveLedger(w Window) *DriveLedger {
	d := &DriveLedger{Honesty: DriveHonesty}
	if a.measuredHave {
		method := "pack_vi_trapezoid"
		if a.usedEnergyD && !a.usedPackVI {
			method = "energy_derivative"
		} else if a.usedEnergyD && a.usedPackVI {
			method = "mixed_pack_vi_and_energy_derivative"
		}
		d.MeasuredWh = Term{ValueWh: fptr(a.measuredWh), Method: method}
	} else {
		d.MeasuredWh = Term{Method: "unknown", Unknown: true, Missing: []string{"PackVoltage", "PackCurrent", "EnergyRemaining"}}
	}
	if w.Kind == "drive" && w.SessionEnergyWh != nil {
		d.SessionWh = w.SessionEnergyWh
		if d.MeasuredWh.ValueWh != nil && len(a.gaps) == 0 && !a.measuredMissing {
			d.ReconcileWh = fptr(*d.MeasuredWh.ValueWh - *w.SessionEnergyWh)
		}
	}
	if a.aeroHave {
		d.AeroWh = Term{ValueWh: fptr(a.aeroWh), Method: "half_rho_cda_v3"}
	} else {
		d.AeroWh = Term{Method: "unknown", Unknown: true, Missing: []string{"VehicleSpeed"}}
	}
	if a.rollingHave {
		d.RollingWh = Term{ValueWh: fptr(a.rollingWh), Method: "crr_m_g_v"}
	} else {
		d.RollingWh = Term{Method: "unknown", Unknown: true, Missing: []string{"mass_kg", "VehicleSpeed"}}
	}
	if a.gradeHave && !a.gradeBlocked {
		d.GradeWh = Term{ValueWh: fptr(a.gradeWh), Method: "m_g_delta_h"}
	} else {
		d.GradeWh = Term{Method: "unknown", Unknown: true, Missing: []string{"elevation", "mass_kg"}}
	}
	if a.p.MassKg != nil && a.aeroHave {
		d.InertialWh = Term{ValueWh: fptr(a.inertialWh), Method: "half_m_delta_v2"}
	} else {
		d.InertialWh = Term{Method: "unknown", Unknown: true, Missing: []string{"mass_kg", "VehicleSpeed"}}
	}
	if a.accessoryHave && !a.accessoryBlocked {
		d.AccessoryWh = Term{ValueWh: fptr(a.accessoryWh), Method: "hvac_step_hold"}
	} else {
		d.AccessoryWh = Term{Method: "unknown", Unknown: true, Missing: []string{"HvacPower"}}
	}
	// Drivetrain loss is a model on positive mechanical work, disclosed.
	mechKnown, _ := a.mechanicalWh()
	if mechKnown {
		d.DrivetrainLossWh = Term{ValueWh: fptr(a.positiveWorkLossWh), Method: "model_drivetrain_eff"}
	} else {
		d.DrivetrainLossWh = Term{Method: "unknown", Unknown: true, Missing: []string{"VehicleSpeed", "mass_kg"}}
	}
	predicted := 0.0
	for _, t := range []Term{d.AeroWh, d.RollingWh, d.GradeWh, d.InertialWh, d.AccessoryWh, d.DrivetrainLossWh} {
		if t.ValueWh != nil {
			predicted += *t.ValueWh
		} else {
			d.Missing = append(d.Missing, t.Missing...)
		}
	}
	if a.aeroHave || a.rollingHave || a.gradeHave || a.accessoryHave {
		d.PredictedWh = fptr(predicted)
	}
	if d.MeasuredWh.ValueWh != nil && d.PredictedWh != nil && len(a.gaps) == 0 && !a.measuredMissing && !a.speedMissing {
		d.UnexplainedWh = fptr(*d.MeasuredWh.ValueWh - predicted)
		d.UnexplainedKnown = true
	}
	d.Missing = dedupe(d.Missing)
	if len(a.gaps) > 0 || a.measuredMissing {
		d.Missing = append(d.Missing, "incomplete_energy_coverage")
	}
	return d
}

// mechanicalWh sums the known mechanical predicted terms.
func (a *accumulator) mechanicalWh() (bool, float64) {
	if !a.aeroHave {
		return false, 0
	}
	out := a.aeroWh
	if a.rollingHave {
		out += a.rollingWh
	}
	if a.gradeHave && !a.gradeBlocked {
		out += a.gradeWh
	}
	if a.p.MassKg != nil {
		out += a.inertialWh
	}
	return true, out
}

func (a *accumulator) chargeLedger(w Window) *ChargeLedger {
	c := &ChargeLedger{Honesty: ChargeLedgerHonesty, Unknown: true}
	if w.Kind != "charge" {
		if a.chargeEnergyHave {
			c.EnergyAddedWh = fptr(a.chargeEnergyWh)
			c.Unknown = false
		}
	} else if a.firstEnergy != nil && a.lastEnergy != nil {
		c.EnergyAddedWh = fptr(*a.lastEnergy - *a.firstEnergy)
		c.Unknown = false
	} else if a.measuredHave {
		// Discharge-positive integral negated: absorbed energy.
		c.EnergyAddedWh = fptr(-a.measuredWh)
		c.Missing = append(c.Missing, "EnergyRemaining")
		c.Unknown = false
	} else {
		c.Missing = append(c.Missing, "EnergyRemaining", "PackVoltage", "PackCurrent")
	}
	if w.Kind == "charge" {
		c.SessionWh = w.SessionEnergyWh
	}
	if a.wallHave {
		method := "mixed_charging_power_trapezoid"
		if a.acSeen && !a.dcSeen {
			method = "ac_power_trapezoid"
		} else if a.dcSeen && !a.acSeen {
			method = "dc_power_trapezoid"
		}
		c.WallWh = Term{ValueWh: fptr(a.wallWh), Method: method}
	} else {
		c.WallWh = Term{Method: "unknown", Unknown: true, Missing: []string{"ACChargingPower", "DCChargingPower"}}
	}
	if w.Kind == "charge" && a.acSeen && !a.dcSeen && c.EnergyAddedWh != nil && c.WallWh.ValueWh != nil && *c.WallWh.ValueWh > 0 && len(a.gaps) == 0 && !a.measuredMissing && *c.EnergyAddedWh >= 0 {
		c.EfficiencyPct = fptr(*c.EnergyAddedWh / *c.WallWh.ValueWh * 100)
		c.EfficiencyKnown = true
	}
	if a.precondHave {
		c.PreconditionWh = Term{ValueWh: fptr(a.precondWh), Method: "hvac_step_hold_while_preconditioning"}
	} else {
		c.PreconditionWh = Term{Method: "unknown", Unknown: true, Missing: []string{"HvacPower"}}
	}
	if a.completeAt != nil && a.unplugAt != nil {
		c.DwellCompleteS = fptr(a.unplugAt.Sub(*a.completeAt).Seconds())
		c.Unplugged = true
	}
	if !a.chargeSeen {
		c.Missing = append(c.Missing, "DetailedChargeState")
	}
	c.Missing = dedupe(c.Missing)
	return c
}

func (a *accumulator) parkLedger() *ParkLedger {
	p := &ParkLedger{Honesty: ParkLedgerHonesty, Unknown: true}
	p.DurationS = a.parkS
	if !a.parkHave {
		p.Missing = append(p.Missing, "Gear")
		return p
	}
	p.Trusted = !a.parkContradiction && a.gearSeen
	p.PluggedAtLimit = a.pluggedComplete
	if a.parkContradiction {
		p.Missing = append(p.Missing, "contradiction:gear_P_with_speed")
	}
	if a.parkEnergyHave && a.parkS > 0 && p.Trusted && !a.measuredMissing {
		p.EnergyWh = fptr(a.parkEnergyWh)
		p.AvgWattsW = fptr(a.parkEnergyWh / (a.parkS / 3600))
		p.Unknown = false
	} else {
		p.Missing = append(p.Missing, "PackVoltage", "PackCurrent", "EnergyRemaining")
	}
	// Per-load buckets: no per-load meters exist, so flagged intervals
	// cannot be attributed. Only an all-quiet window attributes to quiet.
	p.SentryWh = Term{Method: "unknown", Unknown: true, Missing: []string{"sentry_power_meter"}}
	p.CabinOverheatWh = Term{Method: "unknown", Unknown: true, Missing: []string{"cabin_overheat_power_meter"}}
	p.PreconditionWh = Term{Method: "unknown", Unknown: true, Missing: []string{"HvacPower"}}
	p.QuietPackWh = Term{Method: "unknown", Unknown: true}
	p.QuietPackWh.Missing = []string{"per_load_meters"}
	p.Missing = dedupe(p.Missing)
	return p
}

func (a *accumulator) thermalLedger() *ThermalLedger {
	t := &ThermalLedger{Honesty: ThermalHonesty, Unknown: true}
	if !a.packSeen {
		t.Missing = append(t.Missing, "ModuleTempMin", "ModuleTempMax")
	}
	t.PackMinC, t.PackMaxC, t.PackStartC, t.PackEndC = a.packMin, a.packMax, a.packStart, a.packEnd
	if a.insideN > 0 {
		t.InsideC = fptr(*a.insideSum / float64(a.insideN))
	} else {
		t.Missing = append(t.Missing, "InsideTemp")
	}
	if a.outsideN > 0 {
		t.OutsideC = fptr(*a.outsideSum / float64(a.outsideN))
	} else {
		t.Missing = append(t.Missing, "OutsideTemp")
	}
	if a.packSeen {
		t.Unknown = false
	}
	if len(a.thermT) >= 3 {
		if r, ok := pearson(a.thermT, a.thermP); ok {
			t.HeatVsPowerR = fptr(r)
		}
	}
	t.Missing = dedupe(t.Missing)
	return t
}

func (a *accumulator) rangeLedger(w Window) *RangeLedger {
	r := &RangeLedger{Honesty: RangeLedgerHonesty, Unknown: true}
	r.RatedM, r.EstM, r.IdealM, r.EnergyWh = a.rated, a.est, a.ideal, a.energyLatest
	vals := []float64{}
	for _, v := range []*float64{a.rated, a.est, a.ideal} {
		if v != nil {
			vals = append(vals, *v)
		}
	}
	if len(vals) < 2 {
		r.Missing = append(r.Missing, "RatedRange", "EstBatteryRange", "IdealBatteryRange")
	} else {
		r.Unknown = false
		mn, mx := vals[0], vals[0]
		for _, v := range vals[1:] {
			if v < mn {
				mn = v
			}
			if v > mx {
				mx = v
			}
		}
		r.SpreadM = fptr(mx - mn)
		r.Disagree = mx-mn > 1000
	}
	// Implied Wh/m from odometer + energy deltas, else session fallback.
	if a.firstOdo != nil && a.lastOdo != nil && a.firstEnergy != nil && a.lastEnergy != nil {
		dist := *a.lastOdo - *a.firstOdo
		used := *a.firstEnergy - *a.lastEnergy
		if dist > 0 && used > 0 {
			r.ImpliedWhPerM = fptr(used / dist)
		}
	} else if w.SessionDistanceM != nil && w.SessionEnergyWh != nil && *w.SessionDistanceM > 0 && *w.SessionEnergyWh > 0 {
		r.ImpliedWhPerM = fptr(*w.SessionEnergyWh / *w.SessionDistanceM)
	} else {
		r.Missing = append(r.Missing, "Odometer/EnergyRemaining")
	}
	r.Missing = dedupe(r.Missing)
	return r
}

func (a *accumulator) tireLedger() *TireLedger {
	t := &TireLedger{Honesty: TireHonesty, Unknown: true}
	t.FLKpa, t.FRKpa, t.RLKpa, t.RRKpa = a.fl, a.fr, a.rl, a.rr
	vals := []float64{}
	names := []string{"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr"}
	ptrs := []*float64{a.fl, a.fr, a.rl, a.rr}
	for i, p := range ptrs {
		if p != nil {
			vals = append(vals, *p)
		} else {
			t.Missing = append(t.Missing, names[i])
		}
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
		t.ImbalanceKpa = fptr(mx - mn)
		t.Unknown = false
	} else if len(vals) > 0 {
		t.Unknown = false
	}
	return t
}

func (a *accumulator) epochLedgers() []EpochResidual {
	out := []EpochResidual{}
	for fw, ep := range a.epochs {
		if !ep.have {
			continue
		}
		predicted := ep.mech + ep.hvac
		if ep.mech > 0 {
			predicted += ep.mech * (1/a.p.DrivetrainEff - 1)
		}
		out = append(out, EpochResidual{
			Firmware:      fw,
			MeasuredWh:    fptr(ep.measured),
			PredictedWh:   fptr(predicted),
			UnexplainedWh: fptr(ep.measured - predicted),
			SampleCount:   ep.count,
			Honesty:       EpochLedgerHonesty,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Firmware < out[j].Firmware })
	return out
}

func (a *accumulator) blackBox(end time.Time) []BlackBoxPoint {
	cutoff := end.Add(-time.Duration(BlackBoxWindowS) * time.Second)
	out := []BlackBoxPoint{}
	for _, pt := range a.points {
		if pt.At.Before(cutoff) {
			continue
		}
		out = append(out, BlackBoxPoint{
			At:         pt.At,
			SpeedMps:   pt.SpeedMps,
			PowerPackW: pt.PowerPackW,
			ForceLongN: pt.ForceLongN,
		})
	}
	return out
}

// pearson returns the correlation coefficient of paired observations.
func pearson(x, y []float64) (float64, bool) {
	if len(x) != len(y) || len(x) < 3 {
		return 0, false
	}
	n := float64(len(x))
	mx, my := 0.0, 0.0
	for i := range x {
		mx += x[i]
		my += y[i]
	}
	mx /= n
	my /= n
	var num, dx, dy float64
	for i := range x {
		num += (x[i] - mx) * (y[i] - my)
		dx += (x[i] - mx) * (x[i] - mx)
		dy += (y[i] - my) * (y[i] - my)
	}
	if dx == 0 || dy == 0 {
		return 0, false
	}
	return num / math.Sqrt(dx*dy), true
}

func dedupe(in []string) []string {
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
