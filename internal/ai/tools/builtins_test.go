package tools

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fake repos --------------------------------------------------------------

type fakeVehicles struct {
	all []*models.Vehicle
	one map[int64]*models.Vehicle
	err error
}

func (f *fakeVehicles) GetAll(ctx context.Context) ([]*models.Vehicle, error) {
	return f.all, f.err
}
func (f *fakeVehicles) GetByID(ctx context.Context, id int64) (*models.Vehicle, error) {
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
	rows []*models.Drive
	one  map[int64]*models.Drive
}

func (f *fakeDrives) GetByVehicle(ctx context.Context, vid int64, limit, off int, st, et time.Time) ([]*models.Drive, error) {
	if limit > 0 && limit < len(f.rows) {
		return f.rows[:limit], nil
	}
	return f.rows, nil
}
func (f *fakeDrives) GetByID(ctx context.Context, id int64) (*models.Drive, error) {
	return f.one[id], nil
}

type fakeCharges struct {
	rows []*models.ChargingSession
	one  map[int64]*models.ChargingSession
}

func (f *fakeCharges) GetByVehicle(ctx context.Context, vid int64, limit, off int, st, et time.Time) ([]*models.ChargingSession, error) {
	if limit > 0 && limit < len(f.rows) {
		return f.rows[:limit], nil
	}
	return f.rows, nil
}
func (f *fakeCharges) GetByID(ctx context.Context, id int64) (*models.ChargingSession, error) {
	return f.one[id], nil
}

type fakeRules struct {
	rules []*models.AlertRule
}

func (f *fakeRules) GetAll(ctx context.Context) ([]*models.AlertRule, error) { return f.rules, nil }

type fakeNotif struct {
	logs []*models.NotificationLog
}

func (f *fakeNotif) GetLogs(ctx context.Context, limit, off int) ([]*models.NotificationLog, error) {
	return f.logs, nil
}

type fakeFences struct {
	fences []*models.Geofence
}

func (f *fakeFences) GetAll(ctx context.Context) ([]*models.Geofence, error) { return f.fences, nil }

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
	src := &fakeVehicles{all: []*models.Vehicle{{ID: 1}, {ID: 2}, {ID: 3}}}
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
	v := &models.Vehicle{ID: 7, DisplayName: "Modelina", VIN: "5YJSA1E10HF000007", Timezone: "UTC"}
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{one: map[int64]*models.Vehicle{7: v}},
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
		Drives:        &fakeDrives{rows: []*models.Drive{{ID: 1}, {ID: 2}, {ID: 3}}},
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
		Drives:        &fakeDrives{one: map[int64]*models.Drive{}},
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
		AlertRules: &fakeRules{rules: []*models.AlertRule{
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
		Efficiency: &fakeDrives{rows: []*models.Drive{
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
