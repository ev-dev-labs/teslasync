package telemetry

import (
	"fmt"
	"strconv"
)

// Atomic is one (name, value) pair after compound expansion.The handler
// re-routes each Atomic through LookupHot.
type Atomic struct {
	Name  string
	Value any
}

// Flatten dispatches a (name, raw) pair to the appropriate per-kind expander.
// For non-compound names it returns a single-element slice containing the
// raw value unchanged (pass-through). Compound names expand to N atomics.
func Flatten(name string, raw any) ([]Atomic, error) {
	switch name {
	case "DoorState":
		return flattenDoors(raw)
	case "WindowState":
		return flattenWindows(raw)
	case "Location":
		return flattenLocation(raw)
	case "ScheduledChargingStartTime", "ScheduledDepartureTime":
		return flattenTime(name, raw)
	case "ShiftState":
		return flattenShiftState(raw)
	default:
		return flattenPassthrough(name, raw)
	}
}

// Stubs — implementations land in prompts 11-15.
func flattenDoors(raw any) ([]Atomic, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("DoorState: expected map[string]any, got %T", raw)
	}
	parts := []string{
		"DriverFront", "PassengerFront",
		"DriverRear", "PassengerRear",
		"FrontTrunk", "RearTrunk",
	}
	out := make([]Atomic, 0, len(parts))
	for _, p := range parts {
		v, present := m[p]
		if !present {
			continue
		}
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("DoorState.%s: expected string, got %T", p, v)
		}
		out = append(out, Atomic{
			Name:  "DoorState_" + p,
			Value: s == "Open",
		})
	}
	return out, nil
}
func flattenWindows(raw any) ([]Atomic, error)           { return nil, nil }
func flattenLocation(raw any) ([]Atomic, error)          { return nil, nil }
func flattenTime(name string, raw any) ([]Atomic, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s: expected map[string]any, got %T", name, raw)
	}
	h, err := toInt(m["Hour"])
	if err != nil {
		return nil, fmt.Errorf("%s.Hour: %w", name, err)
	}
	mn, err := toInt(m["Minute"])
	if err != nil {
		return nil, fmt.Errorf("%s.Minute: %w", name, err)
	}
	s, err := toInt(m["Second"])
	if err != nil {
		return nil, fmt.Errorf("%s.Second: %w", name, err)
	}
	if h < 0 || h > 23 || mn < 0 || mn > 59 || s < 0 || s > 59 {
		return nil, fmt.Errorf("%s: out-of-range %02d:%02d:%02d", name, h, mn, s)
	}
	return []Atomic{{Name: name, Value: fmt.Sprintf("%02d:%02d:%02d", h, mn, s)}}, nil
}

// toInt accepts float64 (default JSON number type), int, int64, or numeric string.
func toInt(v any) (int, error) {
	switch x := v.(type) {
	case nil:
		return 0, fmt.Errorf("nil")
	case int:
		return x, nil
	case int64:
		return int(x), nil
	case float64:
		return int(x), nil
	case string:
		n, err := strconv.Atoi(x)
		if err != nil {
			return 0, fmt.Errorf("parse int %q: %w", x, err)
		}
		return n, nil
	default:
		return 0, fmt.Errorf("unexpected type %T", v)
	}
}
func flattenShiftState(raw any) ([]Atomic, error)        { return nil, nil }
func flattenPassthrough(name string, raw any) ([]Atomic, error) {
	return []Atomic{{Name: name, Value: raw}}, nil
}
