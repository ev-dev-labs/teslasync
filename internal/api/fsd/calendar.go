package fsd

import "time"

// civilDate keeps calendar arithmetic separate from timezone transitions.
// Constructing local midnight is unsafe in zones whose DST transition occurs
// at 00:00: Go can normalize the nonexistent wall time into the previous day.
type civilDate struct {
	year  int
	month time.Month
	day   int
}

func civilDateAt(instant time.Time, loc *time.Location) civilDate {
	local := instant.In(loc)
	return civilDate{year: local.Year(), month: local.Month(), day: local.Day()}
}

func (d civilDate) addDays(days int) civilDate {
	// UTC is only a transition-free calendar surrogate here; this value is
	// never used as the actual boundary instant for the requested timezone.
	next := time.Date(d.year, d.month, d.day, 0, 0, 0, 0, time.UTC).AddDate(0, 0, days)
	return civilDate{year: next.Year(), month: next.Month(), day: next.Day()}
}

func (d civilDate) key() string {
	return time.Date(d.year, d.month, d.day, 0, 0, 0, 0, time.UTC).Format(dayLayout)
}

func (d civilDate) compare(other civilDate) int {
	switch {
	case d.year != other.year:
		if d.year < other.year {
			return -1
		}
		return 1
	case d.month != other.month:
		if d.month < other.month {
			return -1
		}
		return 1
	case d.day < other.day:
		return -1
	case d.day > other.day:
		return 1
	default:
		return 0
	}
}

// firstInstantOfLocalDate resolves the lower UTC bound for a civil date.
//
// A binary search over absolute time avoids constructing the potentially
// nonexistent local 00:00 wall time. When a timezone skips an entire civil
// date (for example, a dateline move), the result is the first instant after
// that date; there are no instants to include for the skipped date.
func firstInstantOfLocalDate(date civilDate, loc *time.Location) time.Time {
	anchor := time.Date(date.year, date.month, date.day, 12, 0, 0, 0, time.UTC)
	lo := anchor.Add(-48 * time.Hour)
	hi := anchor.Add(48 * time.Hour)

	for hi.Sub(lo) > time.Nanosecond {
		mid := lo.Add(hi.Sub(lo) / 2)
		if civilDateAt(mid, loc).compare(date) < 0 {
			lo = mid
		} else {
			hi = mid
		}
	}
	return hi
}

func periodBoundary(now time.Time, days int, loc *time.Location) time.Time {
	if days < 1 {
		days = 1
	}
	startDate := civilDateAt(now, loc).addDays(-(days - 1))
	return firstInstantOfLocalDate(startDate, loc)
}
