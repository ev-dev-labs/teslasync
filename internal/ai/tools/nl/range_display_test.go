package nl

import "testing"

// TestProjectRangeDisplay pins the envelope's dual-unit range pair: SI
// canonical meters in, pre-computed km + mi out (cToFPtr precedent). Small
// local models cannot reliably convert fractional miles themselves.
func TestProjectRangeDisplay(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		meters float64
		wantKm float64
		wantMi float64
	}{
		{"zero", 0, 0, 0},
		{"one_mile", 1609.344, 1.609344, 1},
		{"rated_range", 362102.4, 362.1024, 225},
		{"long_trip", 300000, 300, 186.4113583},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := &WatchContextEnvelope{}
			ProjectRangeDisplay(env, tc.meters)
			km, ok := env.RangeKm.(float64)
			if !ok || km < tc.wantKm-1e-6 || km > tc.wantKm+1e-6 {
				t.Errorf("RangeKm = %v, want %v", env.RangeKm, tc.wantKm)
			}
			mi, ok := env.RangeMi.(float64)
			if !ok || mi < tc.wantMi-1e-6 || mi > tc.wantMi+1e-6 {
				t.Errorf("RangeMi = %v, want %v", env.RangeMi, tc.wantMi)
			}
		})
	}
}

func TestProjectRangeDisplayNilEnvelope(t *testing.T) {
	t.Parallel()
	ProjectRangeDisplay(nil, 1000) // must not panic
}
