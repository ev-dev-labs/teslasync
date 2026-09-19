package azure

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func TestResponsesContinuationHonorsRedactionAndDeployment(t *testing.T) {
	state := json.RawMessage(`{"model":"same-deployment","output":[{"type":"reasoning","id":"rs_1","encrypted_content":"opaque-state","summary":[]},{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"original-sensitive-text"}]},{"type":"function_call","call_id":"c","name":"lookup","arguments":"{}"}]}`)
	message := provider.Message{Role: provider.RoleAssistant, Content: "[redacted]", ProviderState: state}
	req := provider.ChatRequest{Messages: []provider.Message{message}}
	body, err := encodeResponsesRequest(req, "same-deployment")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "original-sensitive-text") ||
		!strings.Contains(string(body), "[redacted]") || !strings.Contains(string(body), "opaque-state") ||
		!strings.Contains(string(body), `"phase":"commentary"`) {
		t.Fatalf("incorrect continuation: %s", body)
	}
	if _, err := encodeResponsesRequest(req, "changed-deployment"); err == nil {
		t.Fatal("replayed continuation against a different deployment")
	}
	encoded, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "opaque-state") || strings.Contains(string(encoded), "original-sensitive-text") {
		t.Fatalf("opaque state leaked into serialized history: %s", encoded)
	}
}

func TestResponsesToolSchemaDoesNotImplicitlyRequireOptionalFields(t *testing.T) {
	body, err := encodeResponsesRequest(provider.ChatRequest{Tools: []provider.ToolSpec{
		{Name: "lookup", Parameters: json.RawMessage(`{"type":"object","properties":{"optional":{"type":"string"}}}`)},
	}}, "any")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"strict":false`) {
		t.Fatalf("optional schema fields would become required: %s", body)
	}
}
