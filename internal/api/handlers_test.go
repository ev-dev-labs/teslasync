package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHTTPStatusCode(t *testing.T) {
	tests := []struct {
		status int
		want   string
	}{
		{400, "BAD_REQUEST"},
		{401, "UNAUTHORIZED"},
		{403, "FORBIDDEN"},
		{404, "NOT_FOUND"},
		{405, "METHOD_NOT_ALLOWED"},
		{409, "CONFLICT"},
		{422, "UNPROCESSABLE_ENTITY"},
		{429, "RATE_LIMITED"},
		{500, "INTERNAL_ERROR"},
		{503, "SERVICE_UNAVAILABLE"},
		{504, "GATEWAY_TIMEOUT"},
		{418, "ERROR"}, // unknown status
	}
	for _, tt := range tests {
		got := httpStatusCode(tt.status)
		if got != tt.want {
			t.Errorf("httpStatusCode(%d) = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestPagination(t *testing.T) {
	tests := []struct {
		query     string
		wantLimit int
		wantOff   int
	}{
		{"", 50, 0},
		{"?limit=10", 10, 0},
		{"?limit=10&offset=20", 10, 20},
		{"?limit=2000", 50, 0}, // exceeds max, uses default
		{"?limit=-5", 50, 0},   // negative, uses default
		{"?limit=abc", 50, 0},  // invalid, uses default
		{"?offset=-1", 50, 0},  // negative offset, uses default
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/test"+tt.query, nil)
			limit, offset := pagination(r)
			if limit != tt.wantLimit {
				t.Errorf("limit = %d, want %d", limit, tt.wantLimit)
			}
			if offset != tt.wantOff {
				t.Errorf("offset = %d, want %d", offset, tt.wantOff)
			}
		})
	}
}

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

func TestAllowedBackupTables(t *testing.T) {
	// Should contain expected tables
	expected := []string{"vehicles", "drives", "charging_sessions", "positions", "alerts"}
	for _, table := range expected {
		if !allowedBackupTables[table] {
			t.Errorf("table %q should be in allowedBackupTables", table)
		}
	}

	// Should reject dangerous tables
	rejected := []string{"pg_shadow", "pg_authid", "tokens", "api_keys"}
	for _, table := range rejected {
		if allowedBackupTables[table] {
			t.Errorf("table %q should NOT be in allowedBackupTables", table)
		}
	}
}

// TestTeslaTokenExpired_PropagatesCode verifies the contract between the
// Tesla-token-expired backend response and the frontend's distinct
// {@link TeslaAuthExpiredError} surface (Phase-45 / Prompt 30).
//
// The frontend distinguishes "Tesla third-party OAuth grant expired" from
// "Authentik session expired" purely by the JSON body's `code` field
// (HTTP status is 401 in both cases). If this code drifts, the reauth
// banner stops firing and users see a generic 401 toast with no
// recovery path — a silent regression we must catch in CI.
func TestTeslaTokenExpired_PropagatesCode(t *testing.T) {
	rec := httptest.NewRecorder()
	writeTeslaTokenExpired(rec)

	if rec.Code != 401 {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	gotCT := rec.Header().Get("Content-Type")
	if gotCT == "" || gotCT[:16] != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", gotCT)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	if got := body["code"]; got != ErrCodeTeslaTokenExpired {
		t.Errorf("body.code = %q, want %q", got, ErrCodeTeslaTokenExpired)
	}
	if got := body["code"]; got != "TESLA_TOKEN_EXPIRED" {
		t.Errorf("body.code literal = %q, want %q (frontend matches on this exact string)", got, "TESLA_TOKEN_EXPIRED")
	}
	if body["error"] == "" {
		t.Errorf("body.error is empty, want a human-readable message")
	}
}

// TestTeslaTokenExpiredCodeConstant pins the wire value of the error
// code so accidental renames are caught without grepping the frontend.
func TestTeslaTokenExpiredCodeConstant(t *testing.T) {
	if ErrCodeTeslaTokenExpired != "TESLA_TOKEN_EXPIRED" {
		t.Errorf("ErrCodeTeslaTokenExpired = %q, want %q (frontend resilience.ts depends on this exact string)",
			ErrCodeTeslaTokenExpired, "TESLA_TOKEN_EXPIRED")
	}
}
