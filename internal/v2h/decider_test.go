package v2h

import (
	"errors"
	"testing"
	"time"
)

func TestDecide_RejectsInvalidInputs(t *testing.T) {
	_, err := Decide(Inputs{})
	if !errors.Is(err, ErrInvalidInputs) {
		t.Fatalf("expected ErrInvalidInputs, got %v", err)
	}
}

// Sanity: with a single flat-rate hour, the planner should be able
// to charge from solar surplus and bring the SoC up.
func TestDecide_SolarSurplusCharging(t *testing.T) {
	in := Inputs{
		Hours: []HourlyInputs{{
			StartAt:          time.Now(),
			DurationHours:    1,
			SolarProductionW: 5000,
			HouseLoadW:       1000,
			RateBuyPerWh:     0.0003,
			RateSellPerWh:    0.0001,
		}},
		VehicleCapacityWh:   75000,
		CurrentSoC:          0.4,
		MinSoC:              0.2,
		MaxSoC:              0.8,
		MaxChargeW:          11500,
		MaxDischargeW:       7600,
		RoundTripEfficiency: 0.85,
	}
	plan, err := Decide(in)
	if err != nil {
		t.Fatalf("Decide: %v", err)
	}
	if len(plan.Slices) != 1 {
		t.Fatalf("want 1 slice, got %d", len(plan.Slices))
	}
	s := plan.Slices[0]
	if s.Action != ActionCharge {
		t.Errorf("want Charge with solar surplus, got %s", s.Action)
	}
	if s.EnergyWh <= 0 {
		t.Errorf("want EnergyWh > 0 for charge, got %f", s.EnergyWh)
	}
	if plan.FinalSoC <= 0.4 {
		t.Errorf("FinalSoC should rise above 0.4, got %f", plan.FinalSoC)
	}
}

// With an expensive evening rate vs cheap overnight rate, the
// planner should charge in the cheap window. The expensive evening
// hour by itself isn't enough to trigger discharge unless the SoC
// is high — verify the cheap window action.
func TestDecide_TimeOfUseChargesCheapHour(t *testing.T) {
	expensive := HourlyInputs{
		StartAt: time.Date(2026, 1, 1, 18, 0, 0, 0, time.UTC), DurationHours: 1,
		SolarProductionW: 0, HouseLoadW: 1500,
		RateBuyPerWh: 0.0004, RateSellPerWh: 0.00005,
	}
	cheap := HourlyInputs{
		StartAt: time.Date(2026, 1, 1, 2, 0, 0, 0, time.UTC), DurationHours: 1,
		SolarProductionW: 0, HouseLoadW: 500,
		RateBuyPerWh: 0.0001, RateSellPerWh: 0.00005,
	}
	in := Inputs{
		Hours:               []HourlyInputs{expensive, cheap},
		VehicleCapacityWh:   75000,
		CurrentSoC:          0.5,
		MinSoC:              0.3,
		MaxSoC:              0.8,
		MaxChargeW:          11500,
		MaxDischargeW:       0, // discharge disabled — purely TOU charge timing
		RoundTripEfficiency: 0.85,
	}
	plan, err := Decide(in)
	if err != nil {
		t.Fatalf("Decide: %v", err)
	}
	if plan.Slices[1].Action != ActionCharge {
		t.Errorf("want Charge in cheap hour (slice 1), got %s", plan.Slices[1].Action)
	}
}

// SoC must NEVER drop below MinSoC even when discharge would be
// profitable.
func TestDecide_RespectsMinSoCHardFloor(t *testing.T) {
	in := Inputs{
		Hours: []HourlyInputs{{
			StartAt:          time.Now(),
			DurationHours:    1,
			SolarProductionW: 0,
			HouseLoadW:       2000,
			RateBuyPerWh:     0.001,
			RateSellPerWh:    0.0001,
		}},
		VehicleCapacityWh:   75000,
		CurrentSoC:          0.31, // 1% above floor — only 750 Wh headroom
		MinSoC:              0.30,
		MaxSoC:              0.80,
		MaxChargeW:          11500,
		MaxDischargeW:       7600,
		RoundTripEfficiency: 0.85,
	}
	plan, err := Decide(in)
	if err != nil {
		t.Fatalf("Decide: %v", err)
	}
	if plan.FinalSoC < 0.30 {
		t.Errorf("FinalSoC %f dropped below MinSoC %f", plan.FinalSoC, in.MinSoC)
	}
}

// SoC must NEVER exceed MaxSoC even when surplus would let it.
func TestDecide_RespectsMaxSoCCeiling(t *testing.T) {
	in := Inputs{
		Hours: []HourlyInputs{{
			StartAt:          time.Now(),
			DurationHours:    8, // long window so surplus would overshoot MaxSoC
			SolarProductionW: 8000,
			HouseLoadW:       500,
			RateBuyPerWh:     0.0003,
			RateSellPerWh:    0.0001,
		}},
		VehicleCapacityWh:   75000,
		CurrentSoC:          0.75,
		MinSoC:              0.30,
		MaxSoC:              0.80, // hard ceiling
		MaxChargeW:          11500,
		MaxDischargeW:       7600,
		RoundTripEfficiency: 0.85,
	}
	plan, err := Decide(in)
	if err != nil {
		t.Fatalf("Decide: %v", err)
	}
	if plan.FinalSoC > 0.8001 { // float tolerance
		t.Errorf("FinalSoC %f exceeded MaxSoC %f", plan.FinalSoC, in.MaxSoC)
	}
}

func TestDecide_RejectsTooManySlices(t *testing.T) {
	in := Inputs{
		Hours:               make([]HourlyInputs, 97),
		VehicleCapacityWh:   75000,
		CurrentSoC:          0.5,
		MinSoC:              0.2,
		MaxSoC:              0.8,
		MaxChargeW:          11500,
		MaxDischargeW:       7600,
		RoundTripEfficiency: 0.85,
	}
	_, err := Decide(in)
	if !errors.Is(err, ErrInvalidInputs) {
		t.Fatalf("expected ErrInvalidInputs for 97-slice plan, got %v", err)
	}
}

func TestMedianBuyRate(t *testing.T) {
	got := medianBuyRate([]HourlyInputs{
		{RateBuyPerWh: 0.0001},
		{RateBuyPerWh: 0.0003},
		{RateBuyPerWh: 0.0002},
	})
	if got != 0.0002 {
		t.Errorf("want 0.0002, got %f", got)
	}
}

func TestAction_String(t *testing.T) {
	cases := map[Action]string{
		ActionHold:      "hold",
		ActionCharge:    "charge",
		ActionDischarge: "discharge",
	}
	for a, want := range cases {
		if got := a.String(); got != want {
			t.Errorf("%v.String() = %q, want %q", a, got, want)
		}
	}
}
