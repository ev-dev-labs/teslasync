package models

import (
	"testing"
	"time"
)

func TestToken_NotExpired(t *testing.T) {
	tok := Token{
		AccessToken:  "test-token",
		RefreshToken: "test-refresh",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
	}
	if tok.AccessToken == "" {
		t.Error("expected non-empty access token")
	}
	if tok.ExpiresAt.Before(time.Now()) {
		t.Error("expected token to not be expired")
	}
}

func TestToken_Expired(t *testing.T) {
	tok := Token{
		AccessToken:  "expired-token",
		RefreshToken: "expired-refresh",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
	}
	if !tok.ExpiresAt.Before(time.Now()) {
		t.Error("expected token to be expired")
	}
}

func TestVehicle_Fields(t *testing.T) {
	v := Vehicle{
		VIN:         "5YJ3E1EA1PF000001",
		DisplayName: "Test Car",
		Model:       "Model 3",
		State:       "online",
	}
	if v.VIN == "" {
		t.Error("expected non-empty VIN")
	}
	if v.State != "online" {
		t.Errorf("expected state 'online', got '%s'", v.State)
	}
	if v.DisplayName != "Test Car" {
		t.Errorf("expected display name 'Test Car', got '%s'", v.DisplayName)
	}
}

func TestVehicle_States(t *testing.T) {
	states := []string{"online", "asleep", "offline"}
	for _, state := range states {
		v := Vehicle{State: state}
		if v.State != state {
			t.Errorf("expected state '%s', got '%s'", state, v.State)
		}
	}
}

func TestChargingSession_Fields(t *testing.T) {
	cs := ChargingSession{
		VehicleID:         1,
		StartDate:         time.Now(),
		ChargeEnergyAdded: 45.5,
		StartBatteryLevel: 20,
		DurationMin:       60.0,
	}
	if cs.ChargeEnergyAdded != 45.5 {
		t.Errorf("expected charge energy 45.5, got %f", cs.ChargeEnergyAdded)
	}
	if cs.StartBatteryLevel != 20 {
		t.Errorf("expected start battery 20, got %d", cs.StartBatteryLevel)
	}
}

func TestDrive_Fields(t *testing.T) {
	d := Drive{
		VehicleID:   1,
		StartDate:   time.Now(),
		Distance:    25.5,
		DurationMin: 30.0,
	}
	if d.Distance != 25.5 {
		t.Errorf("expected distance 25.5, got %f", d.Distance)
	}
	if d.DurationMin != 30.0 {
		t.Errorf("expected duration 30.0, got %f", d.DurationMin)
	}
}
