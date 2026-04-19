package presets_test

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
)

func TestDrivingPresetsValid(t *testing.T) {
	registry := presets.NewRegistry()
	all := registry.Presets("driving")

	if len(all) != 6 {
		t.Fatalf("expected 6 driving presets, got %d", len(all))
	}

	for _, p := range all {
		t.Run(p.ID, func(t *testing.T) {
			if p.ID == "" {
				t.Error("preset ID is empty")
			}
			if p.Name == "" {
				t.Error("preset Name is empty")
			}
			if p.Category != "driving" {
				t.Errorf("expected category 'driving', got %q", p.Category)
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

			// Every driving preset must be tagged "driving".
			hasDrivingTag := false
			for _, tag := range p.Tags {
				if tag == "driving" {
					hasDrivingTag = true
					break
				}
			}
			if !hasDrivingTag {
				t.Error("preset missing 'driving' tag")
			}
		})
	}
}

func TestDrivingPresetIDsUnique(t *testing.T) {
	registry := presets.NewRegistry()
	seen := make(map[string]bool)

	for _, p := range registry.Presets("driving") {
		if seen[p.ID] {
			t.Errorf("duplicate preset ID: %s", p.ID)
		}
		seen[p.ID] = true
	}
}

func TestDrivingPresetIDPrefix(t *testing.T) {
	registry := presets.NewRegistry()

	for _, p := range registry.Presets("driving") {
		if len(p.ID) < 8 || p.ID[:8] != "driving-" {
			t.Errorf("driving preset ID %q should start with 'driving-'", p.ID)
		}
	}
}

func TestDrivingCategory(t *testing.T) {
	registry := presets.NewRegistry()

	cats := registry.Categories()
	found := false
	for _, c := range cats {
		if c.ID == "driving" {
			found = true
			if c.Name != "Driving" {
				t.Errorf("expected category name 'Driving', got %q", c.Name)
			}
			if c.Icon != "Car" {
				t.Errorf("expected category icon 'Car', got %q", c.Icon)
			}
		}
	}
	if !found {
		t.Error("driving category not found")
	}
}

func TestDrivingPresetGetByID(t *testing.T) {
	registry := presets.NewRegistry()

	tests := []struct {
		id   string
		name string
	}{
		{"driving-start-log", "Drive Start Log"},
		{"driving-speed-alert", "Speed Alert"},
		{"driving-break-reminder", "Long Drive Break Reminder"},
		{"driving-efficiency-coach", "Efficiency Coach"},
		{"driving-remote-start-timer", "Remote Start Timer"},
		{"driving-navigate-to-work", "Navigate to Work"},
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

func TestRegistryTotalPresetsIncludesDriving(t *testing.T) {
	registry := presets.NewRegistry()

	all := registry.Presets("")
	security := registry.Presets("security")
	climate := registry.Presets("climate")
	charging := registry.Presets("charging")
	home := registry.Presets("home")
	driving := registry.Presets("driving")
	comfort := registry.Presets("comfort")
	maintenance := registry.Presets("maintenance")
	energy := registry.Presets("energy")

	total := len(security) + len(climate) + len(charging) + len(home) + len(driving) + len(comfort) + len(maintenance) + len(energy)
	if len(all) != total {
		t.Errorf("total presets (%d) != security (%d) + climate (%d) + charging (%d) + home (%d) + driving (%d) + comfort (%d) + maintenance (%d) + energy (%d)",
			len(all), len(security), len(climate), len(charging), len(home), len(driving), len(comfort), len(maintenance), len(energy))
	}
}
