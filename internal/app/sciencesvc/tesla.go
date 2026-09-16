package sciencesvc

import (
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// electrochemFields projects pack electrical + SOC + thermal signals.
// Values arrive SI-canonical from signal_log; Timeline forward-fills.
func electrochemFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "PackVoltage", Field: "pack_voltage_v"},
		{Signal: "PackCurrent", Field: "pack_current_a"},
		{Signal: "Soc", Field: "soc_pct"},
		{Signal: "EnergyRemaining", Field: "energy_remaining_wh"},
		{Signal: "BatteryLevel", Field: "battery_level_pct"},
		{Signal: "ModuleTempMin", Field: "pack_temp_min_c"},
		{Signal: "ModuleTempMax", Field: "pack_temp_max_c"},
		{Signal: "BrickVoltageMin", Field: "brick_min_v"},
		{Signal: "BrickVoltageMax", Field: "brick_max_v"},
		{Signal: "Gear", Field: "gear"},
		{Signal: "ChargeState", Field: "charge_state"},
		{Signal: "DetailedChargeState", Field: "detailed_charge_state"},
		{Signal: "ACChargingPower", Field: "ac_power_w"},
		{Signal: "DCChargingPower", Field: "dc_power_w"},
		{Signal: "FastChargerPresent", Field: "fast_charger_present"},
		{Signal: "Version", Field: "firmware"},
	}
}

// thermalFields projects pack/cabin/ambient temperature + loads.
func thermalFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "ModuleTempMax", Field: "pack_temp_max_c"},
		{Signal: "InsideTemp", Field: "inside_temp_c"},
		{Signal: "OutsideTemp", Field: "outside_temp_c"},
		{Signal: "SentryMode", Field: "sentry_mode"},
		{Signal: "HvacPower", Field: "hvac_power_w"},
		{Signal: "PreconditioningEnabled", Field: "preconditioning_enabled"},
		{Signal: "BatteryHeaterOn", Field: "battery_heater_on"},
		{Signal: "Gear", Field: "gear"},
	}
}

// driveResidualFields is the minimal twin input for weather coupling.
func driveResidualFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed"},
		{Signal: "PackVoltage", Field: "pack_voltage_v"},
		{Signal: "PackCurrent", Field: "pack_current_a"},
		{Signal: "EnergyRemaining", Field: "energy_remaining_wh"},
		{Signal: "Odometer", Field: "odometer_m"},
	}
}

// tireFields projects TPMS corners + odometer + speed.
func tireFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "TpmsPressureFl", Field: "tpms_fl_kpa"},
		{Signal: "TpmsPressureFr", Field: "tpms_fr_kpa"},
		{Signal: "TpmsPressureRl", Field: "tpms_rl_kpa"},
		{Signal: "TpmsPressureRr", Field: "tpms_rr_kpa"},
		{Signal: "Odometer", Field: "odometer_m"},
		{Signal: "VehicleSpeed", Field: "speed"},
	}
}

// samplesFromTimeline maps forward-filled rows to twin samples.
func samplesFromTimeline(rows []signal.TimelineRow) []physics.Sample {
	out := make([]physics.Sample, 0, len(rows))
	for _, row := range rows {
		f := row.Fields
		s := physics.Sample{
			ElectricalUnaligned: !row.ObservedAt["pack_voltage_v"].Equal(row.Timestamp) || !row.ObservedAt["pack_current_a"].Equal(row.Timestamp),
			At:                  row.Timestamp.UTC(),
			SpeedMps:            fieldFloat(f, "speed"),
			OdometerM:           fieldFloat(f, "odometer_m"),
			Gear:                fieldString(f, "gear"),
			PackVoltageV:        fieldFloat(f, "pack_voltage_v"),
			PackCurrentA:        fieldFloat(f, "pack_current_a"),
			EnergyRemainingWh:   fieldFloat(f, "energy_remaining_wh"),
			SocPct:              fieldFloat(f, "soc_pct"),
			BrickMinV:           fieldFloat(f, "brick_min_v"),
			BrickMaxV:           fieldFloat(f, "brick_max_v"),
			ACPowerW:            fieldFloat(f, "ac_power_w"),
			DCPowerW:            fieldFloat(f, "dc_power_w"),
			ChargeState:         fieldString(f, "charge_state"),
			DetailedChargeState: fieldString(f, "detailed_charge_state"),
			PackTempMinC:        fieldFloat(f, "pack_temp_min_c"),
			PackTempMaxC:        fieldFloat(f, "pack_temp_max_c"),
			InsideTempC:         fieldFloat(f, "inside_temp_c"),
			OutsideTempC:        fieldFloat(f, "outside_temp_c"),
			HvacPowerW:          fieldFloat(f, "hvac_power_w"),
			Firmware:            fieldString(f, "firmware"),
		}
		for field, value := range map[string]**float64{
			"pack_voltage_v": &s.PackVoltageV, "pack_current_a": &s.PackCurrentA,
			"soc_pct": &s.SocPct, "energy_remaining_wh": &s.EnergyRemainingWh,
			"speed": &s.SpeedMps, "ac_power_w": &s.ACPowerW,
			"dc_power_w": &s.DCPowerW, "hvac_power_w": &s.HvacPowerW,
		} {
			at := row.ObservedAt[field]
			if at.IsZero() || at.After(row.Timestamp) || row.Timestamp.Sub(at) > time.Duration(physics.DefaultUnknownGapS)*time.Second {
				*value = nil
			}
		}
		if b := fieldBool(f, "fast_charger_present"); b != nil {
			s.FastCharger = *b
		}
		if b := fieldBool(f, "preconditioning_enabled"); b != nil {
			s.Preconditioning = *b
		}
		if b := fieldBool(f, "battery_heater_on"); b != nil {
			s.BatteryHeaterOn = *b
		}
		if b := fieldBool(f, "sentry_mode"); b != nil {
			s.SentryOn = *b
		} else if str := fieldString(f, "sentry_mode"); str != "" && str != enums.SentryOff {
			s.SentryOn = true
		}
		s.TpmsFLKpa = fieldFloat(f, "tpms_fl_kpa")
		s.TpmsFRKpa = fieldFloat(f, "tpms_fr_kpa")
		s.TpmsRLKpa = fieldFloat(f, "tpms_rl_kpa")
		s.TpmsRRKpa = fieldFloat(f, "tpms_rr_kpa")
		out = append(out, s)
	}
	return out
}

func fieldString(fields map[string]signal.SignalValue, keys ...string) string {
	for _, key := range keys {
		v := fields[key]
		if v == nil {
			continue
		}
		switch val := v.(type) {
		case string:
			if s := strings.TrimSpace(val); s != "" {
				return s
			}
		case []byte:
			if s := strings.TrimSpace(string(val)); s != "" {
				return s
			}
		}
	}
	return ""
}

func fieldFloat(fields map[string]signal.SignalValue, keys ...string) *float64 {
	for _, key := range keys {
		if n, ok := signal.Float64(fields[key]); ok {
			v := n
			return &v
		}
	}
	return nil
}

func fieldBool(fields map[string]signal.SignalValue, keys ...string) *bool {
	for _, key := range keys {
		v := fields[key]
		if v == nil {
			continue
		}
		switch val := v.(type) {
		case bool:
			return &val
		case string:
			switch strings.ToLower(strings.TrimSpace(val)) {
			case "true", "1", "on", "yes", "engaged":
				b := true
				return &b
			case "false", "0", "off", "no":
				b := false
				return &b
			}
		}
		if n, ok := signal.Float64(v); ok {
			b := n != 0
			return &b
		}
	}
	return nil
}
