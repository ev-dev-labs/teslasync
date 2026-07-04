package teslaenergyhist

import (
	"testing"
	"time"
)

// ptrF returns a pointer to the given float64 — the Tesla energy fields
// are nullable (*float64) so the parsers must round-trip both present and
// absent values.
func ptrF(v float64) *float64 { return &v }

// mustRFC3339 parses an RFC3339 timestamp or fails the test. Used to build
// the expected time.Time values the parsers should produce.
func mustRFC3339(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("bad fixture timestamp %q: %v", s, err)
	}
	return ts
}

func eqFloatPtr(a, b *float64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// ---------------------------------------------------------------------------
// parseEnergyHistoryResponse
// ---------------------------------------------------------------------------

func TestParseEnergyHistoryResponse(t *testing.T) {
	t.Parallel()

	const siteID int64 = 42
	const period = "day"

	tests := []struct {
		name    string
		body    string
		wantLen int
		wantErr bool
	}{
		{
			name:    "invalid_json",
			body:    `{not valid json`,
			wantErr: true,
		},
		{
			name:    "empty_time_series",
			body:    `{"response":{"serial_number":"STE","period":"day","time_series":[]}}`,
			wantLen: 0,
		},
		{
			name:    "missing_response_object",
			body:    `{}`,
			wantLen: 0,
		},
		{
			name: "single_full_point",
			body: `{"response":{"time_series":[
				{"timestamp":"2026-01-01T00:00:00Z",
				 "solar_energy_exported":1000.5,
				 "battery_energy_imported_from_grid":200,
				 "battery_energy_exported_to_grid":150,
				 "grid_energy_imported":50,
				 "grid_energy_exported_from_solar":30,
				 "consumer_energy_imported_from_grid":80}]}}`,
			wantLen: 1,
		},
		{
			name: "null_optional_fields",
			body: `{"response":{"time_series":[
				{"timestamp":"2026-01-01T00:00:00Z"}]}}`,
			wantLen: 1,
		},
		{
			name: "bad_timestamp_skipped",
			body: `{"response":{"time_series":[
				{"timestamp":"2026-01-01","solar_energy_exported":1},
				{"timestamp":"2026-01-02T00:00:00Z","solar_energy_exported":2}]}}`,
			wantLen: 1,
		},
		{
			name: "non_object_point_skipped",
			body: `{"response":{"time_series":[
				123,
				{"timestamp":"2026-01-02T00:00:00Z","solar_energy_exported":2}]}}`,
			wantLen: 1,
		},
		{
			name: "multiple_points",
			body: `{"response":{"time_series":[
				{"timestamp":"2026-01-01T00:00:00Z","solar_energy_exported":1},
				{"timestamp":"2026-01-02T00:00:00Z","solar_energy_exported":2},
				{"timestamp":"2026-01-03T00:00:00Z","solar_energy_exported":3}]}}`,
			wantLen: 3,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseEnergyHistoryResponse([]byte(tt.body), siteID, period)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (out=%v)", got)
				}
				if got != nil {
					t.Errorf("on error entries should be nil, got %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
			for _, e := range got {
				if e.EnergySiteID != siteID {
					t.Errorf("EnergySiteID = %d, want %d", e.EnergySiteID, siteID)
				}
				if e.Period != period {
					t.Errorf("Period = %q, want %q", e.Period, period)
				}
				if e.Timestamp.IsZero() {
					t.Errorf("Timestamp is zero for %+v", e)
				}
			}
		})
	}
}

// Field mapping is asserted separately so a copy-paste error in the
// snake_case JSON keys (e.g. solar mapped to grid) is caught.
func TestParseEnergyHistoryResponse_FieldMapping(t *testing.T) {
	t.Parallel()

	body := `{"response":{"time_series":[
		{"timestamp":"2026-01-01T00:00:00Z",
		 "solar_energy_exported":1000.5,
		 "battery_energy_imported_from_grid":200.25,
		 "battery_energy_exported_to_grid":150.75,
		 "grid_energy_imported":50.5,
		 "grid_energy_exported_from_solar":30.5,
		 "consumer_energy_imported_from_grid":80.5}]}}`

	got, err := parseEnergyHistoryResponse([]byte(body), 7, "week")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	e := got[0]

	wantTS := mustRFC3339(t, "2026-01-01T00:00:00Z")
	if !e.Timestamp.Equal(wantTS) {
		t.Errorf("Timestamp = %v, want %v", e.Timestamp, wantTS)
	}
	if !eqFloatPtr(e.SolarEnergyWh, ptrF(1000.5)) {
		t.Errorf("SolarEnergyWh = %v, want 1000.5", e.SolarEnergyWh)
	}
	if !eqFloatPtr(e.BatteryEnergyInWh, ptrF(200.25)) {
		t.Errorf("BatteryEnergyInWh = %v, want 200.25", e.BatteryEnergyInWh)
	}
	if !eqFloatPtr(e.BatteryEnergyOutWh, ptrF(150.75)) {
		t.Errorf("BatteryEnergyOutWh = %v, want 150.75", e.BatteryEnergyOutWh)
	}
	if !eqFloatPtr(e.GridEnergyInWh, ptrF(50.5)) {
		t.Errorf("GridEnergyInWh = %v, want 50.5", e.GridEnergyInWh)
	}
	if !eqFloatPtr(e.GridEnergyOutWh, ptrF(30.5)) {
		t.Errorf("GridEnergyOutWh = %v, want 30.5", e.GridEnergyOutWh)
	}
	if !eqFloatPtr(e.ConsumerEnergyWh, ptrF(80.5)) {
		t.Errorf("ConsumerEnergyWh = %v, want 80.5", e.ConsumerEnergyWh)
	}
}

// A point with no optional fields must yield nil pointers (not 0) so the
// wire contract can distinguish "no data" from "zero energy".
func TestParseEnergyHistoryResponse_NullFieldsStayNil(t *testing.T) {
	t.Parallel()

	body := `{"response":{"time_series":[{"timestamp":"2026-01-01T00:00:00Z"}]}}`
	got, err := parseEnergyHistoryResponse([]byte(body), 1, "day")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	e := got[0]
	if e.SolarEnergyWh != nil || e.BatteryEnergyInWh != nil || e.BatteryEnergyOutWh != nil ||
		e.GridEnergyInWh != nil || e.GridEnergyOutWh != nil || e.ConsumerEnergyWh != nil {
		t.Errorf("expected all optional fields nil, got %+v", e)
	}
}

// ---------------------------------------------------------------------------
// parseBackupHistoryResponse
// ---------------------------------------------------------------------------

func TestParseBackupHistoryResponse(t *testing.T) {
	t.Parallel()

	const siteID int64 = 99
	const period = "month"

	tests := []struct {
		name    string
		body    string
		wantLen int
		wantErr bool
	}{
		{name: "invalid_json", body: `{`, wantErr: true},
		{name: "empty", body: `{"response":{"time_series":[]}}`, wantLen: 0},
		{
			name:    "single_event",
			body:    `{"response":{"time_series":[{"timestamp":"2026-02-01T12:00:00Z","duration":3600}]}}`,
			wantLen: 1,
		},
		{
			name: "bad_timestamp_skipped",
			body: `{"response":{"time_series":[
				{"timestamp":"nope","duration":100},
				{"timestamp":"2026-02-02T00:00:00Z","duration":200}]}}`,
			wantLen: 1,
		},
		{
			name: "non_object_skipped",
			body: `{"response":{"time_series":[
				"garbage",
				{"timestamp":"2026-02-02T00:00:00Z","duration":200}]}}`,
			wantLen: 1,
		},
		{
			name: "missing_duration_defaults_zero",
			body: `{"response":{"time_series":[{"timestamp":"2026-02-01T12:00:00Z"}]}}`,
			wantLen: 1,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseBackupHistoryResponse([]byte(tt.body), siteID, period)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
			for _, e := range got {
				if e.EnergySiteID != siteID {
					t.Errorf("EnergySiteID = %d, want %d", e.EnergySiteID, siteID)
				}
				if e.Period != period {
					t.Errorf("Period = %q, want %q", e.Period, period)
				}
			}
		})
	}
}

