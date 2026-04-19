package presets_test

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
)

func TestHomePresetsValid(t *testing.T) {
	registry := presets.NewRegistry()
	all := registry.Presets("home")

	if len(all) != 5 {
		t.Fatalf("expected 5 home presets, got %d", len(all))
	}

	for _, p := range all {
		t.Run(p.ID, func(t *testing.T) {
			if p.ID == "" {
				t.Error("preset ID is empty")
			}
			if p.Name == "" {
				t.Error("preset Name is empty")
			}
			if p.Category != "home" {
				t.Errorf("expected category 'home', got %q", p.Category)
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

			// Every home preset must be tagged "home".
			hasHomeTag := false
			for _, tag := range p.Tags {
				if tag == "home" {
					hasHomeTag = true
					break
				}
			}
			if !hasHomeTag {
				t.Error("preset missing 'home' tag")
			}
		})
	}
}

func TestHomePresetIDsUnique(t *testing.T) {
	registry := presets.NewRegistry()
	seen := make(map[string]bool)

	for _, p := range registry.Presets("home") {
		if seen[p.ID] {
			t.Errorf("duplicate preset ID: %s", p.ID)
		}
		seen[p.ID] = true
	}
}

func TestHomePresetIDPrefix(t *testing.T) {
	registry := presets.NewRegistry()

	for _, p := range registry.Presets("home") {
		if len(p.ID) < 5 || p.ID[:5] != "home-" {
			t.Errorf("home preset ID %q should start with 'home-'", p.ID)
		}
	}
}

func TestHomeCategory(t *testing.T) {
	registry := presets.NewRegistry()

	cats := registry.Categories()
	found := false
	for _, c := range cats {
		if c.ID == "home" {
			found = true
			if c.Name != "Home & Garage" {
				t.Errorf("expected category name 'Home & Garage', got %q", c.Name)
			}
			if c.Icon != "Home" {
				t.Errorf("expected category icon 'Home', got %q", c.Icon)
			}
		}
	}
	if !found {
		t.Error("home category not found")
	}
}

func TestHomePresetGetByID(t *testing.T) {
	registry := presets.NewRegistry()

	tests := []struct {
		id   string
		name string
	}{
		{"home-arrive", "Arrive Home"},
		{"home-leave", "Leave Home"},
		{"home-garage-auto-close", "Garage Auto-Close"},
		{"home-porch-light", "Porch Light"},
		{"home-departure-routine", "Departure Routine"},
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

func TestRegistryTotalPresetsIncludesHome(t *testing.T) {
	registry := presets.NewRegistry()

	all := registry.Presets("")
	security := registry.Presets("security")
	climate := registry.Presets("climate")
	charging := registry.Presets("charging")
	home := registry.Presets("home")
	driving := registry.Presets("driving")
	comfort := registry.Presets("comfort")
	maintenance := registry.Presets("maintenance")

	total := len(security) + len(climate) + len(charging) + len(home) + len(driving) + len(comfort) + len(maintenance)
	if len(all) != total {
		t.Errorf("total presets (%d) != security (%d) + climate (%d) + charging (%d) + home (%d) + driving (%d) + comfort (%d) + maintenance (%d)",
			len(all), len(security), len(climate), len(charging), len(home), len(driving), len(comfort), len(maintenance))
	}
}
