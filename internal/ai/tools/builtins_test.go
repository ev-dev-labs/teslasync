package tools

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// fake repos --------------------------------------------------------------

type fakeVehicles struct {
	all []*vehiclemodel.Vehicle
	one map[int64]*vehiclemodel.Vehicle
	err error
}

func (f *fakeVehicles) GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error) {
	return f.all, f.err
}
func (f *fakeVehicles) GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.one[id], nil
}

type fakeState struct {
	values map[string]any
}

func (f *fakeState) SignalAt(ctx context.Context, vid int64, sig string, at time.Time) (any, error) {
	return f.values[sig], nil
}

type fakeDrives struct {
	rows []*drivemodel.Drive
	one  map[int64]*drivemodel.Drive
}

func (f *fakeDrives) GetByVehicle(ctx context.Context, vid int64, limit, off int, st, et time.Time) ([]*drivemodel.Drive, error) {
	if limit > 0 && limit < len(f.rows) {
		return f.rows[:limit], nil
	}
	return f.rows, nil
}
func (f *fakeDrives) GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error) {
	return f.one[id], nil
}

type fakeCharges struct {
	rows []*chargingmodel.ChargingSession
	one  map[int64]*chargingmodel.ChargingSession
}

func (f *fakeCharges) GetByVehicle(ctx context.Context, vid int64, limit, off int, st, et time.Time) ([]*chargingmodel.ChargingSession, error) {
	if limit > 0 && limit < len(f.rows) {
		return f.rows[:limit], nil
	}
	return f.rows, nil
}
func (f *fakeCharges) GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error) {
	return f.one[id], nil
}

type fakeRules struct {
	rules []*alertmodel.AlertRule
}

func (f *fakeRules) GetAll(ctx context.Context) ([]*alertmodel.AlertRule, error) { return f.rules, nil }

type fakeNotif struct {
	logs []*notificationmodel.NotificationLog
}

func (f *fakeNotif) GetAlertLogs(ctx context.Context, limit, off int) ([]*notificationmodel.NotificationLog, error) {
	return f.logs, nil
}

type fakeFences struct {
	fences []*systemmodel.Geofence
}

func (f *fakeFences) GetAll(ctx context.Context) ([]*systemmodel.Geofence, error) {
	return f.fences, nil
}

// Register12Builtins basic shape ------------------------------------------

func TestRegister12Builtins_RegistersAllByName(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})

	got := r.Names()
	if !reflect.DeepEqual(got, BuiltinNames) {
		t.Errorf("Names() = %v\nwant     %v", got, BuiltinNames)
	}
	if len(got) != 12 {
		t.Fatalf("expected 12 builtins, got %d", len(got))
	}
}

// Per-tool execution tests ------------------------------------------------

