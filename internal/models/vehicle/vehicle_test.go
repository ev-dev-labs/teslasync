package vehicle

import (
	"testing"
	"time"
)

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
