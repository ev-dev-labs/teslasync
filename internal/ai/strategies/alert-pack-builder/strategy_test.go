package alertpackbuilder

import (
	"context"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

func TestStrategyGroundedReadOnly(t *testing.T) {
	s := New()
	if s.FeatureID() != FeatureID || len(s.Tools()) != 1 || s.Tools()[0] != "propose_alert_pack" {
		t.Fatal("invalid strategy wiring")
	}
	for _, required := range []string{"NEVER install", "Never invent template IDs", "telemetry may be delayed", "explicitly install", "not occupant safety"} {
		if !strings.Contains(s.System(), required) {
			t.Fatalf("missing constraint %s", required)
		}
	}
	messages, err := s.Context(context.Background(), strategy.StrategyInput{})
	if err != nil || len(messages) != 1 || !strings.Contains(messages[0].Content, `"battery-low"`) {
		t.Fatalf("missing catalog: %v", err)
	}
	if s.RedactionPolicy() == nil {
		t.Fatal("missing redaction policy")
	}
}
