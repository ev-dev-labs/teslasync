package heretraffic

import (
	"slices"
	"testing"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

func TestDecodeRouteGeometry(t *testing.T) {
	// Published HERE Flexible Polyline version 1 example.
	const polyline = "BFoz5xJ67i1B1B7PzIhaxL7Y"
	want := []domain.Point{
		{Latitude: 50.10228, Longitude: 8.69821},
		{Latitude: 50.10201, Longitude: 8.69567},
		{Latitude: 50.10063, Longitude: 8.69150},
		{Latitude: 50.09878, Longitude: 8.68752},
	}
	if got, ok := decodeRouteGeometry(polyline, 4); !ok || !slices.Equal(got, want) {
		t.Fatalf("unexpected decoded route %v (valid %t)", got, ok)
	}
	for _, invalid := range []struct {
		raw    string
		budget int
	}{
		{polyline, 3},
		{polyline[:len(polyline)-1], 4},
		{"C" + polyline[1:], 4},
		{"B_" + polyline[2:], 4},
		{"BFoz#xJ67i1B1B7PzIhaxL7Y", 4},
	} {
		if _, ok := decodeRouteGeometry(invalid.raw, invalid.budget); ok {
			t.Errorf("decoded malformed or over-budget polyline %q", invalid.raw)
		}
	}
}
