package fsd

import "time"

// CurrentWeekBounds returns the half-open Monday–next-Monday window in loc
// that contains now. The bounds use the same DST-safe civil-date instants as
// the insights period, so a Sunday still belongs to the week that contains it.
func CurrentWeekBounds(now time.Time, loc *time.Location) (start, end time.Time) {
	if loc == nil {
		loc = time.UTC
	}
	today := civilDateAt(now, loc)
	daysSinceMonday := int((weekdayOf(today) + 6) % 7)
	monday := today.addDays(-daysSinceMonday)
	return firstInstantOfLocalDate(monday, loc), firstInstantOfLocalDate(monday.addDays(7), loc)
}

// PreviousWeekStart is the Monday that opens the week immediately before
// weekStart, in loc. Civil-date arithmetic keeps the previous week aligned
// across DST transitions instead of subtracting a fixed 168h duration.
func PreviousWeekStart(weekStart time.Time, loc *time.Location) time.Time {
	if loc == nil {
		loc = time.UTC
	}
	monday := civilDateAt(weekStart, loc).addDays(-7)
	return firstInstantOfLocalDate(monday, loc)
}

// LoadLocationOrUTC resolves an IANA name, falling back to UTC for empty,
// "UTC", or unknown values. Vehicle timezone defaults to UTC in the database.
func LoadLocationOrUTC(name string) *time.Location {
	if name == "" || name == "UTC" {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

func weekdayOf(d civilDate) time.Weekday {
	return time.Date(d.year, d.month, d.day, 12, 0, 0, 0, time.UTC).Weekday()
}