func TestQueryVehicleCount(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	model := "Model 3"
	src := &fakeVehicles{all: []*vehiclemodel.Vehicle{
		{ID: 1, DisplayName: "Roadie", VIN: "redacted-one", Model: &model},
		{ID: 2, DisplayName: "Comet", VIN: "redacted-two"},
		{ID: 3, DisplayName: "Archived", VIN: "redacted-three", ArchivedAt: timePointer(time.Now().UTC())},
	}}
	Register12Builtins(r, Sources{
		Vehicles:      src,
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_vehicle_count")
	in, err := tool.Validate(json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	m := out.(map[string]any)
	if m["count"].(int) != 3 {
		t.Errorf("count = %v, want 3", m["count"])
	}
	encoded, err := json.Marshal(m["vehicles"])
	if err != nil {
		t.Fatalf("marshal summaries: %v", err)
	}
	got := string(encoded)
	for _, want := range []string{`"id":1`, `"display_name":"Roadie"`, `"model":"Model 3"`, `"active":false`} {
		if !strings.Contains(got, want) {
			t.Errorf("vehicle summaries missing %s: %s", want, got)
		}
	}
	if strings.Contains(got, "redacted-one") || strings.Contains(got, `"vin"`) {
		t.Errorf("vehicle discovery leaked VIN data: %s", got)
	}
}

func TestQueryVehicleState_RejectsMissingID(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_vehicle_state")
	if _, err := tool.Validate(json.RawMessage(`{}`)); err == nil {
		t.Error("expected required error")
	}
}

func TestQueryVehicleState_ReturnsKnownVehicle(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	v := &vehiclemodel.Vehicle{ID: 7, DisplayName: "Modelina", VIN: "5YJSA1E10HF000007", Timezone: "UTC"}
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{one: map[int64]*vehiclemodel.Vehicle{7: v}},
		VehicleState:  &fakeState{values: map[string]any{"VehicleState": "park"}},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_vehicle_state")
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 7}`))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	m := out.(map[string]any)
	if m["display_name"] != "Modelina" {
		t.Errorf("display_name = %v", m["display_name"])
	}
	if m["state"] != "park" {
		t.Errorf("state = %v, want park", m["state"])
	}
}

func TestQueryVehicleLocation(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles: &fakeVehicles{},
		VehicleState: &fakeState{values: map[string]any{
			"LocationLatitude":  37.5,
			"LocationLongitude": -122.3,
			"GpsHeading":        180.0,
		}},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_vehicle_location")
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	m := out.(map[string]any)
	if m["latitude"] != 37.5 || m["longitude"] != -122.3 {
		t.Errorf("location = %v", m)
	}
}

func TestQueryDrivesRecent_RespectsLimit(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{rows: []*drivemodel.Drive{{ID: 1}, {ID: 2}, {ID: 3}}},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_drives_recent")
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 1, "limit": 2}`))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	m := out.(map[string]any)
	if m["count"].(int) != 2 {
		t.Errorf("count = %v, want 2", m["count"])
	}
}

func TestQueryDriveDetail_NotFound(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{one: map[int64]*drivemodel.Drive{}},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_drive_detail")
	in, _ := tool.Validate(json.RawMessage(`{"drive_id": 99}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Error("expected not-found error")
	}
}

func TestQueryAlertsActive_FiltersDisabled(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:     &fakeVehicles{},
		VehicleState: &fakeState{},
		Drives:       &fakeDrives{},
		Charges:      &fakeCharges{},
		AlertRules: &fakeRules{rules: []*alertmodel.AlertRule{
			{ID: 1, Enabled: true},
			{ID: 2, Enabled: false},
			{ID: 3, Enabled: true},
		}},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_alerts_active")
	in, _ := tool.Validate(json.RawMessage(`{}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	m := out.(map[string]any)
	if m["count"].(int) != 2 {
		t.Errorf("active count = %v, want 2", m["count"])
	}
}

func TestQueryEfficiencyPeriod_RejectsBadPeriod(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	tool, _ := r.Get("query_efficiency_period")
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":1,"period":"decade"}`)); err == nil {
		t.Error("expected oneof rejection")
	}
}

func TestQueryEfficiencyPeriod_ComputesWhPerKm(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	used1 := 12000.0
	used2 := 24000.0
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency: &fakeDrives{rows: []*drivemodel.Drive{
			{ID: 1, DistanceM: 50_000, EnergyUsedWh: &used1},  // 50 km
			{ID: 2, DistanceM: 100_000, EnergyUsedWh: &used2}, // 100 km
		}},
	})
	tool, _ := r.Get("query_efficiency_period")
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id":1,"period":"week"}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	m := out.(map[string]any)
	if m["drive_count"].(int) != 2 {
		t.Errorf("drive_count = %v", m["drive_count"])
	}
	// (12000+24000)/(150 km) = 240 Wh/km
	if got := m["wh_per_km"].(float64); got < 239.9 || got > 240.1 {
		t.Errorf("wh_per_km = %v, want ~240", got)
	}
}

func TestPeriodCutoff(t *testing.T) {
	t.Parallel()
	now := time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		period string
		want   time.Time
	}{
		{"day", now.Add(-24 * time.Hour)},
		{"week", now.Add(-7 * 24 * time.Hour)},
		{"month", now.AddDate(0, -1, 0)},
		{"year", now.AddDate(-1, 0, 0)},
		{"unknown", time.Time{}},
	}

	for _, c := range cases {
		got := periodCutoff(c.period, now)
		if !got.Equal(c.want) {
			t.Errorf("periodCutoff(%q) = %v, want %v", c.period, got, c.want)
		}
	}
}

func timePointer(value time.Time) *time.Time { return &value }
