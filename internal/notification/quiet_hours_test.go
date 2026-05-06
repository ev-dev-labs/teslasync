package notification

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// helpers ---------------------------------------------------------------

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", name, err)
	}
	return loc
}

func sleepWindow(tz string) *models.QuietHoursWindow {
	return &models.QuietHoursWindow{
		ID: 1, Enabled: true,
		StartLocal: "23:00", EndLocal: "07:00",
		Timezone: tz, Weekdays: models.QuietHoursWeekdayAll,
		BypassSeverities: []string{"critical"},
	}
}

func lunchWindow(tz string) *models.QuietHoursWindow {
	return &models.QuietHoursWindow{
		ID: 2, Enabled: true,
		StartLocal: "12:00", EndLocal: "13:00",
		Timezone: tz, Weekdays: models.QuietHoursWeekdayMon | models.QuietHoursWeekdayTue |
			models.QuietHoursWeekdayWed | models.QuietHoursWeekdayThu | models.QuietHoursWeekdayFri,
		BypassSeverities: []string{"critical"},
	}
}

// IsWindowActiveAt -----------------------------------------------------

func TestIsWindowActiveAt_SameDayWindow(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	w := lunchWindow("America/New_York")

	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{"before lunch wed", time.Date(2026, 5, 6, 11, 30, 0, 0, loc), false},
		{"start lunch wed", time.Date(2026, 5, 6, 12, 0, 0, 0, loc), true},
		{"middle lunch wed", time.Date(2026, 5, 6, 12, 30, 0, 0, loc), true},
		{"end lunch wed", time.Date(2026, 5, 6, 13, 0, 0, 0, loc), false}, // exclusive
		{"sat lunch", time.Date(2026, 5, 9, 12, 30, 0, 0, loc), false},    // weekday excluded
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := IsWindowActiveAt(w, tc.now)
			if got != tc.want {
				t.Fatalf("IsWindowActiveAt(%s) = %v, want %v", tc.now, got, tc.want)
			}
		})
	}
}

func TestIsWindowActiveAt_CrossMidnightWrap(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	w := sleepWindow("America/New_York") // 23:00 → 07:00, every day

	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{"22:59 mon", time.Date(2026, 5, 4, 22, 59, 0, 0, loc), false},
		{"23:00 mon (start)", time.Date(2026, 5, 4, 23, 0, 0, 0, loc), true},
		{"00:30 tue (after wrap)", time.Date(2026, 5, 5, 0, 30, 0, 0, loc), true},
		{"06:59 tue", time.Date(2026, 5, 5, 6, 59, 0, 0, loc), true},
		{"07:00 tue (end exclusive)", time.Date(2026, 5, 5, 7, 0, 0, 0, loc), false},
		{"08:00 tue", time.Date(2026, 5, 5, 8, 0, 0, 0, loc), false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := IsWindowActiveAt(w, tc.now)
			if got != tc.want {
				t.Fatalf("IsWindowActiveAt(%s) = %v, want %v", tc.now, got, tc.want)
			}
		})
	}
}

func TestIsWindowActiveAt_CrossMidnightWeekdayLeg(t *testing.T) {
	// Sleep window only on Sunday nights into Monday morning.
	// weekdays bitmask = Sun (1)
	loc := mustLoc(t, "UTC")
	w := &models.QuietHoursWindow{
		ID: 5, Enabled: true,
		StartLocal: "23:00", EndLocal: "07:00",
		Timezone: "UTC", Weekdays: models.QuietHoursWeekdaySun,
		BypassSeverities: nil,
	}

	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		// Sun 23:30 → start anchor is Sun → match.
		{"sun 23:30", time.Date(2026, 5, 3, 23, 30, 0, 0, loc), true},
		// Mon 02:00 → wrap leg, anchor day is yesterday (Sun) → match.
		{"mon 02:00", time.Date(2026, 5, 4, 2, 0, 0, 0, loc), true},
		// Mon 23:30 → anchor today is Mon (not in mask) → no.
		{"mon 23:30", time.Date(2026, 5, 4, 23, 30, 0, 0, loc), false},
		// Tue 02:00 → anchor yesterday is Mon → no.
		{"tue 02:00", time.Date(2026, 5, 5, 2, 0, 0, 0, loc), false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := IsWindowActiveAt(w, tc.now)
			if got != tc.want {
				t.Fatalf("IsWindowActiveAt(%s) = %v, want %v", tc.now, got, tc.want)
			}
		})
	}
}

func TestIsWindowActiveAt_DisabledOrInvalid(t *testing.T) {
	loc := mustLoc(t, "UTC")
	now := time.Date(2026, 5, 5, 0, 30, 0, 0, loc)

	if IsWindowActiveAt(nil, now) {
		t.Fatal("nil window must not be active")
	}

	disabled := sleepWindow("UTC")
	disabled.Enabled = false
	if IsWindowActiveAt(disabled, now) {
		t.Fatal("disabled window must not be active")
	}

	badTZ := sleepWindow("Mars/Olympus")
	if IsWindowActiveAt(badTZ, now) {
		t.Fatal("invalid timezone must not be active")
	}

	badTime := sleepWindow("UTC")
	badTime.StartLocal = "9:99"
	if IsWindowActiveAt(badTime, now) {
		t.Fatal("invalid start time must not be active")
	}

	badEqual := sleepWindow("UTC")
	badEqual.StartLocal = "12:00"
	badEqual.EndLocal = "12:00"
	if IsWindowActiveAt(badEqual, now) {
		t.Fatal("equal start/end must not be active")
	}
}

// MatchActiveWindow + severity -------------------------------------------

