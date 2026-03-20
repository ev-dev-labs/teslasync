package models

import (
	"encoding/json"
	"testing"
	"time"
)

func TestTokenJSONOmitsSecrets(t *testing.T) {
	token := Token{
		ID:           1,
		AccessToken:  "secret-access-token",
		RefreshToken: "secret-refresh-token",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	data, err := json.Marshal(token)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if _, ok := m["access_token"]; ok {
		t.Error("access_token should be hidden from JSON (json:\"-\")")
	}
	if _, ok := m["refresh_token"]; ok {
		t.Error("refresh_token should be hidden from JSON (json:\"-\")")
	}
	if _, ok := m["id"]; !ok {
		t.Error("id should be present in JSON")
	}
	if _, ok := m["expires_at"]; !ok {
		t.Error("expires_at should be present in JSON")
	}
}

func TestVehicleJSONTags(t *testing.T) {
	v := Vehicle{
		ID:          1,
		VehicleID:   12345,
		VIN:         "5YJ3E1EA1LF000001",
		DisplayName: "My Tesla",
		Model:       "Model 3",
		State:       "online",
		Healthy:     true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	expectedKeys := []string{"id", "vehicle_id", "vin", "display_name", "model", "state", "healthy", "created_at", "updated_at"}
	for _, key := range expectedKeys {
		if _, ok := m[key]; !ok {
			t.Errorf("expected JSON key %q not found", key)
		}
	}
}

func TestVehicleStateValues(t *testing.T) {
	states := []string{"online", "asleep", "offline"}
	for _, state := range states {
		v := Vehicle{State: state}
		if v.State != state {
			t.Errorf("Vehicle.State = %q, want %q", v.State, state)
		}
	}
}

func TestAlertSeverityLevels(t *testing.T) {
	levels := []string{"info", "warning", "critical"}
	for _, level := range levels {
		a := Alert{Severity: level}
		if a.Severity != level {
			t.Errorf("Alert.Severity = %q, want %q", a.Severity, level)
		}
	}
}

func TestAlertTypes(t *testing.T) {
	types := []string{
		"geofence", "battery_low", "battery_full", "sentry",
		"speed", "maintenance", "software", "custom",
	}
	for _, tp := range types {
		a := Alert{Type: tp}
		if a.Type != tp {
			t.Errorf("Alert.Type = %q, want %q", a.Type, tp)
		}
	}
}

func TestChargingSessionNilPointers(t *testing.T) {
	cs := ChargingSession{
		ID:                1,
		VehicleID:         10,
		StartDate:         time.Now(),
		StartBatteryLevel: 50,
	}

	// All pointer fields should be nil
	if cs.EndDate != nil {
		t.Error("EndDate should be nil")
	}
	if cs.AddressID != nil {
		t.Error("AddressID should be nil")
	}
	if cs.EndBatteryLevel != nil {
		t.Error("EndBatteryLevel should be nil")
	}
	if cs.ChargerPhases != nil {
		t.Error("ChargerPhases should be nil")
	}
	if cs.ChargerVoltage != nil {
		t.Error("ChargerVoltage should be nil")
	}
	if cs.ChargerPower != nil {
		t.Error("ChargerPower should be nil")
	}
	if cs.FastChargerType != nil {
		t.Error("FastChargerType should be nil")
	}
	if cs.Cost != nil {
		t.Error("Cost should be nil")
	}
	if cs.ChargeEnergyUsed != nil {
		t.Error("ChargeEnergyUsed should be nil")
	}

	// JSON should omit nil optional fields
	data, err := json.Marshal(cs)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}
	var m map[string]interface{}
	json.Unmarshal(data, &m)

	if _, ok := m["end_date"]; ok {
		t.Error("end_date should be omitted when nil")
	}
	if _, ok := m["charger_phases"]; ok {
		t.Error("charger_phases should be omitted when nil")
	}
	if _, ok := m["cost"]; ok {
		t.Error("cost should be omitted when nil")
	}
}

func TestChargingSessionWithValues(t *testing.T) {
	endBat := 90
	power := 11.5
	cost := 5.50
	cs := ChargingSession{
		ID:               1,
		VehicleID:        10,
		EndBatteryLevel:  &endBat,
		ChargerPower:     &power,
		Cost:             &cost,
		ChargeEnergyAdded: 25.5,
	}

	if *cs.EndBatteryLevel != 90 {
		t.Errorf("EndBatteryLevel = %d, want 90", *cs.EndBatteryLevel)
	}
	if *cs.ChargerPower != 11.5 {
		t.Errorf("ChargerPower = %f, want 11.5", *cs.ChargerPower)
	}
	if *cs.Cost != 5.50 {
		t.Errorf("Cost = %f, want 5.50", *cs.Cost)
	}
}

func TestDriveFields(t *testing.T) {
	now := time.Now()
	end := now.Add(30 * time.Minute)
	dist := 25.5
	dur := 30.0
	maxSpeed := 120.0
	startBat := 80
	endBat := 70

	d := Drive{
		ID:              1,
		VehicleID:       10,
		StartDate:       now,
		EndDate:         &end,
		Distance:        dist,
		DurationMin:     dur,
		SpeedMax:        &maxSpeed,
		StartBatteryLvl: &startBat,
		EndBatteryLvl:   &endBat,
	}

	if d.Distance != 25.5 {
		t.Errorf("Distance = %f, want 25.5", d.Distance)
	}
	if d.DurationMin != 30.0 {
		t.Errorf("DurationMin = %f, want 30.0", d.DurationMin)
	}
	if *d.SpeedMax != 120.0 {
		t.Errorf("SpeedMax = %f, want 120.0", *d.SpeedMax)
	}
	if *d.StartBatteryLvl != 80 {
		t.Errorf("StartBatteryLvl = %d, want 80", *d.StartBatteryLvl)
	}
	if *d.EndBatteryLvl != 70 {
		t.Errorf("EndBatteryLvl = %d, want 70", *d.EndBatteryLvl)
	}
}

func TestDriveNilOptionalFields(t *testing.T) {
	d := Drive{
		ID:        1,
		VehicleID: 10,
		StartDate: time.Now(),
	}

	if d.EndDate != nil {
		t.Error("EndDate should be nil")
	}
	if d.StartPositionID != nil {
		t.Error("StartPositionID should be nil")
	}
	if d.EndPositionID != nil {
		t.Error("EndPositionID should be nil")
	}
	if d.SpeedMax != nil {
		t.Error("SpeedMax should be nil")
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}
	var m map[string]interface{}
	json.Unmarshal(data, &m)

	if _, ok := m["end_date"]; ok {
		t.Error("end_date should be omitted when nil")
	}
	if _, ok := m["speed_max"]; ok {
		t.Error("speed_max should be omitted when nil")
	}
}

func TestPositionOptionalFields(t *testing.T) {
	p := Position{
		ID:        1,
		VehicleID: 10,
		Latitude:  37.7749,
		Longitude: -122.4194,
		Odometer:  50000.5,
		BatteryLvl: 75,
	}

	if p.Speed != nil {
		t.Error("Speed should be nil when not set")
	}
	if p.Heading != nil {
		t.Error("Heading should be nil when not set")
	}
	if p.InsideTemp != nil {
		t.Error("InsideTemp should be nil when not set")
	}

	speed := 65.0
	p.Speed = &speed
	if *p.Speed != 65.0 {
		t.Errorf("Speed = %f, want 65.0", *p.Speed)
	}
}

func TestVehicleStateStruct(t *testing.T) {
	// models.VehicleState (not tesla.VehicleState)
	vs := VehicleState{
		VehicleID:    1,
		State:        "online",
		Latitude:     37.7749,
		Longitude:    -122.4194,
		BatteryLevel: 80,
		IsCharging:   true,
		IsLocked:     true,
		SentryMode:   false,
	}

	data, err := json.Marshal(vs)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var m map[string]interface{}
	json.Unmarshal(data, &m)

	if m["state"] != "online" {
		t.Errorf("state = %v, want %q", m["state"], "online")
	}
	if m["is_charging"] != true {
		t.Errorf("is_charging = %v, want true", m["is_charging"])
	}
	if m["is_locked"] != true {
		t.Errorf("is_locked = %v, want true", m["is_locked"])
	}
}

func TestCommandLogStatus(t *testing.T) {
	statuses := []string{"success", "failed", "pending"}
	for _, s := range statuses {
		cl := CommandLog{Status: s}
		if cl.Status != s {
			t.Errorf("CommandLog.Status = %q, want %q", cl.Status, s)
		}
	}
}

func TestSettingsStruct(t *testing.T) {
	s := Settings{
		ID:             1,
		UnitOfLength:   "km",
		UnitOfTemp:     "C",
		PreferredRange: "ideal",
		Language:       "en",
		BaseCostPerKWh: 0.12,
	}

	data, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var m map[string]interface{}
	json.Unmarshal(data, &m)

	if m["unit_of_length"] != "km" {
		t.Errorf("unit_of_length = %v, want %q", m["unit_of_length"], "km")
	}
	if m["unit_of_temp"] != "C" {
		t.Errorf("unit_of_temp = %v, want %q", m["unit_of_temp"], "C")
	}
}

func TestGeofenceStruct(t *testing.T) {
	costPerKwh := 0.15
	g := Geofence{
		ID:         1,
		Name:       "Home",
		Latitude:   37.7749,
		Longitude:  -122.4194,
		Radius:     100.0,
		CostPerKwh: &costPerKwh,
	}

	if g.Radius != 100.0 {
		t.Errorf("Radius = %f, want 100.0", g.Radius)
	}
	if *g.CostPerKwh != 0.15 {
		t.Errorf("CostPerKwh = %f, want 0.15", *g.CostPerKwh)
	}
}

func TestNotificationChannelTypes(t *testing.T) {
	types := []string{"discord", "email", "slack", "telegram", "webhook", "ntfy", "pushover"}
	for _, tp := range types {
		nc := NotificationChannel{Type: tp}
		if nc.Type != tp {
			t.Errorf("NotificationChannel.Type = %q, want %q", nc.Type, tp)
		}
	}
}

func TestVampireDrainEvent(t *testing.T) {
	vd := VampireDrainEvent{
		ID:                1,
		VehicleID:         10,
		StartDate:         time.Now(),
		StartBattery:      80,
		BatteryLost:       5,
		RangeLostKm:       20.5,
		DurationHours:     8.0,
		DrainRatePctPerHr: 0.625,
		SentryMode:        true,
	}

	if vd.DrainRatePctPerHr != 0.625 {
		t.Errorf("DrainRatePctPerHr = %f, want 0.625", vd.DrainRatePctPerHr)
	}
	if !vd.SentryMode {
		t.Error("SentryMode should be true")
	}
}
