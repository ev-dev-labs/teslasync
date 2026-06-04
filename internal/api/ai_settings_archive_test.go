package api

import (
	"testing"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// --- applyAIArchiveOnModeFlip tests -----------------------------------
//
// applyAIArchiveOnModeFlip is a package-api test helper defined in
// ai_settings_archive_helper_test.go; its tests stay in package api
// (they do not belong to the carved aisettingsvalidate subpackage).

func TestApplyAIArchiveOnModeFlip_LocalToOff_Archives(t *testing.T) {
	existing := &systemmodel.Settings{
		AIMode: "local",
		AIFeatures: map[string]bool{
			"chatbot-llm":        true,
			"ai-provider-health": false, // explicitly false → not archived
		},
	}
	incoming := &systemmodel.Settings{
		AIMode: "off",
		// Buggy SPA leaves the prior map in the body — handler clears it.
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}

	applyAIArchiveOnModeFlip(existing, incoming)

	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty (off means off) got %v", incoming.AIFeatures)
	}
	if len(incoming.AIFeaturesArchived) != 1 || !incoming.AIFeaturesArchived["chatbot-llm"] {
		t.Errorf("AIFeaturesArchived: want only true entries archived, got %v", incoming.AIFeaturesArchived)
	}
	if _, present := incoming.AIFeaturesArchived["ai-provider-health"]; present {
		t.Errorf("AIFeaturesArchived: explicitly-false entry must not be archived, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_OffToOff_NoOp(t *testing.T) {
	existing := &systemmodel.Settings{
		AIMode:     "off",
		AIFeatures: map[string]bool{}, // already off
	}
	incoming := &systemmodel.Settings{
		AIMode:             "off",
		AIFeatures:         map[string]bool{},
		AIFeaturesArchived: map[string]bool{"sentinel": true},
	}

	applyAIArchiveOnModeFlip(existing, incoming)

	// AIFeatures cleared (defensively normalised) — but the
	// archive must NOT be replaced when the prior mode was already
	// off (no fresh archive event).
	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty got %v", incoming.AIFeatures)
	}
	if !incoming.AIFeaturesArchived["sentinel"] {
		t.Errorf("AIFeaturesArchived: pre-existing archive must be preserved across off→off, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_LocalToLocal_NoOp(t *testing.T) {
	// Mode-on transitions are not archive events.
	existing := &systemmodel.Settings{AIMode: "local", AIFeatures: map[string]bool{"chatbot-llm": true}}
	incoming := &systemmodel.Settings{
		AIMode:     "local",
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}

	applyAIArchiveOnModeFlip(existing, incoming)

	if len(incoming.AIFeatures) != 1 || !incoming.AIFeatures["chatbot-llm"] {
		t.Errorf("AIFeatures: must be untouched for non-off transitions, got %v", incoming.AIFeatures)
	}
	if incoming.AIFeaturesArchived != nil {
		t.Errorf("AIFeaturesArchived: must not be written for non-off transitions, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_LocalToOff_EmptyPrior_NoArchive(t *testing.T) {
	// Mode was on but the user never enabled any feature — there
	// is nothing meaningful to archive, so AIFeaturesArchived
	// stays nil (the persisted column will round-trip as the
	// existing archive value, which is the right behaviour).
	existing := &systemmodel.Settings{AIMode: "local", AIFeatures: map[string]bool{}}
	incoming := &systemmodel.Settings{AIMode: "off", AIFeatures: map[string]bool{}}

	applyAIArchiveOnModeFlip(existing, incoming)

	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty got %v", incoming.AIFeatures)
	}
	if incoming.AIFeaturesArchived != nil {
		t.Errorf("AIFeaturesArchived: want nil (no fresh archive material), got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_DefensiveClone(t *testing.T) {
	// The archive must be a copy, not an alias — mutating the
	// existing settings after the helper returns must not affect
	// the snapshot we just wrote.
	existing := &systemmodel.Settings{
		AIMode:     "cloud",
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}
	incoming := &systemmodel.Settings{AIMode: "off"}

	applyAIArchiveOnModeFlip(existing, incoming)

	// Mutate the source after the call.
	existing.AIFeatures["chatbot-llm"] = false
	existing.AIFeatures["ai-provider-health"] = true

	if !incoming.AIFeaturesArchived["chatbot-llm"] {
		t.Errorf("AIFeaturesArchived: defensive clone broken — mutation propagated, got %v", incoming.AIFeaturesArchived)
	}
	if _, present := incoming.AIFeaturesArchived["ai-provider-health"]; present {
		t.Errorf("AIFeaturesArchived: aliased map — adversarial post-mutation surfaced, got %v", incoming.AIFeaturesArchived)
	}
}

func TestApplyAIArchiveOnModeFlip_NilIncoming_NoOp(t *testing.T) {
	// Permissive on nil — the helper must not panic when a caller
	// passes a half-constructed pointer.
	applyAIArchiveOnModeFlip(&systemmodel.Settings{AIMode: "local"}, nil)
}

func TestApplyAIArchiveOnModeFlip_NilExisting_ClearsAndReturns(t *testing.T) {
	incoming := &systemmodel.Settings{
		AIMode:     "off",
		AIFeatures: map[string]bool{"chatbot-llm": true},
	}
	applyAIArchiveOnModeFlip(nil, incoming)

	if len(incoming.AIFeatures) != 0 {
		t.Errorf("AIFeatures: want empty got %v", incoming.AIFeatures)
	}
	if incoming.AIFeaturesArchived != nil {
		t.Errorf("AIFeaturesArchived: must not be written without a prior, got %v", incoming.AIFeaturesArchived)
	}
}
