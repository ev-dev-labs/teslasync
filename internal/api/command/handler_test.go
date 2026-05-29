package command

import "testing"

func TestAllowedCommandsWhitelist(t *testing.T) {
	allowed := []string{"lock", "unlock", "wake_up", "climate_on", "climate_off",
		"charge_start", "charge_stop", "honk_horn", "flash_lights",
		"set_sentry_mode", "vent_windows", "close_windows", "actuate_trunk", "actuate_frunk",
		"open_charge_port", "close_charge_port", "set_charge_limit", "set_temps",
		"remote_start_drive", "set_scheduled_departure", "set_scheduled_charging",
		"charge_max_range", "charge_standard", "set_charging_amps",
		"bioweapon_on", "bioweapon_off", "cop_on", "cop_fan_only", "cop_off",
		"set_cop_temp", "climate_keeper_off", "climate_keeper_on",
		"dog_mode", "camp_mode", "preconditioning_max", "preconditioning_reset"}

	for _, cmd := range allowed {
		if !allowedCommands[cmd] {
			t.Errorf("command %q should be allowed", cmd)
		}
	}

	if len(allowedCommands) != 91 {
		t.Errorf("allowedCommands has %d entries, want 91", len(allowedCommands))
	}

	rejected := []string{"format_drive", "root_shell", "sudo", "delete", "shutdown", ""}
	for _, cmd := range rejected {
		if allowedCommands[cmd] {
			t.Errorf("command %q should NOT be allowed", cmd)
		}
	}
}

func TestCommandWhitelistCovers(t *testing.T) {
	expected := []string{"lock", "unlock", "wake_up", "climate_on", "climate_off",
		"charge_start", "charge_stop", "honk_horn", "flash_lights", "set_sentry_mode"}
	for _, cmd := range expected {
		if !allowedCommands[cmd] {
			t.Errorf("expected command %q in whitelist", cmd)
		}
	}

	bad := []string{"format_drive", "delete_all", "root_shell", ""}
	for _, cmd := range bad {
		if allowedCommands[cmd] {
			t.Errorf("command %q should NOT be in whitelist", cmd)
		}
	}
}
