package teslaphysics

import (
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func coerceString(v signal.SignalValue) (string, bool) {
	if v == nil {
		return "", false
	}
	switch val := v.(type) {
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return "", false
		}
		return s, true
	case []byte:
		s := strings.TrimSpace(string(val))
		if s == "" {
			return "", false
		}
		return s, true
	default:
		return "", false
	}
}

func coerceBool(v signal.SignalValue) (bool, bool) {
	if v == nil {
		return false, false
	}
	switch val := v.(type) {
	case bool:
		return val, true
	case string:
		switch strings.ToLower(strings.TrimSpace(val)) {
		case "true", "1", "on", "yes", "engaged":
			return true, true
		case "false", "0", "off", "no":
			return false, true
		}
	}
	if n, ok := signal.Float64(v); ok {
		return n != 0, true
	}
	return false, false
}

func fieldString(fields map[string]signal.SignalValue, keys ...string) string {
	for _, key := range keys {
		if s, ok := coerceString(fields[key]); ok {
			return s
		}
	}
	return ""
}

func fieldFloat(fields map[string]signal.SignalValue, keys ...string) *float64 {
	for _, key := range keys {
		if n, ok := signal.Float64(fields[key]); ok {
			v := n
			return &v
		}
	}
	return nil
}

func fieldBool(fields map[string]signal.SignalValue, keys ...string) *bool {
	for _, key := range keys {
		if b, ok := coerceBool(fields[key]); ok {
			v := b
			return &v
		}
	}
	return nil
}

func normalizeChargeState(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	for _, prefix := range []string{"DetailedChargeState", "ChargeState"} {
		if strings.HasPrefix(s, prefix) {
			s = strings.TrimPrefix(s, prefix)
			break
		}
	}
	switch {
	case enums.IsChargeEnded(s) || s == enums.ChargeStateDisconnected:
		return enums.ChargeStateDisconnected
	case enums.IsChargeComplete(s) || s == enums.ChargeStateComplete:
		return enums.ChargeStateComplete
	case strings.Contains(s, enums.ChargeStateStarting) || s == "Enable":
		return enums.ChargeStateStarting
	case strings.Contains(s, enums.ChargeStateCharging):
		return enums.ChargeStateCharging
	case strings.Contains(s, enums.ChargeStateStopped):
		return enums.ChargeStateStopped
	case strings.Contains(s, enums.ChargeStateNoPower):
		return enums.ChargeStateNoPower
	default:
		return s
	}
}

func normalizeGear(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	s = strings.TrimPrefix(s, "ShiftState")
	switch strings.ToUpper(s) {
	case enums.GearPark, "PARK":
		return enums.GearPark
	case enums.GearDrive, "DRIVE":
		return enums.GearDrive
	case enums.GearReverse, "REVERSE":
		return enums.GearReverse
	case enums.GearNeutral, "NEUTRAL":
		return enums.GearNeutral
	default:
		return s
	}
}

func parseScheduledStart(v signal.SignalValue, sampleAt time.Time) *time.Time {
	if v == nil {
		return nil
	}
	if t, ok := v.(time.Time); ok && !t.IsZero() {
		utc := t.UTC()
		return &utc
	}
	if s, ok := coerceString(v); ok {
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			utc := t.UTC()
			return &utc
		}
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			utc := t.UTC()
			return &utc
		}
	}
	n, ok := signal.Float64(v)
	if !ok {
		return nil
	}
	switch {
	case n >= 1e12:
		t := time.UnixMilli(int64(n)).UTC()
		return &t
	case n >= 1e9:
		t := time.Unix(int64(n), 0).UTC()
		return &t
	case n >= 0 && n < 24*60:
		base := time.Date(sampleAt.UTC().Year(), sampleAt.UTC().Month(), sampleAt.UTC().Day(), 0, 0, 0, 0, time.UTC)
		t := base.Add(time.Duration(n) * time.Minute)
		return &t
	default:
		return nil
	}
}

func durationSeconds(from, to time.Time) float64 {
	if !to.After(from) {
		return 0
	}
	return to.Sub(from).Seconds()
}

func floatPtr(v float64) *float64 { return &v }

func stringPtr(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func timePtr(v time.Time) *time.Time {
	if v.IsZero() {
		return nil
	}
	copied := v.UTC()
	return &copied
}
