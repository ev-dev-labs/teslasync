package computed

import (
	"fmt"
	"time"
)

// IsPercentChangeOp returns true for %_change_ operators that need a
// baseline (previous-window) computation.
func IsPercentChangeOp(op string) bool {
	return op == "%_change_>" || op == "%_change_<"
}

// CompareMetric evaluates `value op threshold` for the simple operators.
// Caller is responsible for handling percent-change ops separately
// because they need a previous-window baseline.
func CompareMetric(op string, value, threshold float64) (bool, error) {
	switch op {
	case ">":
		return value > threshold, nil
	case ">=":
		return value >= threshold, nil
	case "<":
		return value < threshold, nil
	case "<=":
		return value <= threshold, nil
	case "=":
		return value == threshold, nil
	case "!=":
		return value != threshold, nil
	}
	return false, fmt.Errorf("unsupported metric op %q", op)
}

// ComparePercentChange evaluates a %_change_ op. The semantics are:
//   - prev == 0  AND current == 0 → 0% change → never matches
//   - prev == 0  AND current != 0 → undefined, never matches (avoid +Inf alerts)
//   - otherwise change% = (current - prev) / |prev| * 100
func ComparePercentChange(op string, current, prev, thresholdPct float64) (bool, float64, error) {
	if !IsPercentChangeOp(op) {
		return false, 0, fmt.Errorf("not a percent-change op: %q", op)
	}
	if prev == 0 {
		return false, 0, nil
	}
	pct := (current - prev) / abs(prev) * 100
	switch op {
	case "%_change_>":
		return pct > thresholdPct, pct, nil
	case "%_change_<":
		return pct < thresholdPct, pct, nil
	}
	return false, pct, fmt.Errorf("unsupported percent-change op %q", op)
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// WindowBounds returns the [start, end) bounds for the named window in
// UTC. `now` is the moment of evaluation.
//
// Note: day/week/month bounds are computed in UTC for v1. For most users
// this is adequate; users near a timezone boundary may see "today"
// defined slightly differently than their vehicle's clock. Vehicle-local
// windows are a future enhancement (vehicles.timezone exists but is not
// used here yet).
func WindowBounds(window string, now time.Time) (start, end time.Time, err error) {
	now = now.UTC()
	switch window {
	case "day":
		start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		end = now
	case "week":
		offset := int(now.Weekday()) - 1
		if offset < 0 {
			offset += 7
		}
		start = time.Date(now.Year(), now.Month(), now.Day()-offset, 0, 0, 0, 0, time.UTC)
		end = now
	case "month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		end = now
	case "rolling_7d":
		start = now.Add(-7 * 24 * time.Hour)
		end = now
	case "rolling_30d":
		start = now.Add(-30 * 24 * time.Hour)
		end = now
	default:
		return time.Time{}, time.Time{}, fmt.Errorf("unknown window %q", window)
	}
	return start, end, nil
}

// PreviousWindowBounds returns the immediately-preceding window of the
// same length, used by %_change_ operators. For day/week/month, the
// previous window is the previous calendar day/week/month. For rolling_*,
// it is shifted by the window length.
func PreviousWindowBounds(window string, now time.Time) (start, end time.Time, err error) {
	curStart, curEnd, err := WindowBounds(window, now)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	switch window {
	case "day":
		end = curStart
		start = end.Add(-24 * time.Hour)
	case "week":
		end = curStart
		start = end.Add(-7 * 24 * time.Hour)
	case "month":
		end = curStart
		start = time.Date(end.Year(), end.Month()-1, 1, 0, 0, 0, 0, time.UTC)
	case "rolling_7d", "rolling_30d":
		duration := curEnd.Sub(curStart)
		end = curStart
		start = end.Add(-duration)
	default:
		return time.Time{}, time.Time{}, fmt.Errorf("unknown window %q", window)
	}
	return start, end, nil
}

func formatComputedMetricMessage(metric MetricDef, op string, value, threshold, pctChange float64) string {
	if IsPercentChangeOp(op) {
		return fmt.Sprintf("%s changed by %.2f%% (now %.2f %s, threshold %s %.2f%%)",
			metric.Label, pctChange, value, metric.Unit, op, threshold)
	}
	return fmt.Sprintf("%s is %.2f %s %s threshold %.2f",
		metric.Label, value, metric.Unit, op, threshold)
}
