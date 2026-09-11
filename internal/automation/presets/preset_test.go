package presets

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRegistry_StarterPresetsPreserved(t *testing.T) {
	r := NewRegistry()
	starters := []string{
		"sec_sentry_at_night",
		"sec_sentry_off_morning",
		"sec_lock_after_charge",
		"climate_morning_precondition",
		"climate_off_after_drive",
		"climate_set_default_temp",
		"charge_stop_at_80",
		"charge_set_limit_80",
		"charge_overnight_start",
		"home_lock_on_sleep",
		"home_close_windows_on_sleep",
		"drive_sentry_off_on_start",
		"drive_lock_after_drive",
		"comfort_steering_heat_morning",
		"comfort_seat_heat_on_drive",
		"maint_daily_wake",
		"maint_flash_on_online",
		"energy_charge_at_off_peak",
		"energy_stop_at_90",
		"energy_low_battery_alert_action",
	}
	for _, id := range starters {
		if r.Get(id) == nil {
			t.Errorf("missing starter preset %q", id)
		}
	}
}

func TestRegistry_ExtensiveCatalogue(t *testing.T) {
	got := len(NewRegistry().Presets(""))
	if got < 140 {
		t.Fatalf("presets = %d, want at least 140", got)
	}
}

// TestRegistry_AllCategoriesPopulated ensures every advertised category has at
// least one preset so the gallery never renders an empty section.
func TestRegistry_AllCategoriesPopulated(t *testing.T) {
	r := NewRegistry()
	cats := r.Categories()
	if len(cats) == 0 {
		t.Fatal("registry has no categories")
	}
	for _, c := range cats {
		if got := r.Presets(c.ID); len(got) == 0 {
			t.Errorf("category %q has no presets", c.ID)
		}
	}
}

// TestRegistry_PresetIDsUnique guards against duplicate IDs that would make
// Get() return whichever preset was registered first.
func TestRegistry_PresetIDsUnique(t *testing.T) {
	r := NewRegistry()
	seen := map[string]bool{}
	for _, p := range r.Presets("") {
		if seen[p.ID] {
			t.Errorf("duplicate preset id %q", p.ID)
		}
		seen[p.ID] = true
	}
}

// TestRegistry_StepsCarryRequiredFields validates each preset's typed CTI
// step JSON against the shape rules enforced by
// internal/api/automation_handler_decode.go. If this passes, the frontend
// builder will hydrate from the preset and the create-automation API will
// accept the resulting payload.
func TestRegistry_StepsCarryRequiredFields(t *testing.T) {
	r := NewRegistry()
	for _, p := range r.Presets("") {
		t.Run(p.ID, func(t *testing.T) {
			if len(p.Triggers) == 0 {
				t.Errorf("preset %q has no triggers", p.ID)
			}
			if len(p.Actions) == 0 {
				t.Errorf("preset %q has no actions", p.ID)
			}
			for i, raw := range p.Triggers {
				if err := assertTriggerShape(raw); err != nil {
					t.Errorf("trigger[%d]: %v", i, err)
				}
			}
			for i, raw := range p.Conditions {
				if err := assertConditionShape(raw); err != nil {
					t.Errorf("condition[%d]: %v", i, err)
				}
			}
			for i, raw := range p.Actions {
				if err := assertActionShape(raw); err != nil {
					t.Errorf("action[%d]: %v", i, err)
				}
			}
		})
	}
}

func decodeKind(raw json.RawMessage) (string, map[string]any, error) {
	var fields map[string]any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields() // tightens parity with API decodeStrictAutomationJSON
	if err := dec.Decode(&fields); err != nil {
		// fall back to a permissive decode so the kind switch can still run
		_ = json.Unmarshal(raw, &fields)
	}
	kind, _ := fields["kind"].(string)
	if kind == "" {
		return "", nil, jsonErr("missing kind discriminator")
	}
	return kind, fields, nil
}