func TestParseBackupHistoryResponse_DurationMapped(t *testing.T) {
	t.Parallel()
	body := `{"response":{"time_series":[{"timestamp":"2026-02-01T12:00:00Z","duration":7200}]}}`
	got, err := parseBackupHistoryResponse([]byte(body), 5, "day")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].DurationSeconds != 7200 {
		t.Errorf("DurationSeconds = %d, want 7200", got[0].DurationSeconds)
	}
	wantTS := mustRFC3339(t, "2026-02-01T12:00:00Z")
	if !got[0].Timestamp.Equal(wantTS) {
		t.Errorf("Timestamp = %v, want %v", got[0].Timestamp, wantTS)
	}
}

// ---------------------------------------------------------------------------
// parseWCChargingResponse
// ---------------------------------------------------------------------------

func TestParseWCChargingResponse(t *testing.T) {
	t.Parallel()

	const siteID int64 = 314

	tests := []struct {
		name    string
		body    string
		wantLen int
		wantErr bool
	}{
		{name: "invalid_json", body: `nope`, wantErr: true},
		{name: "empty_data", body: `{"response":{"data":[]}}`, wantLen: 0},
		{name: "missing_data_key", body: `{"response":{}}`, wantLen: 0},
		{
			name:    "single_record",
			body:    `{"response":{"data":[{"timestamp":"2026-03-01T09:30:00Z","din":"1457768-02-F","energy_wh":5000.5}]}}`,
			wantLen: 1,
		},
		{
			name:    "null_din_and_energy",
			body:    `{"response":{"data":[{"timestamp":"2026-03-01T09:30:00Z"}]}}`,
			wantLen: 1,
		},
		{
			name: "bad_timestamp_skipped",
			body: `{"response":{"data":[
				{"timestamp":"","energy_wh":1},
				{"timestamp":"2026-03-02T00:00:00Z","energy_wh":2}]}}`,
			wantLen: 1,
		},
		{
			name: "non_object_skipped",
			body: `{"response":{"data":[
				false,
				{"timestamp":"2026-03-02T00:00:00Z","energy_wh":2}]}}`,
			wantLen: 1,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseWCChargingResponse([]byte(tt.body), siteID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
			for _, e := range got {
				if e.EnergySiteID != siteID {
					t.Errorf("EnergySiteID = %d, want %d", e.EnergySiteID, siteID)
				}
			}
		})
	}
}

