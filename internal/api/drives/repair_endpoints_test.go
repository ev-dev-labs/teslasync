package drives

import (
	"testing"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

func f64(v float64) *float64 { return &v }

func trow(lat, lon float64) driveTelemetryRow {
	return driveTelemetryRow{Latitude: lat, Longitude: lon}
}

func prow(lat, lon float64) drivePositionRow {
	return drivePositionRow{Latitude: lat, Longitude: lon}
}

func TestRepairDriveEndpoints(t *testing.T) {
	teleTrack := []driveTelemetryRow{trow(47.86, -121.97), trow(47.78, -121.5), trow(47.71, -121.13)}
	posTrack := []drivePositionRow{prow(47.86, -121.97), prow(47.78, -121.5), prow(47.71, -121.13)}

	tests := []struct {
		name                     string
		drive                    *drivemodel.Drive
		telemetry                []driveTelemetryRow
		positions                []drivePositionRow
		wantStartLat, wantEndLat *float64
	}{
		{
			name:         "end equals start is repaired from track end",
			drive:        &drivemodel.Drive{StartLat: f64(47.86), StartLon: f64(-121.97), EndLat: f64(47.86), EndLon: f64(-121.97)},
			telemetry:    teleTrack,
			wantStartLat: f64(47.86),
			wantEndLat:   f64(47.71),
		},
		{
			name:         "nil endpoints are filled from track",
			drive:        &drivemodel.Drive{},
			telemetry:    teleTrack,
			wantStartLat: f64(47.86),
			wantEndLat:   f64(47.71),
		},
		{
			name:         "zero endpoints are filled from track",
			drive:        &drivemodel.Drive{StartLat: f64(0), StartLon: f64(0), EndLat: f64(0), EndLon: f64(0)},
			telemetry:    teleTrack,
			wantStartLat: f64(47.86),
			wantEndLat:   f64(47.71),
		},
		{
			name:         "falls back to positions when telemetry has no coords",
			drive:        &drivemodel.Drive{},
			telemetry:    nil,
			positions:    posTrack,
			wantStartLat: f64(47.86),
			wantEndLat:   f64(47.71),
		},
		{
			name:         "valid distinct endpoints are left untouched",
			drive:        &drivemodel.Drive{StartLat: f64(40.0), StartLon: f64(-70.0), EndLat: f64(41.0), EndLon: f64(-71.0)},
			telemetry:    teleTrack,
			wantStartLat: f64(40.0),
			wantEndLat:   f64(41.0),
		},
		{
			name:         "no track and no stored coords leaves nil",
			drive:        &drivemodel.Drive{},
			telemetry:    nil,
			positions:    nil,
			wantStartLat: nil,
			wantEndLat:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			repairDriveEndpoints(tc.drive, tc.telemetry, tc.positions)
			assertLat(t, "start", tc.drive.StartLat, tc.wantStartLat)
			assertLat(t, "end", tc.drive.EndLat, tc.wantEndLat)
		})
	}
}

func assertLat(t *testing.T, which string, got, want *float64) {
	t.Helper()
	switch {
	case want == nil && got != nil:
		t.Fatalf("%s lat: want nil, got %v", which, *got)
	case want != nil && got == nil:
		t.Fatalf("%s lat: want %v, got nil", which, *want)
	case want != nil && got != nil && *got != *want:
		t.Fatalf("%s lat: want %v, got %v", which, *want, *got)
	}
}
