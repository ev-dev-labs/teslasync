package httputil

import (
	"fmt"
	"strings"
	"time"
)

// ParseDateRangeValues preserves inclusive SQL bounds: date-only ends include the UTC day;
// RFC3339 ends are exclusive and shifted back one microsecond.
func ParseDateRangeValues(startRaw, endRaw string) (startTime, endTime time.Time, err error) {
	if raw := strings.TrimSpace(startRaw); raw != "" {
		startTime, err = parseDateBound(raw, false)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("start must be an RFC3339 timestamp or YYYY-MM-DD date")
		}
	}
	if raw := strings.TrimSpace(endRaw); raw != "" {
		endTime, err = parseDateBound(raw, true)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("end must be an RFC3339 timestamp or YYYY-MM-DD date")
		}
	}
	if err := ValidateDateRange(startTime, endTime, 0); err != nil {
		return time.Time{}, time.Time{}, err
	}
	return startTime, endTime, nil
}

func parseDateBound(raw string, isEnd bool) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		if isEnd {
			return t.Add(-time.Microsecond), nil
		}
		return t, nil
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, err
	}
	if isEnd {
		return t.Add(24*time.Hour - time.Second), nil
	}
	return t, nil
}

// ValidateDateRange rejects reversed or oversized supplied bounds.
func ValidateDateRange(startTime, endTime time.Time, maxSpan time.Duration) error {
	if !startTime.IsZero() && !endTime.IsZero() && startTime.After(endTime) {
		return fmt.Errorf("start must not be after end")
	}
	if maxSpan > 0 && !startTime.IsZero() && !endTime.IsZero() && endTime.Sub(startTime) > maxSpan {
		return fmt.Errorf("requested date range exceeds maximum of %d days", int(maxSpan.Hours()/24))
	}
	return nil
}
