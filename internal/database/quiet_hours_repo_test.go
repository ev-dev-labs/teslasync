package database

import (
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestValidateQuietHours_OK(t *testing.T) {
	w := &models.QuietHoursWindow{
		Enabled:          true,
		StartLocal:       "23:00",
		EndLocal:         "07:00",
		Timezone:         "America/New_York",
		Weekdays:         models.QuietHoursWeekdayAll,
		BypassSeverities: []string{"critical"},
	}
	if err := validateQuietHours(w); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestValidateQuietHours_BadTime(t *testing.T) {
	cases := []string{"24:00", "9:00", "23:60", "abcde", ""}
	for _, bad := range cases {
		bad := bad
		t.Run("start="+bad, func(t *testing.T) {
			w := &models.QuietHoursWindow{
				StartLocal: bad, EndLocal: "07:00",
				Timezone: "UTC", Weekdays: 127, BypassSeverities: []string{"critical"},
			}
			if err := validateQuietHours(w); err != ErrQuietHoursInvalidTime {
				t.Fatalf("want ErrQuietHoursInvalidTime, got %v", err)
			}
		})
	}
}

func TestValidateQuietHours_EqualTimes(t *testing.T) {
	w := &models.QuietHoursWindow{
		StartLocal: "08:00", EndLocal: "08:00",
		Timezone: "UTC", Weekdays: 127, BypassSeverities: []string{"critical"},
	}
	if err := validateQuietHours(w); err != ErrQuietHoursEqualTime {
		t.Fatalf("want ErrQuietHoursEqualTime, got %v", err)
	}
}

func TestValidateQuietHours_BadTimezone(t *testing.T) {
	w := &models.QuietHoursWindow{
		StartLocal: "23:00", EndLocal: "07:00",
		Timezone: "Mars/Olympus", Weekdays: 127, BypassSeverities: []string{"critical"},
	}
	if err := validateQuietHours(w); err != ErrQuietHoursInvalidTimezone {
		t.Fatalf("want ErrQuietHoursInvalidTimezone, got %v", err)
	}

	w2 := &models.QuietHoursWindow{
		StartLocal: "23:00", EndLocal: "07:00",
		Timezone: "  ", Weekdays: 127, BypassSeverities: []string{"critical"},
	}
	if err := validateQuietHours(w2); err != ErrQuietHoursInvalidTimezone {
		t.Fatalf("want ErrQuietHoursInvalidTimezone for blank, got %v", err)
	}
}

func TestValidateQuietHours_Weekdays(t *testing.T) {
	for _, bad := range []int{-1, 128, 200} {
		bad := bad
		t.Run("weekdays", func(t *testing.T) {
			w := &models.QuietHoursWindow{
				StartLocal: "23:00", EndLocal: "07:00",
				Timezone: "UTC", Weekdays: bad, BypassSeverities: []string{"critical"},
			}
			if err := validateQuietHours(w); err != ErrQuietHoursInvalidWeekdays {
				t.Fatalf("want ErrQuietHoursInvalidWeekdays for %d, got %v", bad, err)
			}
		})
	}
}

func TestValidateQuietHours_Severity_LowercasesAndChecks(t *testing.T) {
	w := &models.QuietHoursWindow{
		StartLocal: "23:00", EndLocal: "07:00",
		Timezone: "UTC", Weekdays: 127,
		BypassSeverities: []string{" Critical ", "WARN"},
	}
	if err := validateQuietHours(w); err != nil {
		t.Fatalf("want ok after normalise, got %v", err)
	}
	if w.BypassSeverities[0] != "critical" || w.BypassSeverities[1] != "warn" {
		t.Fatalf("want lowercased trimmed values, got %v", w.BypassSeverities)
	}

	bad := &models.QuietHoursWindow{
		StartLocal: "23:00", EndLocal: "07:00",
		Timezone: "UTC", Weekdays: 127,
		BypassSeverities: []string{"emergency"},
	}
	if err := validateQuietHours(bad); err != ErrQuietHoursInvalidSeverity {
		t.Fatalf("want ErrQuietHoursInvalidSeverity, got %v", err)
	}
}

func TestTrimTimeText(t *testing.T) {
	cases := map[string]string{
		"23:00:00":       "23:00",
		"07:30:00.000":   "07:30",
		" 09:15:00":      "09:15",
		"00:00":          "00:00",
		"":               "",
		"badbad":         "badbad",
		"0":              "0",
	}
	for in, want := range cases {
		got := trimTimeText(in)
		if got != want {
			t.Errorf("trimTimeText(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidHHMM(t *testing.T) {
	good := []string{"00:00", "23:59", "12:30", "01:05"}
	for _, s := range good {
		if !validHHMM(s) {
			t.Errorf("expected %q to be valid", s)
		}
	}
	bad := []string{"24:00", "23:60", "9:00", "9:5", "abcde", "1:1:1", strings.Repeat("0", 4)}
	for _, s := range bad {
		if validHHMM(s) {
			t.Errorf("expected %q to be invalid", s)
		}
	}
}
