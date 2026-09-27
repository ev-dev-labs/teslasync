package physics

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func fp(v float64) *float64 { return &v }

func driveSamples(start time.Time, n int, step time.Duration, speedMps, packW float64) []Sample {
	out := make([]Sample, n)
	for i := range out {
		v, p := speedMps, packW
		out[i] = Sample{
			At:       start.Add(time.Duration(i) * step),
			SpeedMps: &v,
			Gear:     "D",
		}
		// Tesla sign: PackCurrent positive = charging into pack.
		// Discharge packW>0 means current = -packW/400.
		volt, curr := 400.0, -p/400.0
		out[i].PackVoltageV = &volt
		out[i].PackCurrentA = &curr
	}
	return out
}

func TestPowerSignConvention(t *testing.T) {
	// Fixture pins the Tesla sign: discharge (driving) is negative
	// PackCurrent, and the solver reports discharge-positive power.
	volt, curr := 400.0, -100.0
	p, ok := packPowerW(Sample{PackVoltageV: &volt, PackCurrentA: &curr})
	if !ok {
		t.Fatal("expected pack power from V*I")
	}
	if p != 40000 {
		t.Fatalf("expected +40000 W discharge, got %v", p)
	}
	curr = 50.0
	p, _ = packPowerW(Sample{PackVoltageV: &volt, PackCurrentA: &curr})
	if p != -20000 {
		t.Fatalf("expected -20000 W (absorbing), got %v", p)
	}
}

func TestDriveResidualRequiresEveryPredictedTerm(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	samples := driveSamples(start, 3, time.Second, 20, 8000)
	mass := 2000.0
	params := DefaultParams()
	params.MassKg = &mass
	ledger := Solve(Window{
		VehicleID: 1, Kind: "drive", Start: start, End: start.Add(2 * time.Second),
		Samples: samples, Params: params,
	})
	if ledger.Drive.MeasuredWh.ValueWh == nil || ledger.Drive.PredictedWh == nil {
		t.Fatal("measured pack energy and partial prediction should remain available")
	}
	if ledger.Drive.UnexplainedKnown || ledger.Drive.UnexplainedWh != nil {
		t.Fatal("residual cannot be computed from a partial prediction")
	}
	if !ledger.Drive.GradeWh.Unknown || !ledger.Drive.AccessoryWh.Unknown {
		t.Fatal("missing elevation and HVAC watts must remain unknown")
	}
}

