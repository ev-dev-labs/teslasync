package alertmsg

import (
	"encoding/json"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	_ "embed"
)

//go:embed presets.json
var presetsJSON []byte

var allPresets = mustLoadPresets()

func mustLoadPresets() []Preset {
	var out []Preset
	if err := json.Unmarshal(presetsJSON, &out); err != nil {
		// presets.json is checked into the repo and embedded at compile
		// time. A parse failure here means the JSON file was committed
		// in a broken state — fail loudly so CI catches it rather than
		// silently shipping an empty preset gallery.
		panic("alertmsg: invalid presets.json: " + err.Error())
	}
	return out
}

// Presets returns the curated message-template gallery for the given
// rule. The slice is filtered by Preset.Kind to match rule.Kind so the
// frontend only shows applicable presets. When rule is nil, the full
// catalog is returned (used by the placeholders endpoint smoke test).
//
// The returned slice is a fresh copy — callers may freely sort or
// extend it without mutating the package-level cache.
func Presets(rule *alertmodel.AlertRule) []Preset {
	kind := ""
	if rule != nil {
		kind = rule.Kind
	}
	out := make([]Preset, 0, len(allPresets))
	for _, p := range allPresets {
		if p.Kind != "" && kind != "" && p.Kind != kind {
			continue
		}
		out = append(out, p)
	}
	return out
}
