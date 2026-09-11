package comfort

import (
	"testing"
	"time"
)

const icsFixture = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:one@example.com
DTSTART:20260401T150000Z
SUMMARY:Dentist
LOCATION:123 Main St
END:VEVENT
BEGIN:VEVENT
UID:two@example.com
DTSTART;TZID=America/New_York:20260401T090000
SUMMARY:Standup\,
  continued
LOCATION:
END:VEVENT
BEGIN:VEVENT
UID:allday@example.com
DTSTART;VALUE=DATE:20260402
SUMMARY:Holiday
LOCATION:Home
END:VEVENT
BEGIN:VEVENT
UID:bad@example.com
DTSTART:not-a-date
SUMMARY:Broken
END:VEVENT
BEGIN:VEVENT
DTSTART:20260401T150000Z
SUMMARY:No UID
END:VEVENT
END:VCALENDAR
`

func TestParseICS(t *testing.T) {
	events, err := ParseICS(icsFixture)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("events = %d, want 3 (bad + uidless skipped)", len(events))
	}
	if events[0].Title != "Dentist" || events[0].Location != "123 Main St" {
		t.Fatalf("event0 = %+v", events[0])
	}
	want := time.Date(2026, 4, 1, 15, 0, 0, 0, time.UTC)
	if !events[0].StartsAt.Equal(want) {
		t.Fatalf("event0 start = %v, want %v", events[0].StartsAt, want)
	}
	// Folded + escaped summary.
	if events[1].Title != "Standup, continued" {
		t.Fatalf("event1 title = %q", events[1].Title)
	}
	// 09:00 America/New_York (EDT) = 13:00Z when tzdata is present;
	// without a zone database the parser falls back to floating-as-UTC.
	wantNY := time.Date(2026, 4, 1, 13, 0, 0, 0, time.UTC)
	if _, err := time.LoadLocation("America/New_York"); err != nil {
		wantNY = time.Date(2026, 4, 1, 9, 0, 0, 0, time.UTC)
	}
	if !events[1].StartsAt.Equal(wantNY) {
		t.Fatalf("event1 start = %v, want %v", events[1].StartsAt, wantNY)
	}
	if !events[2].AllDay {
		t.Fatal("event2 should be all-day")
	}
}

func TestNextOffsite(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	mk := func(uid string, at time.Time, loc string, allDay bool) Event {
		return Event{UID: uid, Title: uid, Location: loc, StartsAt: at, AllDay: allDay}
	}
	events := []Event{
		mk("past", now.Add(-time.Hour), "Office", false),
		mk("noloc", now.Add(10*time.Minute), "", false),
		mk("allday", now.Add(10*time.Minute), "Office", true),
		mk("far", now.Add(2*time.Hour), "Office", false),
		mk("later", now.Add(18*time.Minute), "Gym", false),
		mk("sooner", now.Add(9*time.Minute), "Office", false),
	}
	got := NextOffsite(events, now, 20*time.Minute)
	if got == nil || got.UID != "sooner" {
		t.Fatalf("next = %+v, want sooner", got)
	}
	if got := NextOffsite(events, now, 5*time.Minute); got != nil {
		t.Fatalf("next with 5m lead = %+v, want nil", got)
	}
	if got := NextOffsite(nil, now, time.Hour); got != nil {
		t.Fatalf("next with no events = %+v, want nil", got)
	}
}
