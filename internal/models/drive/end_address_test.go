package drive

import "testing"

func strPtr(s string) *string   { return &s }
func f64Ptr(v float64) *float64 { return &v }
func i64Ptr(v int64) *int64     { return &v }

// Bothell (Canyon Park) -> Redmond: clearly different coordinates (~13 km).
var (
	bothellLat, bothellLon = 47.8060, -122.2050
	redmondLat, redmondLon = 47.6740, -122.1215
)

func TestHaversineMeters_BothellToRedmond(t *testing.T) {
	d := HaversineMeters(bothellLat, bothellLon, redmondLat, redmondLon)
	if d < 10000 || d > 20000 {
		t.Errorf("HaversineMeters(Bothell, Redmond) = %.0f m, want ~13 km", d)
	}
	if got := HaversineMeters(bothellLat, bothellLon, bothellLat, bothellLon); got != 0 {
		t.Errorf("HaversineMeters(same point) = %.0f, want 0", got)
	}
}

func TestHasDuplicateEndAddress(t *testing.T) {
	addr := "19720 Bothell Everett Highway, Bothell"
	tests := []struct {
		name  string
		drive *Drive
		want  bool
	}{
		{
			name: "same label far apart is suspect",
			drive: &Drive{StartAddress: strPtr(addr), EndAddress: strPtr(addr),
				StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
				EndLat: f64Ptr(redmondLat), EndLon: f64Ptr(redmondLon)},
			want: true,
		},
		{
			name: "genuine round trip keeps same label",
			drive: &Drive{StartAddress: strPtr(addr), EndAddress: strPtr(addr),
				StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
				EndLat: f64Ptr(bothellLat + 0.0001), EndLon: f64Ptr(bothellLon)},
			want: false,
		},
		{
			name: "different labels far apart are fine",
			drive: &Drive{StartAddress: strPtr(addr), EndAddress: strPtr("1 Microsoft Way, Redmond"),
				StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
				EndLat: f64Ptr(redmondLat), EndLon: f64Ptr(redmondLon)},
			want: false,
		},
		{
			name: "missing end label is not a duplicate",
			drive: &Drive{StartAddress: strPtr(addr),
				StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
				EndLat: f64Ptr(redmondLat), EndLon: f64Ptr(redmondLon)},
			want: false,
		},
		{
			name:  "missing coordinates cannot be judged",
			drive: &Drive{StartAddress: strPtr(addr), EndAddress: strPtr(addr)},
			want:  false,
		},
		{
			name: "same geofence explains same label",
			drive: &Drive{StartAddress: strPtr("Home"), EndAddress: strPtr("Home"),
				StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
				EndLat: f64Ptr(redmondLat), EndLon: f64Ptr(redmondLon),
				StartGeofenceID: i64Ptr(7), EndGeofenceID: i64Ptr(7)},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.drive.HasDuplicateEndAddress(); got != tt.want {
				t.Errorf("HasDuplicateEndAddress() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestClearSuspectEndAddress(t *testing.T) {
	addr := "19720 Bothell Everett Highway, Bothell"
	d := &Drive{StartAddress: strPtr(addr), EndAddress: strPtr(addr),
		StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
		EndLat: f64Ptr(redmondLat), EndLon: f64Ptr(redmondLon)}
	if !d.ClearSuspectEndAddress() {
		t.Fatal("ClearSuspectEndAddress() = false, want true for far duplicate")
	}
	if d.EndAddress != nil {
		t.Errorf("EndAddress = %v, want nil (unavailable, never the start address)", *d.EndAddress)
	}
	if d.StartAddress == nil || *d.StartAddress != addr {
		t.Errorf("StartAddress changed: %v", d.StartAddress)
	}
	// Round trip is untouched.
	rt := &Drive{StartAddress: strPtr(addr), EndAddress: strPtr(addr),
		StartLat: f64Ptr(bothellLat), StartLon: f64Ptr(bothellLon),
		EndLat: f64Ptr(bothellLat), EndLon: f64Ptr(bothellLon)}
	if rt.ClearSuspectEndAddress() || rt.EndAddress == nil {
		t.Error("round trip end address must be kept")
	}
}
