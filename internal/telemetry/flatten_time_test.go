package telemetry

import "testing"

func TestFlattenTime(t *testing.T) {
	cases := []struct {
		name    string
		in      any
		signal  string
		want    string
		wantErr bool
	}{
		{"midnight", map[string]any{"Hour": 0.0, "Minute": 0.0, "Second": 0.0}, "ScheduledChargingStartTime", "00:00:00", false},
		{"noon", map[string]any{"Hour": 12.0, "Minute": 0.0, "Second": 0.0}, "ScheduledChargingStartTime", "12:00:00", false},
		{"pad single digits", map[string]any{"Hour": 7.0, "Minute": 5.0, "Second": 9.0}, "ScheduledChargingStartTime", "07:05:09", false},
		{"int types", map[string]any{"Hour": 22, "Minute": 30, "Second": 0}, "ScheduledDepartureTime", "22:30:00", false},
		{"string nums", map[string]any{"Hour": "5", "Minute": "5", "Second": "5"}, "ScheduledChargingStartTime", "05:05:05", false},
		{"end of day", map[string]any{"Hour": 23.0, "Minute": 59.0, "Second": 59.0}, "ScheduledDepartureTime", "23:59:59", false},
		{"hour OOB", map[string]any{"Hour": 25.0, "Minute": 0.0, "Second": 0.0}, "ScheduledChargingStartTime", "", true},
		{"minute OOB", map[string]any{"Hour": 1.0, "Minute": 60.0, "Second": 0.0}, "ScheduledChargingStartTime", "", true},
		{"second OOB", map[string]any{"Hour": 1.0, "Minute": 0.0, "Second": 60.0}, "ScheduledChargingStartTime", "", true},
		{"negative hour", map[string]any{"Hour": -1.0, "Minute": 0.0, "Second": 0.0}, "ScheduledChargingStartTime", "", true},
		{"missing minute", map[string]any{"Hour": 1.0, "Second": 0.0}, "ScheduledChargingStartTime", "", true},
		{"wrong top-level type", "22:30:00", "ScheduledChargingStartTime", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := flattenTime(tc.signal, tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if len(got) != 1 {
				t.Fatalf("got %d atomics, want 1: %v", len(got), got)
			}
			if got[0].Name != tc.signal {
				t.Errorf("name = %q, want %q", got[0].Name, tc.signal)
			}
			s, ok := got[0].Value.(string)
			if !ok {
				t.Fatalf("value type = %T, want string", got[0].Value)
			}
			if s != tc.want {
				t.Errorf("value = %q, want %q", s, tc.want)
			}
		})
	}
}
