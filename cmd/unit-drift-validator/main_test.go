package main

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

// TestParseArgs_Defaults verifies that no flags yields the documented
// defaults (full fleet, 1h lookback, 24h cron, not dry-run, not once,
// not version).
func TestParseArgs_Defaults(t *testing.T) {
	cfg, err := parseArgs(nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("parseArgs(nil) returned error: %v", err)
	}
	if cfg.once || cfg.dryRun || cfg.printVersion {
		t.Errorf("default flags wrong: %+v", cfg)
	}
	if cfg.vehicleID != 0 {
		t.Errorf("default vehicleID = %d, want 0 (full fleet)", cfg.vehicleID)
	}
	if cfg.lookback != time.Hour {
		t.Errorf("default lookback = %v, want 1h", cfg.lookback)
	}
	if cfg.cronInterval != 24*time.Hour {
		t.Errorf("default cron interval = %v, want 24h", cfg.cronInterval)
	}
}

// TestParseArgs_AllFlags verifies every flag binds its value correctly.
func TestParseArgs_AllFlags(t *testing.T) {
	args := []string{
		"--once",
		"--dry-run",
		"--vehicle", "42",
		"--lookback", "30m",
		"--cron-interval", "12h",
	}
	cfg, err := parseArgs(args, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("parseArgs returned error: %v", err)
	}
	if !cfg.once {
		t.Error("--once not set")
	}
	if !cfg.dryRun {
		t.Error("--dry-run not set")
	}
	if cfg.vehicleID != 42 {
		t.Errorf("--vehicle = %d, want 42", cfg.vehicleID)
	}
	if cfg.lookback != 30*time.Minute {
		t.Errorf("--lookback = %v, want 30m", cfg.lookback)
	}
	if cfg.cronInterval != 12*time.Hour {
		t.Errorf("--cron-interval = %v, want 12h", cfg.cronInterval)
	}
}

// TestParseArgs_Version sets the print-version flag.
func TestParseArgs_Version(t *testing.T) {
	cfg, err := parseArgs([]string{"--version"}, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("parseArgs --version returned error: %v", err)
	}
	if !cfg.printVersion {
		t.Error("--version flag not set on cfg")
	}
}

// TestParseArgs_BadFlag returns a non-nil error so run() can map it
// to exit code 2.
func TestParseArgs_BadFlag(t *testing.T) {
	stderr := &bytes.Buffer{}
	_, err := parseArgs([]string{"--bogus"}, stderr)
	if err == nil {
		t.Fatal("parseArgs --bogus did not return error")
	}
}

// TestRun_NoOperatorToken_RefusesWithExitCode3 verifies the credential
// gate. Without TESLASYNC_OPERATOR_TOKEN, the binary must refuse
// before doing any DB work — protects against accidental cron / CI
// invocation feeding the alert pipeline.
func TestRun_NoOperatorToken_RefusesWithExitCode3(t *testing.T) {
	t.Setenv(operatorTokenEnv, "")
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := run([]string{"--once"}, stdout, stderr)
	if code != 3 {
		t.Errorf("run without operator token = exit %d, want 3", code)
	}
	if !strings.Contains(stderr.String(), "operator credential gate") {
		t.Errorf("stderr missing operator-gate message: %q", stderr.String())
	}
}

// TestRun_VersionFlag_PrintsAndExits verifies --version exits 0
// without checking the credential gate (so dev builds can read
// version without a token).
func TestRun_VersionFlag_PrintsAndExits(t *testing.T) {
	t.Setenv(operatorTokenEnv, "")
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := run([]string{"--version"}, stdout, stderr)
	if code != 0 {
		t.Errorf("--version exit code = %d, want 0; stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), version) {
		t.Errorf("--version stdout = %q, want it to contain %q", stdout.String(), version)
	}
}

// TestRun_BadFlag_ExitCode2 verifies flag-parse failure path.
func TestRun_BadFlag_ExitCode2(t *testing.T) {
	t.Setenv(operatorTokenEnv, "anything-non-empty")
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := run([]string{"--bogus"}, stdout, stderr)
	if code != 2 {
		t.Errorf("--bogus exit code = %d, want 2", code)
	}
}

// TestDeriveOperator_PrefersUSER over USERNAME, and falls back to
// "unknown". Same contract as cmd/resubscribe.
func TestDeriveOperator(t *testing.T) {
	t.Setenv("USER", "")
	t.Setenv("USERNAME", "")
	if got := deriveOperator(); got != "unknown" {
		t.Errorf("empty env deriveOperator = %q, want unknown", got)
	}

	t.Setenv("USER", "alice")
	t.Setenv("USERNAME", "ignored")
	if got := deriveOperator(); got != "alice" {
		t.Errorf("USER set deriveOperator = %q, want alice", got)
	}

	t.Setenv("USER", "")
	t.Setenv("USERNAME", "bob")
	if got := deriveOperator(); got != "bob" {
		t.Errorf("USERNAME-only deriveOperator = %q, want bob", got)
	}

	t.Setenv("USER", "  ")
	t.Setenv("USERNAME", "carol")
	if got := deriveOperator(); got != "carol" {
		t.Errorf("USER whitespace deriveOperator = %q, want carol", got)
	}
}
