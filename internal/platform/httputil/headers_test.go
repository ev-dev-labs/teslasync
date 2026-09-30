package httputil

import (
	"net/http"
	"strings"
	"testing"
)

func TestSafeHeaders(t *testing.T) {
	h := http.Header{
		"Authorization":       {"Bearer secret"},
		"Set-Cookie":          {"session=secret"},
		"X-Custom-Token":      {"secret"},
		"Content-Type":        {"application/json"},
		"Accept":              {strings.Repeat("a", 600)},
		"Retry-After":         {"20"},
		AppInstallationHeader: {"windows:550e8400-e29b-41d4-a716-446655440000"},
	}
	got := SafeHeaders(h)
	if got["Authorization"] != "REDACTED" ||
		got["Set-Cookie"] != "REDACTED" ||
		got["X-Custom-Token"] != "REDACTED" {
		t.Fatalf("sensitive headers not redacted: %v", got)
	}
	if got["Content-Type"] != "application/json" || got["Retry-After"] != "20" {
		t.Fatalf("safe diagnostics not preserved: %v", got)
	}
	if got[AppInstallationHeader] != "windows:550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("valid app installation label not preserved: %v", got)
	}
	for _, value := range []string{"android:secret", "windows:550e8400-e29b-41d4-a716-446655440000\ninjected", strings.Repeat("x", 600)} {
		if redacted := SafeHeaders(http.Header{AppInstallationHeader: {value}})[AppInstallationHeader]; redacted != "REDACTED" {
			t.Errorf("unsafe app installation label %q persisted as %q", value, redacted)
		}
	}
	if len(got["Accept"]) > 530 || !strings.HasSuffix(got["Accept"], "... [truncated]") {
		t.Errorf("oversized header not bounded: %d", len(got["Accept"]))
	}
	if SafeHeaders(nil) != nil {
		t.Error("absent headers must remain absent")
	}
}
