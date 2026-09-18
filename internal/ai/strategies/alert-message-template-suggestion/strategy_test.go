package alertmsgtemplatesuggestion

import (
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/eval"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

func TestGoldenPromptMatchesProduction(t *testing.T) {
	t.Parallel()
	set, err := eval.LoadGoldenSet("goldens.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(set.Feature.System) != strings.TrimSpace(SystemPrompt) {
		t.Fatal("goldens.yaml must evaluate the production prompt, not an older writing brief")
	}
}

func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != FeatureID {
		t.Fatalf("FeatureID() = %q, want %q", got, FeatureID)
	}
	if FeatureID != "alert-message-template-suggestion" {
		t.Fatalf("FeatureID const = %q", FeatureID)
	}
}

func TestStrategy_System(t *testing.T) {
	t.Parallel()
	sys := New().System()
	if sys == "" {
		t.Fatal("empty system prompt")
	}
	for _, must := range []string{
		"Alert Studio message-template advisor",
		"PROPOSE ONE notification message template",
		"ALWAYS call draft_alert_message_template FIRST",
		"MUST call validate_alert_message_template",
		"if validate_alert_message_template returns status other than ok you MUST REFUSE",
		"surface the validator's errors[] verbatim",
		"Do NOT invent {{tokens}}",
		"The template MUST be related to the selected dimensions",
		"You NEVER save the template",
		"writing_brief",
		"Do NOT copy bland catalog presets",
		"Tesla owner would be glad they received",
		`{{SignalName}} is {{Value}} (threshold {{Threshold}})`,
		"the creative idea IS the product",
		"three genuinely different creative angles",
		"A gear state is NOT proof of movement",
		"Critical alerts prioritise clarity",
		"NOT a checklist of tokens",
	} {
		if !strings.Contains(sys, must) {
			t.Errorf("System() missing %q", must)
		}
	}
}

func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	got := New().Tools()
	if len(got) != 2 {
		t.Fatalf("Tools() len=%d", len(got))
	}
	if got[0] != "draft_alert_message_template" || got[1] != "validate_alert_message_template" {
		t.Fatalf("Tools() = %v", got)
	}
	got[0] = "mutated"
	if New().Tools()[0] != "draft_alert_message_template" {
		t.Fatal("Tools() must return a copy")
	}
}

func TestStrategy_SatisfiesPort(t *testing.T) {
	t.Parallel()
	var _ strategy.Strategy = New()
}
