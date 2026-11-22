package smartreadiness

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type fakeGeofences struct {
	place *systemmodel.Geofence
	err   error
}

func (f fakeGeofences) GetByID(context.Context, int64) (*systemmodel.Geofence, error) {
	return f.place, f.err
}

func TestChargingPlaceRequiresActualSimplePolygon(t *testing.T) {
	tests := []struct {
		name string
		wkt  string
		lat  float64
		lon  float64
		want bool
	}{
		{"inside", "POLYGON((0 0,2 0,2 2,0 2,0 0))", 1, 1, true},
		{"generated charging place", systemmodel.CircleToPolygonWKT(47.1, -122.1, 75), 47.1, -122.1, true},
		{"outside", "POLYGON((0 0,2 0,2 2,0 2,0 0))", 3, 1, false},
		{"boundary", "POLYGON((0 0,2 0,2 2,0 2,0 0))", 0, 1, false},
		{"outside concave polygon", "POLYGON((0 0,2 0,2 1,1 1,1 2,0 2,0 0))", 1.5, 1.5, false},
		{"hole unsupported", "POLYGON((0 0,3 0,3 3,0 3,0 0),(1 1,2 1,2 2,1 2,1 1))", 1.5, 1.5, false},
		{"self intersection", "POLYGON((0 0,2 2,0 2,2 0,0 0))", 0.5, 0.5, false},
		{"antimeridian ambiguous", "POLYGON((179 0,-179 0,-179 2,179 2,179 0))", 1, 180, false},
		{"unclosed", "POLYGON((0 0,2 0,2 2,0 2))", 1, 1, false},
		{"invalid coordinate", "POLYGON((0 0,2 0,2 2,0 2,0 0))", math.NaN(), 1, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := containsSimplePolygon(test.wkt, test.lat, test.lon); got != test.want {
				t.Fatalf("contains = %v, want %v", got, test.want)
			}
		})
	}
}

func TestChargingPlaceMustRemainActiveAndReviewed(t *testing.T) {
	now := time.Now()
	base := systemmodel.Geofence{
		PolygonWKT: "POLYGON((0 0,2 0,2 2,0 2,0 0))",
		Enabled:    true, IsChargingLocation: true,
	}
	tests := []struct {
		name   string
		change func(*systemmodel.Geofence)
		want   bool
	}{
		{"active", func(*systemmodel.Geofence) {}, true},
		{"disabled", func(g *systemmodel.Geofence) { g.Enabled = false }, false},
		{"unreviewed", func(g *systemmodel.Geofence) { g.NeedsReview = true }, false},
		{"archived", func(g *systemmodel.Geofence) { g.ArchivedAt = &now }, false},
		{"not a charger", func(g *systemmodel.Geofence) { g.IsChargingLocation = false }, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			place := base
			test.change(&place)
			got, err := NewSites(fakeGeofences{place: &place}).Contains(context.Background(), 1, 1, 1)
			if err != nil || got != test.want {
				t.Fatalf("contains = %v, %v; want %v", got, err, test.want)
			}
		})
	}
	want := errors.New("unavailable")
	if _, err := NewSites(fakeGeofences{err: want}).Contains(context.Background(), 1, 1, 1); !errors.Is(err, want) {
		t.Fatalf("lookup error = %v, want wrapped error", err)
	}
}
