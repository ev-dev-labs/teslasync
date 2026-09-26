package physicssvc

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestSamplesFromTimeline(t *testing.T) {
	at := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	rows := []signal.TimelineRow{{
		Timestamp: at,
		ObservedAt: map[string]time.Time{
			"speed": at, "pack_voltage_v": at, "pack_current_a": at, "energy_remaining_wh": at,
		},
		Fields: map[string]signal.SignalValue{
			"speed":                 25.0,
			"gear":                  "D",
			"pack_voltage_v":        400.0,
			"pack_current_a":        -50.0,
			"energy_remaining_wh":   50000.0,
			"charge_port_latch":     "Engaged",
			"detailed_charge_state": "Charging",
			"sentry_mode":           "On",
			"firmware":              "2026.24.3",
		},
	}}
	got := samplesFromTimeline(rows)
	if len(got) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(got))
	}
	s := got[0]
	if s.Gear != "D" {
		t.Fatalf("gear = %q, want D", s.Gear)
	}
	if s.SpeedMps == nil || *s.SpeedMps != 25.0 {
		t.Fatalf("speed = %v, want 25", s.SpeedMps)
	}
	if s.PackCurrentA == nil || *s.PackCurrentA != -50.0 {
		t.Fatalf("pack current sign must survive mapping: %v", s.PackCurrentA)
	}
	if s.ChargePortLatch != "Engaged" {
		t.Fatalf("latch = %q, want Engaged", s.ChargePortLatch)
	}
	if s.DetailedChargeState != "Charging" {
		t.Fatalf("charge state = %q, want Charging", s.DetailedChargeState)
	}
	if !s.SentryOn {
		t.Fatal("sentry must be on")
	}
	if s.Firmware != "2026.24.3" {
		t.Fatalf("firmware = %q", s.Firmware)
	}
	if s.ElevationM != nil {
		t.Fatal("unprojected elevation must stay unknown")
	}
}

func TestNormalizeLatchKeepsDisengaged(t *testing.T) {
	if got := fieldString(map[string]signal.SignalValue{"latch": "Disengaged"}, "latch"); got != "Disengaged" {
		t.Fatalf("latch = %q, want Disengaged", got)
	}
}

func TestParamsFromConfig(t *testing.T) {
	mass, cda, crr := 1980.0, 0.58, 0.0085
	cfg := &config.Config{Physics: config.PhysicsConfig{MassKg: &mass, CdAM2: &cda, Crr: &crr}}
	p := paramsFromConfig(cfg)()
	if p.MassKg == nil || *p.MassKg != mass || p.MassSource != physics.ParamConfigured {
		t.Fatalf("mass not configured: %+v", p)
	}
	if p.CdAM2 != cda || p.CdASource != physics.ParamConfigured {
		t.Fatalf("cda not configured: %+v", p)
	}
	if p.Crr != crr || p.CrrSource != physics.ParamConfigured {
		t.Fatalf("crr not configured: %+v", p)
	}

	p = paramsFromConfig(nil)()
	if p.MassKg != nil || p.MassSource != physics.ParamUnknown {
		t.Fatalf("mass must stay unknown without config: %+v", p)
	}
	if p.CdASource != physics.ParamDefault {
		t.Fatalf("cda must be labelled default: %+v", p)
	}
}

func TestLedgerFieldsCoverSolverInputs(t *testing.T) {
	need := map[string]bool{}
	for _, m := range ledgerFields() {
		need[m.Signal] = true
	}
	for _, s := range []string{
		"VehicleSpeed", "PackVoltage", "PackCurrent", "EnergyRemaining",
		"Gear", "ModuleTempMax", "RatedRange",
		"TpmsPressureFl", "Version", "DetailedChargeState",
	} {
		if !need[s] {
			t.Fatalf("ledger fields missing %s", s)
		}
	}
	if need["HvacPower"] {
		t.Fatal("HvacPower is an on/off state, not measured watts")
	}
}

func TestHvacStateCannotBecomeAccessoryPower(t *testing.T) {
	at := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	for _, state := range []signal.SignalValue{true, "On", 1.0} {
		row := signal.TimelineRow{
			Timestamp: at,
			Fields: map[string]signal.SignalValue{
				"hvac_power_w": state,
			},
			ObservedAt: map[string]time.Time{"hvac_power_w": at},
		}
		s := samplesFromTimeline([]signal.TimelineRow{row})[0]
		if s.HvacPowerW != nil {
			t.Fatalf("HVAC state %v became a watt measurement: %v", state, *s.HvacPowerW)
		}
	}
}
