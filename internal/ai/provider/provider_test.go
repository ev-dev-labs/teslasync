package provider

import (
	"encoding/json"
	"testing"
)

// TestMessage_JSONRoundTrip pins the on-the-wire shape of [Message] so
// adapter packages that serialise [Message] directly do not silently
// rename a field. Asserts both directions.
func TestMessage_JSONRoundTrip(t *testing.T) {
	t.Parallel()
	in := Message{
		Role:    RoleAssistant,
		Content: "hi",
		Name:    "weather_tool",
		ToolID:  "call_123",
		Tool: &ToolCall{
			ID:        "call_123",
			Name:      "weather_tool",
			Arguments: json.RawMessage(`{"city":"Seattle"}`),
		},
	}
	blob, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out Message
	if err := json.Unmarshal(blob, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Role != in.Role || out.Content != in.Content || out.ToolID != in.ToolID {
		t.Fatalf("round-trip mismatch: in=%+v out=%+v", in, out)
	}
	if out.Tool == nil || out.Tool.Name != in.Tool.Name || string(out.Tool.Arguments) != string(in.Tool.Arguments) {
		t.Fatalf("tool round-trip mismatch: in=%+v out=%+v", in.Tool, out.Tool)
	}
}

// TestCapabilities_Defaults proves a zero-value Capabilities advertises
// nothing — features inspect this at registration time and fall through
// to the heuristic baseline when the adapter omits a capability.
func TestCapabilities_Defaults(t *testing.T) {
	t.Parallel()
	var c Capabilities
	if c.Tools || c.Streaming || c.Embeddings || c.MaxContext != 0 {
		t.Fatalf("zero-value Capabilities expected all-false / 0, got %+v", c)
	}
}

// TestFinishReasons_AreStable pins the constant values so a downstream
// strategy that compares against the literal strings does not break.
func TestFinishReasons_AreStable(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		FinishStop:          "stop",
		FinishToolCalls:     "tool_calls",
		FinishLength:        "length",
		FinishContentFilter: "content_filter",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("finish reason %q != %q", got, want)
		}
	}
}

func TestNormalizeFinishReason(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"stop":           FinishStop,
		"end_turn":       FinishStop,
		"stop_sequence":  FinishStop,
		"tool_calls":     FinishToolCalls,
		"tool_use":       FinishToolCalls,
		"length":         FinishLength,
		"max_tokens":     FinishLength,
		"content_filter": FinishContentFilter,
		"unknown":        "",
		"":               "",
	}
	for input, want := range cases {
		if got := NormalizeFinishReason(input); got != want {
			t.Errorf("NormalizeFinishReason(%q) = %q, want %q", input, got, want)
		}
	}
}

// TestRoles_AreStable mirrors TestFinishReasons_AreStable.
func TestRoles_AreStable(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		RoleSystem:    "system",
		RoleUser:      "user",
		RoleAssistant: "assistant",
		RoleTool:      "tool",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("role %q != %q", got, want)
		}
	}
}
