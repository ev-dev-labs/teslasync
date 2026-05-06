package database

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateSystemMode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{"ok lowercase", "ok", "ok", false},
		{"OK uppercase normalizes", "OK", "ok", false},
		{"degraded with whitespace", "  degraded  ", "degraded", false},
		{"maintenance mixed case", "Maintenance", "maintenance", false},
		{"empty", "", "", true},
		{"unknown value", "broken", "", true},
		{"sql injection attempt", "ok; DROP TABLE system_state", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateSystemMode(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for input %q, got %q", tc.input, got)
				}
				if !errors.Is(err, ErrInvalidSystemMode) {
					t.Fatalf("expected ErrInvalidSystemMode wrap, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNormalizeMaintenanceMessage(t *testing.T) {
	t.Parallel()
	t.Run("trim whitespace", func(t *testing.T) {
		got := NormalizeMaintenanceMessage("  hello  ")
		if got != "hello" {
			t.Fatalf("got %q, want %q", got, "hello")
		}
	})
	t.Run("empty stays empty", func(t *testing.T) {
		if got := NormalizeMaintenanceMessage("   "); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})
	t.Run("preserves short messages", func(t *testing.T) {
		in := "DB upgrade in progress"
		if got := NormalizeMaintenanceMessage(in); got != in {
			t.Fatalf("got %q, want %q", got, in)
		}
	})
	t.Run("truncates over-length to 280 runes", func(t *testing.T) {
		in := strings.Repeat("a", 500)
		got := NormalizeMaintenanceMessage(in)
		if len([]rune(got)) != MaintenanceMessageMaxLen {
			t.Fatalf("got %d runes, want %d", len([]rune(got)), MaintenanceMessageMaxLen)
		}
	})
	t.Run("multibyte runes counted by rune not byte", func(t *testing.T) {
		// 281 emoji should truncate to exactly 280 runes (~1120 bytes
		// in UTF-8). Asserting on rune count guards against a future
		// regression to byte-based truncation that would slice through
		// a multibyte sequence and produce an invalid string.
		in := strings.Repeat("🚗", 281)
		got := NormalizeMaintenanceMessage(in)
		if r := len([]rune(got)); r != MaintenanceMessageMaxLen {
			t.Fatalf("got %d runes, want %d", r, MaintenanceMessageMaxLen)
		}
	})
}
