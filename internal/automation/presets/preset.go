// Package presets provides built-in automation templates that users can
// one-click install. Presets are static (not DB-stored) and returned from
// memory. Each preset carries enough metadata for the frontend gallery
// plus the full automation definition needed to create a real automation.
package presets

import "encoding/json"

// Preset is a built-in automation template. It embeds the full automation
// definition (trigger, conditions, actions, safety fields) plus gallery
// metadata (id, category, icon, description).
type Preset struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	Category          string          `json:"category"`
	Icon              string          `json:"icon"`
	TriggerType       string          `json:"trigger_type"`
	TriggerConfig     json.RawMessage `json:"trigger_config"`
	Conditions        json.RawMessage `json:"conditions,omitempty"`
	Actions           json.RawMessage `json:"actions"`
	CooldownMinutes   int             `json:"cooldown_minutes"`
	MaxExecutionsHour int             `json:"max_executions_hour"`
	StopOnFailure     bool            `json:"stop_on_failure"`
	NotifyOnRun       bool            `json:"notify_on_run"`
	NotifyOnFailure   bool            `json:"notify_on_failure"`
	Priority          int             `json:"priority"`
	Tags              []string        `json:"tags"`
}

// Category groups related presets for the frontend gallery.
type Category struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

// Registry holds all preset categories and their presets.
type Registry struct {
	categories map[string]Category
	presets    []Preset
}

// NewRegistry creates a registry pre-loaded with all built-in presets.
func NewRegistry() *Registry {
	r := &Registry{
		categories: make(map[string]Category),
	}
	r.registerCategory(securityCategory)
	r.presets = append(r.presets, securityPresets...)
	r.registerCategory(climateCategory)
	r.presets = append(r.presets, climatePresets...)
	r.registerCategory(chargingCategory)
	r.presets = append(r.presets, chargingPresets...)
	return r
}

// Categories returns all registered categories.
func (r *Registry) Categories() []Category {
	cats := make([]Category, 0, len(r.categories))
	for _, c := range r.categories {
		cats = append(cats, c)
	}
	return cats
}

// Presets returns all presets, optionally filtered by category.
func (r *Registry) Presets(category string) []Preset {
	if category == "" {
		return r.presets
	}
	var filtered []Preset
	for _, p := range r.presets {
		if p.Category == category {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

// Get returns a single preset by ID, or nil if not found.
func (r *Registry) Get(id string) *Preset {
	for i := range r.presets {
		if r.presets[i].ID == id {
			return &r.presets[i]
		}
	}
	return nil
}

func (r *Registry) registerCategory(c Category) {
	r.categories[c.ID] = c
}