func TestSolveTable(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	mass := 2000.0

	aeroOnly := driveSamples(start, 61, time.Second, 25.0, 8000.0)
	// Match synthetic power to the aero+rolling model so residual ~0.
	params := DefaultParams()
	params.MassKg = &mass
	params.MassSource = ParamConfigured
	v := 25.0
	modelW := (0.5*params.RhoAirKgM3*params.CdAM2*v*v*v + params.Crr*mass*GravityMps2*v) / params.DrivetrainEff
	for i := range aeroOnly {
		curr := -modelW / 400.0
		aeroOnly[i].PackCurrentA = &curr
		hvac := 0.0
		aeroOnly[i].HvacPowerW = &hvac
		elev := 100.0
		aeroOnly[i].ElevationM = &elev
	}

	gradeUp := driveSamples(start, 61, time.Second, 5.0, 12000.0)
	for i := range gradeUp {
		elev := 100.0 + float64(i)*0.5 // +30 m climb
		gradeUp[i].ElevationM = &elev
		hvac := 0.0
		gradeUp[i].HvacPowerW = &hvac
	}

	gapSamples := driveSamples(start, 10, time.Second, 20.0, 7000.0)
	gapSamples = append(gapSamples, driveSamples(start.Add(10*time.Minute), 10, time.Second, 20.0, 7000.0)...)

	regenSamples := driveSamples(start, 31, time.Second, 20.0, 6000.0)
	for i := 15; i < 31; i++ {
		v := 20.0 - float64(i-15)*1.2 // decel to ~2 m/s
		regenSamples[i].SpeedMps = &v
		curr := 30.0 // absorbing 12 kW (regen)
		regenSamples[i].PackCurrentA = &curr
	}

	parkBad := []Sample{
		{At: start, Gear: "P", SpeedMps: fp(10.0), EnergyRemainingWh: fp(50000)},
		{At: start.Add(10 * time.Second), Gear: "P", SpeedMps: fp(10.0), EnergyRemainingWh: fp(49990)},
	}

	chargeFull := []Sample{}
	for i := 0; i < 61; i++ {
		e := 40000.0 + float64(i)*2.75 // ≈90% of the 11 kW wall power
		ac := 11000.0
		state := "Charging"
		latch := "Engaged"
		if i >= 50 {
			state = "Complete"
		}
		if i == 60 {
			latch = "Disengaged"
			state = "Disconnected"
		}
		chargeFull = append(chargeFull, Sample{
			At: start.Add(time.Duration(i) * time.Second), Gear: "P",
			EnergyRemainingWh: &e, ACPowerW: &ac,
			DetailedChargeState: state, ChargePortLatch: latch,
		})
	}

	fwA := driveSamples(start, 20, time.Second, 20.0, 7000.0)
	fwB := driveSamples(start.Add(20*time.Second), 20, time.Second, 20.0, 7000.0)
	for i := range fwA {
		fwA[i].Firmware = "2026.20.1"
	}
	for i := range fwB {
		fwB[i].Firmware = "2026.24.3"
	}
	fwSplit := append(fwA, fwB...)

	tests := []struct {
		name   string
		window Window
		check  func(t *testing.T, l *Ledger)
	}{
		{
			name: "aero_dominated_residual_near_zero",
			window: Window{
				VehicleID: 1, Kind: "drive", Start: start, End: start.Add(60 * time.Second),
				Samples: aeroOnly, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if !l.Drive.UnexplainedKnown || l.Drive.UnexplainedWh == nil {
					t.Fatal("expected known residual")
				}
				if math.Abs(*l.Drive.UnexplainedWh) > 5 {
					t.Fatalf("residual too large: %v Wh", *l.Drive.UnexplainedWh)
				}
				if l.Drive.AeroWh.ValueWh == nil || *l.Drive.AeroWh.ValueWh <= 0 {
					t.Fatal("expected positive aero term")
				}
			},
		},
		{
			name: "grade_climb_matches_m_g_dh",
			window: Window{
				VehicleID: 1, Kind: "drive", Start: start, End: start.Add(60 * time.Second),
				Samples: gradeUp, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if l.Drive.GradeWh.ValueWh == nil {
					t.Fatal("expected known grade term")
				}
				want := mass * GravityMps2 * 30.0 / 3600
				if math.Abs(*l.Drive.GradeWh.ValueWh-want) > 1 {
					t.Fatalf("grade %v Wh, want %v Wh", *l.Drive.GradeWh.ValueWh, want)
				}
			},
		},
		{
			name: "gap_breaks_segment_unknown_not_zero",
			window: Window{
				VehicleID: 1, Kind: "drive", Start: start, End: start.Add(11 * time.Minute),
				Samples: gapSamples, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if len(l.Unknown) == 0 {
					t.Fatal("expected unknown intervals")
				}
				if l.UnknownHours <= 0 {
					t.Fatal("expected positive unknown hours")
				}
				// 20 one-second intervals at 7 kW ≈ 38.9 Wh, not a full-window fill.
				if l.Drive.MeasuredWh.ValueWh == nil || *l.Drive.MeasuredWh.ValueWh > 60 {
					t.Fatalf("gap energy must not be filled: %v", l.Drive.MeasuredWh.ValueWh)
				}
			},
		},
		{
			name: "regen_vs_friction_split",
			window: Window{
				VehicleID: 1, Kind: "drive", Start: start, End: start.Add(30 * time.Second),
				Samples: regenSamples, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if l.Dynamics.RegenWh == nil || *l.Dynamics.RegenWh <= 0 {
					t.Fatal("expected positive regen Wh")
				}
				if l.Dynamics.FrictionWh != nil {
					t.Fatal("friction attribution requires grade")
				}
			},
		},
		{
			name: "charge_complete_latched_not_unplug",
			window: Window{
				VehicleID: 1, Kind: "charge", Start: start, End: start.Add(60 * time.Second),
				Samples: chargeFull[:55], Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if l.Charge.Unplugged {
					t.Fatal("Complete still latched must not read as unplug")
				}
				if l.Charge.EnergyAddedWh == nil || *l.Charge.EnergyAddedWh <= 0 {
					t.Fatal("expected positive energy added")
				}
			},
		},
		{
			name: "charge_unplug_detected",
			window: Window{
				VehicleID: 1, Kind: "charge", Start: start, End: start.Add(60 * time.Second),
				Samples: chargeFull, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if !l.Charge.Unplugged {
					t.Fatal("expected unplug after Disconnected")
				}
				if l.Charge.DwellCompleteS == nil || *l.Charge.DwellCompleteS <= 0 {
					t.Fatal("expected Complete dwell")
				}
				if !l.Charge.EfficiencyKnown {
					t.Fatal("expected known charge efficiency")
				}
			},
		},
		{
			name: "park_plugged_at_limit_observed",
			window: Window{
				VehicleID: 1, Kind: "park", Start: start, End: start.Add(60 * time.Second),
				Samples: chargeFull[:55], Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if !l.Park.PluggedAtLimit {
					t.Fatal("expected plugged-at-limit observed (Complete + Engaged latch)")
				}
			},
		},
		{
			name: "park_contradiction_untrusted",
			window: Window{
				VehicleID: 1, Kind: "park", Start: start, End: start.Add(10 * time.Second),
				Samples: parkBad, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if l.Park.Trusted {
					t.Fatal("Gear=P with speed must not be trusted")
				}
				if len(l.Contradictions) == 0 {
					t.Fatal("expected contradiction flag")
				}
			},
		},
		{
			name: "firmware_epoch_split",
			window: Window{
				VehicleID: 1, Kind: "drive", Start: start, End: start.Add(40 * time.Second),
				Samples: fwSplit, Params: params,
			},
			check: func(t *testing.T, l *Ledger) {
				if len(l.Epochs) != 2 {
					t.Fatalf("expected 2 epochs, got %d", len(l.Epochs))
				}
				for _, e := range l.Epochs {
					if e.UnexplainedWh == nil {
						t.Fatalf("epoch %s missing residual", e.Firmware)
					}
				}
			},
		},
		{
			name: "mass_unknown_force_unknown",
			window: Window{
				VehicleID: 1, Kind: "drive", Start: start, End: start.Add(60 * time.Second),
				Samples: aeroOnly, Params: DefaultParams(),
			},
			check: func(t *testing.T, l *Ledger) {
				if l.Dynamics.MassKg != nil {
					t.Fatal("mass must stay unknown without config")
				}
				if l.Drive.RollingWh.ValueWh != nil {
					t.Fatal("rolling must be unknown without mass")
				}
				if l.Drive.AeroWh.ValueWh == nil {
					t.Fatal("aero needs no mass")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.check(t, Solve(tt.window))
		})
	}
}

func TestLedgerJSONTagsSI(t *testing.T) {
	now := time.Now().UTC()
	samples := driveSamples(now.Add(-time.Hour), 3, time.Minute, 20.0, 7000.0)
	l := Solve(Window{
		VehicleID: 7, Kind: "range", Start: now.Add(-time.Hour), End: now,
		Samples: samples, Params: DefaultParams(),
	})
	raw, err := json.Marshal(l)
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, banned := range []string{"_kwh", "_mi\"", "_mph", "_kw\"", "_psi", "true_range"} {
		if strings.Contains(s, banned) {
			t.Fatalf("payload contains banned token %q", banned)
		}
	}
	for _, want := range []string{"value_wh", "speed_mps", "duration_s", "rated_m", "fl_kpa", "honesty"} {
		if !strings.Contains(s, want) {
			t.Fatalf("payload missing SI key %q", want)
		}
	}
}

func TestTrapezoidSkipsNonPositiveDt(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	v := 20.0
	volt, curr := 400.0, -17.5
	s := Sample{At: start, SpeedMps: &v, PackVoltageV: &volt, PackCurrentA: &curr}
	dup := s
	l := Solve(Window{
		VehicleID: 1, Kind: "drive", Start: start, End: start.Add(time.Minute),
		Samples: []Sample{s, dup}, Params: DefaultParams(),
	})
	if l.Drive.MeasuredWh.ValueWh != nil && *l.Drive.MeasuredWh.ValueWh != 0 {
		t.Fatalf("dt=0 must contribute nothing, got %v", *l.Drive.MeasuredWh.ValueWh)
	}
}
