package daylog

import (
	"strings"
	"testing"
)

// This package has no pgxmock or testcontainers harness, so these tests
// assert SQL shape (tables, columns, time bounds, caps, parameterisation)
// plus constructor guards. Query execution is covered by handler tests
// with a fake repo and by the pure event-assembly tests in
// internal/api/daylog.

func TestDayLogSQL_TimeBoundsAndCaps(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		sql      string
		wantCols []string
	}{
		{"drives", dayLogDrivesSQL, []string{"FROM drives", "started_at", "ended_at", "vehicle_id = $1", "ORDER BY started_at ASC"}},
		{"charges", dayLogChargesSQL, []string{"FROM charging_sessions", "started_at", "ended_at", "vehicle_id = $1", "ORDER BY started_at ASC"}},
		{"fsm", dayLogFSMSQL, []string{"FROM fsm_transitions", "fsm_name = 'vehicle'", "ts >=", "ts <=", "ORDER BY ts ASC"}},
		{"security", dayLogSecuritySQL, []string{"FROM security_events", "event_type = ANY($4)", "ts >=", "ORDER BY ts ASC"}},
		{"signal", dayLogSignalSQL, []string{"FROM signal_log", "field = ANY($2)", "ts >=", "ts <=", "LIMIT $5", "ORDER BY ts ASC"}},
		{"gear", dayLogGearSQL, []string{"FROM drive_telemetry", "gear IS NOT NULL", "ts >=", "ts <=", "LIMIT $4", "ORDER BY ts ASC"}},
		{"software", dayLogSoftwareSQL, []string{"FROM software_updates", "created_at BETWEEN", "installed_at BETWEEN", "ORDER BY created_at ASC"}},
		{"vehicleExists", dayLogVehicleExistsSQL, []string{"FROM vehicles", "id = $1"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if strings.Contains(tt.sql, "SELECT *") {
				t.Errorf("query must not SELECT *")
			}
			if strings.Contains(tt.sql, "%s") || strings.Contains(tt.sql, "%d") {
				t.Errorf("query must be fully parameterized, no fmt interpolation")
			}
			lower := strings.ToLower(tt.sql)
			for _, want := range tt.wantCols {
				if !strings.Contains(lower, strings.ToLower(want)) {
					t.Errorf("query missing %q\n%s", want, tt.sql)
				}
			}
		})
	}
}

func TestNewDayLogRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Errorf("NewDayLogRepo(nil) must panic (wiring bug)")
		}
	}()
	_ = NewDayLogRepo(nil)
}
