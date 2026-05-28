package api

import (
	"testing"
)

// Phase R2.0c (2026-05-28): TestPagination relocated to
// internal/api/apiparams/params_test.go (TestPagination_DefaultsAndBounds)
// alongside the canonical exported apiparams.Pagination helper.

func TestAllowedCommandsWhitelist(t *testing.T) {
	// Should allow known commands
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

	// Total should be exactly 91
	if len(allowedCommands) != 91 {
		t.Errorf("allowedCommands has %d entries, want 91", len(allowedCommands))
	}

	// Should reject unknown commands
	rejected := []string{"format_drive", "root_shell", "sudo", "delete", "shutdown", ""}
	for _, cmd := range rejected {
		if allowedCommands[cmd] {
			t.Errorf("command %q should NOT be allowed", cmd)
		}
	}
}

// Phase R2a (2026-05-28): TestAllowedBackupTables relocated to
// internal/api/backup/handler_test.go::TestAllowedTables_RequiredAndForbiddenEntries
// alongside the canonical apibackup.AllowedTables symbol.

// Phase R2.0a (2026-05-28): TestHTTPStatusCode,
// TestTeslaTokenExpired_PropagatesCode, and
// TestTeslaTokenExpiredCodeConstant were relocated to
// internal/api/httpx/json_test.go + tesla_test.go alongside the
// canonical exported helpers they exercise.
