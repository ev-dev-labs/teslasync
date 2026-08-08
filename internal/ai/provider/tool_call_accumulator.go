package provider

import (
	"encoding/json"
	"strings"
)

// ToolCallAccumulator assembles provider-native streaming fragments into
// complete tool calls. OpenAI-compatible APIs split function arguments over
// multiple SSE frames, while Anthropic sends tool metadata and JSON input in
// separate content-block events. Adapters emit only the completed calls so
// dispatch never validates or executes partial JSON.
type ToolCallAccumulator struct {
	order []int
	calls map[int]*toolCallBuilder
}

type toolCallBuilder struct {
	id        string
	name      string
	arguments strings.Builder
}

// Add merges one provider delta into the call at index. ID and name fragments
// are de-duplicated when a provider repeats metadata; argument fragments are
// appended exactly because repeated JSON text can be semantically meaningful.
func (a *ToolCallAccumulator) Add(index int, id, name, argumentsFragment string) {
	if a.calls == nil {
		a.calls = make(map[int]*toolCallBuilder)
	}
	call, ok := a.calls[index]
	if !ok {
		call = &toolCallBuilder{}
		a.calls[index] = call
		a.order = append(a.order, index)
	}
	call.id = mergeMetadataFragment(call.id, id)
	call.name = mergeMetadataFragment(call.name, name)
	call.arguments.WriteString(argumentsFragment)
}

// Calls returns complete tool calls in first-seen order. Providers may omit
// arguments for an empty object, so an empty accumulation normalizes to {}.
func (a *ToolCallAccumulator) Calls() []ToolCall {
	out := make([]ToolCall, 0, len(a.order))
	for _, index := range a.order {
		call := a.calls[index]
		arguments := call.arguments.String()
		if strings.TrimSpace(arguments) == "" {
			arguments = "{}"
		}
		out = append(out, ToolCall{
			ID:        call.id,
			Name:      call.name,
			Arguments: json.RawMessage(arguments),
		})
	}
	return out
}

func mergeMetadataFragment(current, fragment string) string {
	if fragment == "" || fragment == current {
		return current
	}
	if current == "" {
		return fragment
	}
	if strings.HasPrefix(fragment, current) {
		return fragment
	}
	if strings.HasSuffix(current, fragment) {
		return current
	}
	return current + fragment
}
