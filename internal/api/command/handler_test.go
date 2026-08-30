package command

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	cmdFSM "github.com/ev-dev-labs/teslasync/internal/fsm/command"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

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

// TestClassifyBudgetError_CommandErrorRetryability confirms the chosen
// category strings, combined with cmdFSM.CommandError.IsRetryable's
// StatusCode>=500 fallback, yield the correct retry semantics even
// though "budget_exceeded"/"budget_unavailable" are not part of that
// type's documented category enum.
func TestClassifyBudgetError_CommandErrorRetryability(t *testing.T) {
	failure, matched := httpx.ClassifyTeslaBudgetError(tesla.ErrBudgetExceeded)
	if !matched {
		t.Fatal("expected budget exceeded to match")
	}
	exceeded := &cmdFSM.CommandError{StatusCode: failure.StatusCode, Category: failure.Category}
	if exceeded.IsRetryable() {
		t.Error("budget_exceeded (429) must be classified non-retryable")
	}

	failure, matched = httpx.ClassifyTeslaBudgetError(tesla.ErrBudgetUnavailable)
	if !matched {
		t.Fatal("expected budget unavailable to match")
	}
	unavailable := &cmdFSM.CommandError{StatusCode: failure.StatusCode, Category: failure.Category}
	if !unavailable.IsRetryable() {
		t.Error("budget_unavailable (503) must be classified retryable")
	}
}
