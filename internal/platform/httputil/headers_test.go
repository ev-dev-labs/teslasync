package httputil

import (
	"net/http"
	"strings"
	"testing"
)

func TestSafeHeaders(t *testing.T) {
	h := http.Header{
		"Authorization":  {"Bearer secret"},
		"Set-Cookie":     {"session=secret"},
		"X-Custom-Token": {"secret"},
		"Content-Type":   {"application/json"},
		"Accept":         {strings.Repeat("a", 600)},
		"Retry-After":    {"20"},
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
	if len(got["Accept"]) > 530 || !strings.HasSuffix(got["Accept"], "... [truncated]") {
		t.Errorf("oversized header not bounded: %d", len(got["Accept"]))
	}
	if SafeHeaders(nil) != nil {
		t.Error("absent headers must remain absent")
	}
}
