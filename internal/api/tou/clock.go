package tou

import (
	"fmt"
	"time"
)

// ParseClock parses an exact wall-clock HH:MM value in 24-hour time.
func ParseClock(value string) (hour, minute int, err error) {
	if len(value) != 5 || value[2] != ':' {
		return 0, 0, fmt.Errorf("ready_by must be HH:MM (24h)")
	}
	h0, h1, m0, m1 := value[0], value[1], value[3], value[4]
	if h0 < '0' || h0 > '9' || h1 < '0' || h1 > '9' ||
		m0 < '0' || m0 > '9' || m1 < '0' || m1 > '9' {
		return 0, 0, fmt.Errorf("ready_by must be HH:MM (24h)")
	}
	hour = int(h0-'0')*10 + int(h1-'0')
	minute = int(m0-'0')*10 + int(m1-'0')
	if hour > 23 || minute > 59 {
		return 0, 0, fmt.Errorf("ready_by must be HH:MM (24h)")
	}
	return hour, minute, nil
}

// NextClockTime resolves an exact wall-clock time on the next future date.
func NextClockTime(clock string, now time.Time) (time.Time, error) {
	hour, minute, err := ParseClock(clock)
	if err != nil {
		return time.Time{}, err
	}
	next := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next, nil
}
