package models

import (
	"testing"
	"time"
)

// Token tests moved to internal/models/auth/auth_test.go in phase-R5.2.

func TestVehicle_Fields(t *testing.T) {
	model := "Model 3"
	v := Vehicle{
		VIN:         "5YJ3E1EA1PF000001",
		DisplayName: "Test Car",
		Model:       &model,
	}
	if v.VIN == "" {
		t.Error("expected non-empty VIN")
	}
	if v.Model == nil || *v.Model != "Model 3" {
		t.Errorf("expected model 'Model 3', got %v", v.Model)
	}
	if v.DisplayName != "Test Car" {
		t.Errorf("expected display name 'Test Car', got '%s'", v.DisplayName)
	}
	if !v.IsActive() {
		t.Errorf("expected vehicle with nil ArchivedAt to be active")
	}
}

func TestVehicle_Archived(t *testing.T) {
	now := time.Now()
	v := Vehicle{ArchivedAt: &now}
	if v.IsActive() {
		t.Error("expected archived vehicle to not be active")
	}
}

func TestChargingSession_Fields(t *testing.T) {
	energy := 45.5
	pct := 20.0
	cs := ChargingSession{
		VehicleID:          1,
		StartedAt:          time.Now(),
		TotalEnergyAddedWh: &energy,
		StartSocPct:        &pct,
	}
	if cs.TotalEnergyAddedWh == nil || *cs.TotalEnergyAddedWh != 45.5 {
		t.Errorf("expected energy added 45.5, got %v", cs.TotalEnergyAddedWh)
	}
	if cs.StartSocPct == nil || *cs.StartSocPct != 20 {
		t.Errorf("expected start battery 20, got %v", cs.StartSocPct)
	}
	if !cs.IsActive() {
		t.Errorf("expected session with nil EndedAt to be active")
	}
}

func TestDrive_Fields(t *testing.T) {
	start := time.Now()
	endTs := start.Add(30 * time.Minute)
	d := Drive{
		VehicleID: 1,
		StartTs:   start,
		EndTs:     &endTs,
		DistanceM: 41036.4,
		DurationS: 1800,
	}
	if d.DistanceM != 41036.4 {
		t.Errorf("expected distance 41036.4, got %f", d.DistanceM)
	}
	if d.DurationS != 1800 {
		t.Errorf("expected duration 1800, got %d", d.DurationS)
	}
}
