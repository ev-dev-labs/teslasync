package telemetry

// Atomic is one (name, value) pair after compound expansion. The handler
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
func flattenDoors(raw any) ([]Atomic, error)             { return nil, nil }
func flattenWindows(raw any) ([]Atomic, error)           { return nil, nil }
func flattenLocation(raw any) ([]Atomic, error)          { return nil, nil }
func flattenTime(name string, raw any) ([]Atomic, error) { return nil, nil }
func flattenShiftState(raw any) ([]Atomic, error)        { return nil, nil }
func flattenPassthrough(name string, raw any) ([]Atomic, error) {
	return []Atomic{{Name: name, Value: raw}}, nil
}
