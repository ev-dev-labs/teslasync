package enums

import "strings"

// ParseHvacPower reports whether the HvacPower canonical short form
// indicates the climate system is on or preconditioning. The codec
// emits short strings into signal.Store per protomodel.DecodeValue;
// this is a simple substring predicate, NOT a translation layer.
func ParseHvacPower(raw string) bool {
	return strings.Contains(raw, "On") || strings.Contains(raw, "Precondition")
}
