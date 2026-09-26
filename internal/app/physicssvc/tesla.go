package physicssvc

import (
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ledgerFields projects every signal the solver can consume. Values arrive
// SI-canonical from signal_log (phase-48); Timeline forward-fills each row
// so samples map directly without interpolation. Unprojected signals
// (elevation, HVAC watts, steering/yaw, per-load meters) stay unknown.
// Tesla HvacPower is an on/off state, not a power measurement.
func ledgerFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed"},
		{Signal: "Odometer", Field: "odometer_m"},
		{Signal: "Gear", Field: "gear"},
		{Signal: "BrakePedalPos", Field: "brake_pedal_pos_pct"},
		{Signal: "PackVoltage", Field: "pack_voltage_v"},
		{Signal: "PackCurrent", Field: "pack_current_a"},
		{Signal: "EnergyRemaining", Field: "energy_remaining_wh"},
		{Signal: "Soc", Field: "soc_pct"},
		{Signal: "ACChargingPower", Field: "ac_power_w"},
		{Signal: "DCChargingPower", Field: "dc_power_w"},
		{Signal: "ChargeState", Field: "charge_state"},
		{Signal: "DetailedChargeState", Field: "detailed_charge_state"},
		{Signal: "ChargePortLatch", Field: "charge_port_latch"},
		{Signal: "ChargePortDoorOpen", Field: "charge_port_door_open"},
		{Signal: "FastChargerPresent", Field: "fast_charger_present"},
		{Signal: "ModuleTempMin", Field: "pack_temp_min_c"},
		{Signal: "ModuleTempMax", Field: "pack_temp_max_c"},
		{Signal: "InsideTemp", Field: "inside_temp_c"},
		{Signal: "OutsideTemp", Field: "outside_temp_c"},
		{Signal: "PreconditioningEnabled", Field: "preconditioning_enabled"},
		{Signal: "BatteryHeaterOn", Field: "battery_heater_on"},
		{Signal: "SentryMode", Field: "sentry_mode"},
		{Signal: "CabinOverheatProtectionMode", Field: "cabin_overheat_mode"},
		{Signal: "ClimateKeeperMode", Field: "climate_keeper_mode"},
		{Signal: "RatedRange", Field: "rated_range_m"},
		{Signal: "EstBatteryRange", Field: "est_range_m"},
		{Signal: "IdealBatteryRange", Field: "ideal_range_m"},
		{Signal: "TpmsPressureFl", Field: "tpms_fl_kpa"},
		{Signal: "TpmsPressureFr", Field: "tpms_fr_kpa"},
		{Signal: "TpmsPressureRl", Field: "tpms_rl_kpa"},
		{Signal: "TpmsPressureRr", Field: "tpms_rr_kpa"},
		{Signal: "DiTorqueActualF", Field: "torque_f_nm"},
		{Signal: "DiTorqueActualR", Field: "torque_r_nm"},
		{Signal: "Version", Field: "firmware"},
	}
}

// samplesFromTimeline maps forward-filled rows to solver samples. Nil
// stays nil; electrical and motion values with unknown or stale emission
// times cannot support interval integration.
func samplesFromTimeline(rows []signal.TimelineRow) []physics.Sample {
	out := make([]physics.Sample, 0, len(rows))
	for _, row := range rows {
		f := row.Fields
		s := physics.Sample{
			At:                  row.Timestamp.UTC(),
			SpeedMps:            fieldFloat(f, "speed"),
			OdometerM:           fieldFloat(f, "odometer_m"),
			Gear:                fieldString(f, "gear"),
			BrakePedalPos:       fieldFloat(f, "brake_pedal_pos_pct"),
			PackVoltageV:        fieldFloat(f, "pack_voltage_v"),
			PackCurrentA:        fieldFloat(f, "pack_current_a"),
			EnergyRemainingWh:   fieldFloat(f, "energy_remaining_wh"),
			SocPct:              fieldFloat(f, "soc_pct"),
			ACPowerW:            fieldFloat(f, "ac_power_w"),
			DCPowerW:            fieldFloat(f, "dc_power_w"),
			ChargeState:         fieldString(f, "charge_state"),
			DetailedChargeState: fieldString(f, "detailed_charge_state"),
			ChargePortLatch:     fieldString(f, "charge_port_latch"),
			ChargePortDoorOpen:  fieldBool(f, "charge_port_door_open"),
			PackTempMinC:        fieldFloat(f, "pack_temp_min_c"),
			PackTempMaxC:        fieldFloat(f, "pack_temp_max_c"),
			InsideTempC:         fieldFloat(f, "inside_temp_c"),
			OutsideTempC:        fieldFloat(f, "outside_temp_c"),
			RatedRangeM:         fieldFloat(f, "rated_range_m"),
			EstRangeM:           fieldFloat(f, "est_range_m"),
			IdealRangeM:         fieldFloat(f, "ideal_range_m"),
			TpmsFLKpa:           fieldFloat(f, "tpms_fl_kpa"),
			TpmsFRKpa:           fieldFloat(f, "tpms_fr_kpa"),
			TpmsRLKpa:           fieldFloat(f, "tpms_rl_kpa"),
			TpmsRRKpa:           fieldFloat(f, "tpms_rr_kpa"),
			Firmware:            fieldString(f, "firmware"),
		}
		for field, value := range map[string]**float64{
			"pack_voltage_v": &s.PackVoltageV, "pack_current_a": &s.PackCurrentA,
			"energy_remaining_wh": &s.EnergyRemainingWh, "soc_pct": &s.SocPct,
			"speed": &s.SpeedMps, "ac_power_w": &s.ACPowerW,
			"dc_power_w": &s.DCPowerW,
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
		s.SentryOn = sentryOn(f)
		s.CabinOverheatOn = cabinOverheatOn(f)
		s.ClimateKeeper = climateKeeperOn(f)
		if tf, tr := fieldFloat(f, "torque_f_nm"), fieldFloat(f, "torque_r_nm"); tf != nil || tr != nil {
			sum := 0.0
			if tf != nil {
				sum += *tf
			}
			if tr != nil {
				sum += *tr
			}
			s.TorqueActualNm = &sum
		}
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

// sentryOn treats any non-Off SentryMode as on, matching park-truth.
func sentryOn(fields map[string]signal.SignalValue) bool {
	if b := fieldBool(fields, "sentry_mode"); b != nil {
		return *b
	}
	if s := fieldString(fields, "sentry_mode"); s != "" && s != enums.SentryOff {
		return true
	}
	return false
}

func cabinOverheatOn(fields map[string]signal.SignalValue) bool {
	if b := fieldBool(fields, "cabin_overheat_mode"); b != nil {
		return *b
	}
	if s := fieldString(fields, "cabin_overheat_mode"); s != "" {
		lowered := strings.ToLower(s)
		return lowered != "off" && lowered != "none"
	}
	return false
}

func climateKeeperOn(fields map[string]signal.SignalValue) bool {
	if b := fieldBool(fields, "climate_keeper_mode"); b != nil {
		return *b
	}
	if s := fieldString(fields, "climate_keeper_mode"); s != "" {
		lowered := strings.ToLower(s)
		return lowered != "off" && lowered != "none"
	}
	return false
}