func TestMatchActiveWindow_SeverityBypass(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	now := time.Date(2026, 5, 5, 0, 30, 0, 0, loc) // Tue 00:30 — inside sleep window
	w := sleepWindow("America/New_York")
	windows := []*models.QuietHoursWindow{w}

	// Non-critical → defer.
	if got, ok := MatchActiveWindow(windows, "info", now); !ok || got != w {
		t.Fatalf("info during sleep: want defer via window 1, got ok=%v", ok)
	}
	// Critical → bypass.
	if _, ok := MatchActiveWindow(windows, "critical", now); ok {
		t.Fatal("critical must bypass during sleep window")
	}
	// Empty severity defaults to info → defer.
	if _, ok := MatchActiveWindow(windows, "", now); !ok {
		t.Fatal("empty severity must default to info and defer")
	}
	// Mixed-case severity matches case-insensitively.
	if _, ok := MatchActiveWindow(windows, "Critical", now); ok {
		t.Fatal("mixed-case Critical must bypass")
	}
}

func TestMatchActiveWindow_MultipleWindows(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	windows := []*models.QuietHoursWindow{lunchWindow("America/New_York"), sleepWindow("America/New_York")}

	// 12:30 Wed → lunch matches first.
	noon := time.Date(2026, 5, 6, 12, 30, 0, 0, loc)
	if got, ok := MatchActiveWindow(windows, "info", noon); !ok || got.ID != 2 {
		t.Fatalf("12:30 want lunch (id=2), got ok=%v id=%d", ok, idOrZero(got))
	}

	// 02:00 Tue → sleep wraps from yesterday.
	sleeping := time.Date(2026, 5, 5, 2, 0, 0, 0, loc)
	if got, ok := MatchActiveWindow(windows, "info", sleeping); !ok || got.ID != 1 {
		t.Fatalf("02:00 want sleep (id=1), got ok=%v id=%d", ok, idOrZero(got))
	}

	// 09:00 Wed → neither window applies.
	morning := time.Date(2026, 5, 6, 9, 0, 0, 0, loc)
	if _, ok := MatchActiveWindow(windows, "info", morning); ok {
		t.Fatal("09:00 must not match any window")
	}
}

func TestMatchActiveWindow_DisabledWindowsSkipped(t *testing.T) {
	loc := mustLoc(t, "UTC")
	now := time.Date(2026, 5, 5, 0, 30, 0, 0, loc)
	w := sleepWindow("UTC")
	w.Enabled = false
	if _, ok := MatchActiveWindow([]*models.QuietHoursWindow{w}, "info", now); ok {
		t.Fatal("disabled window must be skipped")
	}
}

// NextWindowEndAt -------------------------------------------------------

func TestNextWindowEndAt_SameDay(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	w := lunchWindow("America/New_York")
	now := time.Date(2026, 5, 6, 12, 30, 0, 0, loc)

	got := NextWindowEndAt(w, now)
	want := time.Date(2026, 5, 6, 13, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("end = %v, want %v", got, want)
	}
}

func TestNextWindowEndAt_CrossMidnight(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	w := sleepWindow("America/New_York")

	// Now = 23:30 Mon → end is 07:00 Tue.
	now := time.Date(2026, 5, 4, 23, 30, 0, 0, loc)
	got := NextWindowEndAt(w, now)
	want := time.Date(2026, 5, 5, 7, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("end after 23:30 = %v, want %v", got, want)
	}

	// Now = 02:00 Tue → end is 07:00 Tue (same calendar day).
	now2 := time.Date(2026, 5, 5, 2, 0, 0, 0, loc)
	got2 := NextWindowEndAt(w, now2)
	want2 := time.Date(2026, 5, 5, 7, 0, 0, 0, loc)
	if !got2.Equal(want2) {
		t.Fatalf("end after 02:00 = %v, want %v", got2, want2)
	}
}

func TestNextWindowEndAt_NotActive(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	w := lunchWindow("America/New_York")
	now := time.Date(2026, 5, 6, 14, 0, 0, 0, loc) // after lunch
	got := NextWindowEndAt(w, now)
	if !got.IsZero() {
		t.Fatalf("expected zero time when not active, got %v", got)
	}
}

// repoDecider -----------------------------------------------------------

type fakeLister struct {
	rows []*models.QuietHoursWindow
	err  error
}

func (f *fakeLister) ListEnabled(_ context.Context) ([]*models.QuietHoursWindow, error) {
	return f.rows, f.err
}

func TestRepoDecider_DefersOnMatch(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	now := time.Date(2026, 5, 5, 0, 30, 0, 0, loc)
	d := NewRepoDecider(&fakeLister{rows: []*models.QuietHoursWindow{sleepWindow("America/New_York")}})
	if d == nil {
		t.Fatal("NewRepoDecider returned nil for non-nil lister")
	}
	defer1, w, err := d.ShouldDefer(context.Background(), "info", now)
	if err != nil {
		t.Fatal(err)
	}
	if !defer1 || w == nil {
		t.Fatalf("want defer + window, got defer=%v win=%v", defer1, w)
	}
}

func TestRepoDecider_PassesThroughOnError(t *testing.T) {
	d := NewRepoDecider(&fakeLister{err: errors.New("db down")})
	_, _, err := d.ShouldDefer(context.Background(), "info", time.Now())
	if err == nil {
		t.Fatal("expected error to surface")
	}
}

func TestRepoDecider_NilLister(t *testing.T) {
	if d := NewRepoDecider(nil); d != nil {
		t.Fatalf("nil lister should return nil decider, got %T", d)
	}
}

func idOrZero(w *models.QuietHoursWindow) int64 {
	if w == nil {
		return 0
	}
	return w.ID
}
