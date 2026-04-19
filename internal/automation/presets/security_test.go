package presets_test

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
)

func TestSecurityPresetsValid(t *testing.T) {
	registry := presets.NewRegistry()
	all := registry.Presets("security")

	if len(all) != 7 {
		t.Fatalf("expected 7 security presets, got %d", len(all))
	}

	for _, p := range all {
		t.Run(p.ID, func(t *testing.T) {
			// Validate required fields.
			if p.ID == "" {
				t.Error("preset ID is empty")
			}
			if p.Name == "" {
				t.Error("preset Name is empty")
			}
			if p.Category != "security" {
				t.Errorf("expected category 'security', got %q", p.Category)
			}
			if p.TriggerType == "" {
				t.Error("preset TriggerType is empty")
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

			// Validate tags are present.
			if len(p.Tags) == 0 {
				t.Error("preset has no tags")
			}
		})
	}
}

func TestRegistryGetByID(t *testing.T) {
	registry := presets.NewRegistry()

	p := registry.Get("security-night-lockdown")
	if p == nil {
		t.Fatal("expected to find preset 'security-night-lockdown'")
	}
	if p.Name != "Night Lockdown" {
		t.Errorf("expected name 'Night Lockdown', got %q", p.Name)
	}
}

func TestRegistryGetNotFound(t *testing.T) {
	registry := presets.NewRegistry()

	p := registry.Get("nonexistent")
	if p != nil {
		t.Errorf("expected nil for nonexistent preset, got %+v", p)
	}
}

func TestRegistryPresetsFilterByCategory(t *testing.T) {
	registry := presets.NewRegistry()

	all := registry.Presets("")
	security := registry.Presets("security")
	none := registry.Presets("nonexistent")

	if len(all) == 0 {
		t.Error("expected at least one preset")
	}
	if len(security) != 7 {
		t.Errorf("expected 7 security presets, got %d", len(security))
	}
	if len(none) != 0 {
		t.Errorf("expected 0 presets for nonexistent category, got %d", len(none))
	}
}

func TestRegistryCategories(t *testing.T) {
	registry := presets.NewRegistry()

	cats := registry.Categories()
	if len(cats) == 0 {
		t.Fatal("expected at least one category")
	}

	found := false
	for _, c := range cats {
		if c.ID == "security" {
			found = true
			if c.Name != "Security" {
				t.Errorf("expected category name 'Security', got %q", c.Name)
			}
		}
	}
	if !found {
		t.Error("security category not found")
	}
}

func TestSecurityPresetIDsUnique(t *testing.T) {
	registry := presets.NewRegistry()
	seen := make(map[string]bool)

	for _, p := range registry.Presets("") {
		if seen[p.ID] {
			t.Errorf("duplicate preset ID: %s", p.ID)
		}
		seen[p.ID] = true
	}
}