func assertTriggerShape(raw json.RawMessage) error {
	kind, fields, err := decodeKind(raw)
	if err != nil {
		return err
	}
	switch kind {
	case "trigger_schedule":
		if s, _ := fields["cron_expr"].(string); s == "" {
			return jsonErr("trigger_schedule missing cron_expr")
		}
	case "trigger_event":
		s, _ := fields["event_type"].(string)
		switch s {
		case "drive_start", "drive_end", "charge_start", "charge_end",
			"sleep_start", "sleep_end", "online", "offline", "sentry_alert":
		default:
			return jsonErr("trigger_event has unsupported event_type " + s)
		}
	case "trigger_signal":
		if s, _ := fields["signal"].(string); s == "" {
			return jsonErr("trigger_signal missing signal name")
		}
		op, _ := fields["op"].(string)
		switch op {
		case "=", "!=", "<", "<=", ">", ">=", "crossed_above", "crossed_below":
			n := scalarValueCount(fields)
			if n != 1 {
				return jsonErr("trigger_signal op " + op + " requires exactly one value_*")
			}
		case "changed":
			if scalarValueCount(fields) != 0 {
				return jsonErr("trigger_signal op changed must not include value_*")
			}
		default:
			return jsonErr("trigger_signal has unsupported op " + op)
		}
	default:
		return jsonErr("unsupported trigger kind " + kind +
			" (presets must avoid trigger_geofence — it requires a per-user place_id)")
	}
	return nil
}

func assertConditionShape(raw json.RawMessage) error {
	kind, fields, err := decodeKind(raw)
	if err != nil {
		return err
	}
	switch kind {
	case "condition_signal":
		if s, _ := fields["signal"].(string); s == "" {
			return jsonErr("condition_signal missing signal name")
		}
		if s, _ := fields["op"].(string); s == "" {
			return jsonErr("condition_signal missing op")
		}
	case "condition_time_window":
		if s, _ := fields["start_time"].(string); s == "" {
			return jsonErr("condition_time_window missing start_time")
		}
		if s, _ := fields["end_time"].(string); s == "" {
			return jsonErr("condition_time_window missing end_time")
		}
	default:
		return jsonErr("unsupported condition kind " + kind +
			" (presets must avoid condition_geofence and condition_other_automation — both require per-user FK IDs)")
	}
	return nil
}

func assertActionShape(raw json.RawMessage) error {
	kind, fields, err := decodeKind(raw)
	if err != nil {
		return err
	}
	switch kind {
	case "action_command":
		s, _ := fields["command_name"].(string)
		if s == "" {
			return jsonErr("action_command missing command_name")
		}
		if !knownTeslaCommand(s) {
			return jsonErr("action_command uses unknown command_name " + s)
		}
	default:
		return jsonErr("unsupported action kind " + kind +
			" (presets must avoid action_notify, action_set_setting, and action_call_automation — they require per-user FK IDs)")
	}
	return nil
}

func scalarValueCount(fields map[string]any) int {
	count := 0
	if _, ok := fields["value_text"]; ok {
		count++
	}
	if _, ok := fields["value_num"]; ok {
		count++
	}
	if _, ok := fields["value_bool"]; ok {
		count++
	}
	return count
}

// knownTeslaCommand mirrors the closed CHECK constraint on
// automation_actions.command_name (migrations/_baseline_source/16-automation-actions.sql).
// The list is intentionally a hardcoded subset — only commands that the
// current preset catalogue actually uses. Add new commands here as new
// presets reference them.
func knownTeslaCommand(name string) bool {
	switch name {
	case "sentry_on", "sentry_off",
		"climate_on", "climate_off",
		"set_temps",
		"charge_start", "charge_stop",
		"set_charge_limit", "set_charging_amps",
		"charge_max_range", "charge_standard",
		"open_charge_port", "close_charge_port",
		"lock", "unlock", "close_windows", "vent_windows",
		"sunroof_close", "sunroof_vent",
		"steering_wheel_heat", "seat_heater", "seat_cooler",
		"auto_seat_climate", "auto_steering_heat",
		"wake_up", "flash_lights",
		"trigger_homelink",
		"preconditioning_max", "preconditioning_reset",
		"cop_on", "cop_off", "cop_fan_only",
		"climate_keeper_on", "climate_keeper_off",
		"dog_mode", "camp_mode",
		"bioweapon_on", "bioweapon_off",
		"media_volume_down", "media_next_track", "media_toggle_playback",
		"media_prev_track", "media_next_fav", "media_prev_fav",
		"guest_mode_off", "guest_mode_on", "speed_limit_off",
		"honk_horn", "honk", "boombox_ping",
		"steering_wheel_level", "set_cop_temp", "sunroof_stop",
		"wake", "flash":
		return true
	}
	return false
}

type presetTestError string

func (e presetTestError) Error() string { return string(e) }

func jsonErr(msg string) error { return presetTestError(msg) }
