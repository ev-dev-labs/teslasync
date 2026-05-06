// Package presets provides built-in automation templates that users can
// one-click install. Presets are static (not DB-stored) and returned from
// memory. Each preset carries enough metadata for the frontend gallery
// plus the full automation definition needed to create a real automation.
package presets

import "encoding/json"

// Preset is a built-in automation template. It embeds the full automation
// definition plus gallery metadata. Phase 36 exposes only typed CTI step
// arrays; legacy trigger/config preset payloads are intentionally unavailable.
type Preset struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Category    string            `json:"category"`
	Icon        string            `json:"icon"`
	Triggers    []json.RawMessage `json:"triggers"`
	Conditions  []json.RawMessage `json:"conditions"`
	Actions     []json.RawMessage `json:"actions"`
	Tags        []string          `json:"tags"`
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
	for _, category := range []Category{
		{ID: "security", Name: "Security", Description: "Security and access automation templates", Icon: "shield"},
		{ID: "climate", Name: "Climate", Description: "Climate comfort automation templates", Icon: "thermometer"},
		{ID: "charging", Name: "Charging", Description: "Charging automation templates", Icon: "battery-charging"},
		{ID: "home", Name: "Home", Description: "Home arrival and departure automation templates", Icon: "home"},
		{ID: "driving", Name: "Driving", Description: "Driving behavior automation templates", Icon: "car"},
		{ID: "comfort", Name: "Comfort", Description: "Cabin comfort automation templates", Icon: "sparkles"},
		{ID: "maintenance", Name: "Maintenance", Description: "Maintenance reminder automation templates", Icon: "wrench"},
		{ID: "energy", Name: "Energy", Description: "Energy monitoring automation templates", Icon: "zap"},
	} {
		r.registerCategory(category)
	}
	r.registerBuiltins()
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

// register appends a preset to the in-memory registry. It panics on a
// duplicate ID or unknown category — both indicate a programming error
// in builtins.go that must surface at process start, not at request time.
func (r *Registry) register(p Preset) {
	if _, ok := r.categories[p.Category]; !ok {
		panic("preset " + p.ID + " references unknown category " + p.Category)
	}
	for i := range r.presets {
		if r.presets[i].ID == p.ID {
			panic("duplicate preset id " + p.ID)
		}
	}
	r.presets = append(r.presets, p)
}
