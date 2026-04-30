package telemetry

import "testing"

func TestFlattenLocation(t *testing.T) {
	cases := []struct {
		name    string
		in      any
		wantLat float64
		wantLng float64
		wantErr bool
	}{
		{"typical SF", map[string]any{"Latitude": 37.7749, "Longitude": -122.4194}, 37.7749, -122.4194, false},
		{"null island", map[string]any{"Latitude": 0.0, "Longitude": 0.0}, 0.0, 0.0, false},
		{"north pole", map[string]any{"Latitude": 90.0, "Longitude": 0.0}, 90.0, 0.0, false},
		{"south pole", map[string]any{"Latitude": -90.0, "Longitude": 0.0}, -90.0, 0.0, false},
		{"antimeridian E", map[string]any{"Latitude": 0.0, "Longitude": 180.0}, 0.0, 180.0, false},
		{"antimeridian W", map[string]any{"Latitude": 0.0, "Longitude": -180.0}, 0.0, -180.0, false},
		{"strings", map[string]any{"Latitude": "1.5", "Longitude": "2.5"}, 1.5, 2.5, false},
		{"int values", map[string]any{"Latitude": 45, "Longitude": -120}, 45.0, -120.0, false},
		{"lat OOB hi", map[string]any{"Latitude": 91.0, "Longitude": 0.0}, 0, 0, true},
		{"lat OOB lo", map[string]any{"Latitude": -91.0, "Longitude": 0.0}, 0, 0, true},
		{"lng OOB hi", map[string]any{"Latitude": 0.0, "Longitude": 181.0}, 0, 0, true},
		{"lng OOB lo", map[string]any{"Latitude": 0.0, "Longitude": -181.0}, 0, 0, true},
		{"missing lng", map[string]any{"Latitude": 0.0}, 0, 0, true},
		{"missing lat", map[string]any{"Longitude": 0.0}, 0, 0, true},
		{"wrong top type", "37.7749,-122.4194", 0, 0, true},
		{"wrong lat type", map[string]any{"Latitude": map[string]any{}, "Longitude": 0.0}, 0, 0, true},
		{"wrong lng type", map[string]any{"Latitude": 0.0, "Longitude": []any{}}, 0, 0, true},
		{"unparseable lat string", map[string]any{"Latitude": "not-a-number", "Longitude": 0.0}, 0, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := flattenLocation(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if len(got) != 2 {
				t.Fatalf("got %d atomics, want 2", len(got))
			}
			if got[0].Name != "Latitude" || got[1].Name != "Longitude" {
				t.Fatalf("names = [%s,%s], want [Latitude,Longitude]", got[0].Name, got[1].Name)
			}
			latVal, ok := got[0].Value.(float64)
			if !ok {
				t.Fatalf("lat value type = %T, want float64", got[0].Value)
			}
			lngVal, ok := got[1].Value.(float64)
			if !ok {
				t.Fatalf("lng value type = %T, want float64", got[1].Value)
			}
			if latVal != tc.wantLat || lngVal != tc.wantLng {
				t.Errorf("got (%v,%v), want (%v,%v)", latVal, lngVal, tc.wantLat, tc.wantLng)
			}
		})
	}
}
