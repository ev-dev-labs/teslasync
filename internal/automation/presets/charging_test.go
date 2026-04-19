package presets_test

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
)

func TestChargingPresetsValid(t *testing.T) {
	registry := presets.NewRegistry()
	all := registry.Presets("charging")

	if len(all) != 8 {
		t.Fatalf("expected 8 charging presets, got %d", len(all))
	}

	for _, p := range all {
		t.Run(p.ID, func(t *testing.T) {
			if p.ID == "" {
				t.Error("preset ID is empty")
			}
			if p.Name == "" {
				t.Error("preset Name is empty")
			}
			if p.Category != "charging" {
				t.Errorf("expected category 'charging', got %q", p.Category)
			}
			if p.TriggerType == "" {
				t.Error("preset TriggerType is empty")
			}
			if p.Icon == "" {
				t.Error("preset Icon is empty")
			}
			if p.Description == "" {
				t.Error("preset Description is empty")
			}

			// Validate trigger config against the real validator.
			if err := trigger.ValidateTriggerConfig(p.TriggerType, p.TriggerConfig); err != nil {
				t.Errorf("trigger config invalid: %v", err)
			}

			// Validate actions are parseable.
			if len(p.Actions) > 0 {
				configs, err := action.ParseActions(p.Actions)
				if err != nil {
					t.Errorf("actions invalid: %v", err)
				}
				if len(configs) == 0 {
					t.Error("actions parsed to zero configs")
				}
			} else {
				t.Error("preset has no actions")
			}

			// Validate conditions are parseable JSON arrays when present.
			if len(p.Conditions) > 0 {
				var conditions []json.RawMessage
				if err := json.Unmarshal(p.Conditions, &conditions); err != nil {
					t.Errorf("conditions not a valid JSON array: %v", err)
				}
				for i, cond := range conditions {
					var obj map[string]interface{}
					if err := json.Unmarshal(cond, &obj); err != nil {
						t.Errorf("condition[%d] not valid JSON object: %v", i, err)
					}
					if _, ok := obj["type"]; !ok {
						t.Errorf("condition[%d] missing 'type' field", i)
					}
				}
			}

			// Validate tags are present.
			if len(p.Tags) == 0 {
				t.Error("preset has no tags")
			}

			// Every charging preset must be tagged "charging".
			hasChargingTag := false
			for _, tag := range p.Tags {
				if tag == "charging" {
					hasChargingTag = true
					break
				}
			}
			if !hasChargingTag {
				t.Error("preset missing 'charging' tag")
			}
		})
	}
}

func TestChargingPresetIDsUnique(t *testing.T) {
	registry := presets.NewRegistry()
	seen := make(map[string]bool)

	for _, p := range registry.Presets("charging") {
		if seen[p.ID] {
			t.Errorf("duplicate preset ID: %s", p.ID)
		}
		seen[p.ID] = true
	}
}

func TestChargingPresetIDPrefix(t *testing.T) {
	registry := presets.NewRegistry()

	for _, p := range registry.Presets("charging") {
		if len(p.ID) < 9 || p.ID[:9] != "charging-" {
			t.Errorf("charging preset ID %q should start with 'charging-'", p.ID)
		}
	}
}

func TestChargingCategory(t *testing.T) {
	registry := presets.NewRegistry()

	cats := registry.Categories()
	found := false
	for _, c := range cats {
		if c.ID == "charging" {
			found = true
			if c.Name != "Charging" {
				t.Errorf("expected category name 'Charging', got %q", c.Name)
			}
			if c.Icon != "BatteryCharging" {
				t.Errorf("expected category icon 'BatteryCharging', got %q", c.Icon)
			}
		}
	}
	if !found {
		t.Error("charging category not found")
	}
}

func TestChargingPresetGetByID(t *testing.T) {
	registry := presets.NewRegistry()

	tests := []struct {
		id   string
		name string
	}{
		{"charging-smart-stop", "Smart Charge Stop"},
		{"charging-off-peak", "Off-Peak Charging"},
		{"charging-trip-prep", "Trip Prep"},
		{"charging-daily-reset", "Daily Limit Reset"},
		{"charging-low-alert", "Low Battery Alert"},
		{"charging-complete-notify", "Charge Complete Notify"},
		{"charging-amperage-saver", "Amperage Saver"},
		{"charging-solar", "Solar Charging"},
	}

	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			p := registry.Get(tt.id)
			if p == nil {
				t.Fatalf("preset %q not found", tt.id)
			}
			if p.Name != tt.name {
				t.Errorf("expected name %q, got %q", tt.name, p.Name)
			}
		})
	}
}

func TestRegistryTotalPresetsIncludesCharging(t *testing.T) {
	registry := presets.NewRegistry()

	all := registry.Presets("")
	security := registry.Presets("security")
	climate := registry.Presets("climate")
	charging := registry.Presets("charging")
	home := registry.Presets("home")
	driving := registry.Presets("driving")
	comfort := registry.Presets("comfort")

	total := len(security) + len(climate) + len(charging) + len(home) + len(driving) + len(comfort)
	if len(all) != total {
		t.Errorf("total presets (%d) != security (%d) + climate (%d) + charging (%d) + home (%d) + driving (%d) + comfort (%d)",
			len(all), len(security), len(climate), len(charging), len(home), len(driving), len(comfort))
	}
}