func TestParseWCChargingResponse_FieldMapping(t *testing.T) {
	t.Parallel()

	body := `{"response":{"data":[{"timestamp":"2026-03-01T09:30:00Z","din":"1457768-02-F","energy_wh":5000.5}]}}`
	got, err := parseWCChargingResponse([]byte(body), 8)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	e := got[0]
	if e.DIN == nil || *e.DIN != "1457768-02-F" {
		t.Errorf("DIN = %v, want 1457768-02-F", e.DIN)
	}
	if !eqFloatPtr(e.EnergyWh, ptrF(5000.5)) {
		t.Errorf("EnergyWh = %v, want 5000.5", e.EnergyWh)
	}
	wantTS := mustRFC3339(t, "2026-03-01T09:30:00Z")
	if !e.Timestamp.Equal(wantTS) {
		t.Errorf("Timestamp = %v, want %v", e.Timestamp, wantTS)
	}
}

func TestParseWCChargingResponse_NullDINStaysNil(t *testing.T) {
	t.Parallel()
	body := `{"response":{"data":[{"timestamp":"2026-03-01T09:30:00Z"}]}}`
	got, err := parseWCChargingResponse([]byte(body), 8)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].DIN != nil {
		t.Errorf("DIN = %v, want nil", got[0].DIN)
	}
	if got[0].EnergyWh != nil {
		t.Errorf("EnergyWh = %v, want nil", got[0].EnergyWh)
	}
}
