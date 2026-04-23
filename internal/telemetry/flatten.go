package telemetry

import "fmt"

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
func flattenTime(name string, raw any) ([]Atomic, error) { return nil, nil }
func flattenShiftState(raw any) ([]Atomic, error)        { return nil, nil }
func flattenPassthrough(name string, raw any) ([]Atomic, error) {
	return []Atomic{{Name: name, Value: raw}}, nil
}
