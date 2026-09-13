package ocpp

import (
	"strings"
	"testing"
	"time"
)

func TestClamp(t *testing.T) {
	if got := clamp("abc", 8); got != "abc" {
		t.Fatalf("clamp short = %q, want abc", got)
	}
	if got := clamp("abcdef", 6); got != "abcdef" {
		t.Fatalf("clamp exact = %q, want abcdef", got)
	}
	if got := clamp("abcdefg", 6); got != "abcdef" {
		t.Fatalf("clamp long = %q, want abcdef", got)
	}
	if got := clamp(strings.Repeat("x", 200), 128); len(got) != 128 {
		t.Fatalf("clamp len = %d, want 128", len(got))
	}
}

func TestParseOCPPTime(t *testing.T) {
	want := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	if got := parseOCPPTime("2026-03-01T12:00:00Z"); !got.Equal(want) {
		t.Fatalf("parse valid = %v, want %v", got, want)
	}
	before := time.Now().UTC()
	for _, raw := range []string{"", "not-a-time", "2026-13-99T99:99:99Z"} {
		got := parseOCPPTime(raw)
		if got.Before(before) || time.Since(got) > time.Minute {
			t.Fatalf("parse %q = %v, want ~now", raw, got)
		}
	}
}

func TestNewStorePanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on nil db")
		}
	}()
	NewStore(nil)
}
