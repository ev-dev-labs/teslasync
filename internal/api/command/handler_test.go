package command

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	cmdFSM "github.com/ev-dev-labs/teslasync/internal/fsm/command"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

func TestParseCommandHistoryWindow(t *testing.T) {
	from, until, before, id, err := parseCommandHistoryWindow(
		"2015-01-01", "2026-09-23", "2026-09-22T10:15:00Z", "42",
	)
	if err != nil || from.Format(time.DateOnly) != "2015-01-01" ||
		until.Format(time.DateOnly) != "2026-09-24" || before == nil ||
		before.Format(time.RFC3339) != "2026-09-22T10:15:00Z" || id != 42 {
		t.Fatalf("all-time command scope: from=%v until=%v cursor=%v id=%d err=%v", from, until, before, id, err)
	}
	from, until, before, id, err = parseCommandHistoryWindow(
		"2026-09-22T10:15:00-07:00", "2026-09-23T10:15:00-07:00", "", "",
	)
	if err != nil || from.Format(time.RFC3339) != "2026-09-22T10:15:00-07:00" ||
		until.Format(time.RFC3339) != "2026-09-23T10:15:00-07:00" || before != nil || id != 0 {
		t.Fatalf("rolling command scope: from=%v until=%v cursor=%v id=%d err=%v", from, until, before, id, err)
	}
	from, until, _, _, err = parseCommandHistoryWindow(
		"2026-09-23T06:00:00.123Z", "2026-09-23T06:05:00.456Z", "", "",
	)
	if err != nil || from.Nanosecond() != 123000000 || until.Nanosecond() != 456000000 {
		t.Fatalf("precise command scope: from=%v until=%v err=%v", from, until, err)
	}
	for _, tc := range []struct{ from, to, before, id string }{
		{"2026-02-30", "2026-09-23", "", ""},
		{"2026-09-23", "2026-01-01", "", ""},
		{"1900-01-01", "2026-09-23", "", ""},
		{"2026-01-01", "2026-09-23", "invalid", "42"},
		{"2026-01-01", "2026-09-23", "", "42"},
		{"2026-01-01", "2026-09-23", "2026-01-02T00:00:00Z", "0"},
		{"2026-01-01", "2026-09-23T00:00:00Z", "", ""},
		{"2026-09-23T10:00:00Z", "2026-09-23T10:00:00Z", "", ""},
		{"2026-09-23T11:00:00Z", "2026-09-23T10:00:00Z", "", ""},
		{"2026-09-23T10:00:00Z", "2077-09-23T10:00:00Z", "", ""},
	} {
		if _, _, _, _, err := parseCommandHistoryWindow(tc.from, tc.to, tc.before, tc.id); err == nil {
			t.Errorf("accepted invalid scope %+v", tc)
		}
	}
}

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
