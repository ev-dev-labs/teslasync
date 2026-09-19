package alert

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/alertpacks"
)

func TestPackProposalReadOnlyAndValidated(t *testing.T) {
	tool := &proposeAlertPack{}
	if tool.Mutates() || tool.RequiredScope() != "" {
		t.Fatal("proposal must be read-only")
	}

	t.Run("comprehensive proposal is not capped at six", func(t *testing.T) {
		catalog := alertpacks.CustomCatalog()
		ids := make([]string, 0, len(catalog.Rules))
		for _, rule := range catalog.Rules {
			ids = append(ids, rule.ID)
		}
		raw, err := json.Marshal(packProposalInput{Name: "Complete coverage", TemplateIDs: ids, Rationale: "All supported catalog rules, ready for review."})
		if err != nil {
			t.Fatal(err)
		}
		tool := &proposeAlertPack{}
		input, err := tool.Validate(raw)
		if err != nil {
			t.Fatal(err)
		}
		result, err := tool.Execute(context.Background(), input)
		if err != nil {
			t.Fatal(err)
		}
		if got := len(result.(packProposal).TemplateIDs); got != len(ids) || got <= 6 {
			t.Fatalf("incomplete proposal: %d", got)
		}
	})
	registry := tools.NewRegistry()
	RegisterAlertPackTools(registry)
	for _, tt := range []struct {
		name, raw string
		valid     bool
	}{
		{"valid", `{"name":"Long Weekend","template_ids":["battery-low","charge-complete"],"rationale":"Battery and charging reminders."}`, true},
		{"invented", `{"name":"Bad","template_ids":["battery-low","open-frunk"],"rationale":"Invented action."}`, false},
		{"duplicate", `{"name":"Bad","template_ids":["battery-low","battery-low"],"rationale":"Duplicates."}`, false},
		{"too few", `{"name":"Bad","template_ids":["battery-low"],"rationale":"Only one."}`, false},
		{"empty name", `{"name":" ","template_ids":["battery-low","charge-complete"],"rationale":"Blank."}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			input, err := tool.Validate(json.RawMessage(tt.raw))
			var result any
			if err == nil {
				result, err = tool.Execute(context.Background(), input)
			}
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%v err=%v", tt.valid, err)
			}
			if tt.valid {
				out := result.(packProposal)
				if out.Status != "ok" || len(out.TemplateIDs) != 2 || out.Name != "Long Weekend" {
					t.Fatalf("bad proposal %+v", out)
				}
			}
		})
	}
	if _, err := tool.Execute(context.Background(), "bad"); err == nil {
		t.Fatal("wrong type accepted")
	}
}
