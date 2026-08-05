// Canned-reply file format + FIFO sequence support for the F6 eval
// harness. Adds a deterministic-sequence wrapper around the existing
// [Mock] provider WITHOUT modifying mock.go: the eval harness needs a
// per-golden FIFO of canned replies to script multi-turn dialogs
// (tool_call → tool_result → final answer), which the byHash /
// byPrompt scheme in mock.go cannot model.
//
// Two extension points:
//
//  1. [SequencedMock] wraps a *[Mock] and consumes a FIFO list of
//     [Reply] values: each call to Chat / Stream returns the next
//     entry, in order. After exhaustion, Chat / Stream falls through
//     to the embedded Mock (so the dispatcher's post-tool-call loop
//     terminates cleanly via Mock.Default).
//
//  2. [LoadCannedFile] parses a YAML document of the shape:
//
//     replies:
//     - finish_reason: tool_calls
//     tool_calls:
//     - id: call_1
//     name: query_battery_status
//     arguments: '{"vehicle_id": 1}'
//     - finish_reason: stop
//     content: "Your range is about 310 miles."
//
//     One file per golden. See `internal/ai/strategies/<feature>/canned/`.
//
// ADR-015: canned files keep the eval harness 100% offline. F4's
// dispatcher contract is unchanged — the LLM still proposes tool
// calls through provider.ToolCall, the dispatcher still validates +
// (auto-approves in eval) executes; the assertions in
// [internal/ai/eval] inspect what actually flowed.
package mock

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"gopkg.in/yaml.v3"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// CannedReply is the YAML wire shape for one entry in the `replies`
// list of a canned file. It mirrors the public surface of
// [provider.ChatResponse] while staying YAML-friendly:
//
//   - Content collapses to a [provider.Message] with role=assistant.
//   - ToolCalls is a list of {id,name,arguments} triples; arguments
//     is a YAML-embedded JSON string (the shape the OpenAI/Anthropic
//     wire formats use), preserved verbatim into [provider.ToolCall.Arguments].
//   - FinishReason MUST be one of provider.Finish* constants.
//   - InputTokens / OutputTokens are best-effort token counters the
//     audit decorator (F3) records when present.
//
// A canned reply is converted to [Reply] by [CannedFile.ToReplies],
// performing the JSON parse on the embedded tool-call argument
// strings.
type CannedReply struct {
	Content      string           `yaml:"content,omitempty"`
	ToolCalls    []CannedToolCall `yaml:"tool_calls,omitempty"`
	FinishReason string           `yaml:"finish_reason"`
	InputTokens  int              `yaml:"input_tokens,omitempty"`
	OutputTokens int              `yaml:"output_tokens,omitempty"`
	ErrorMessage string           `yaml:"error,omitempty"`
}

// CannedToolCall is the YAML shape for one tool-call proposal inside a
// canned reply. Arguments is a JSON-encoded string (the wire format
// every provider uses) so authors can write it as a single-line YAML
// string without nested-object quoting trouble.
type CannedToolCall struct {
	ID        string `yaml:"id"`
	Name      string `yaml:"name"`
	Arguments string `yaml:"arguments"`
}

// CannedFile is the top-level YAML document for a canned-reply file.
// One file per golden (path:
// internal/ai/strategies/<feature>/canned/<golden_name>.yaml).
type CannedFile struct {
	Replies []CannedReply `yaml:"replies"`
}

// LoadCannedFile parses the YAML at path into a [CannedFile]. Returns
// a wrapped error containing the path so callers can pinpoint the
// offending file; an empty `replies:` list is a hard error (a golden
// with no canned replies cannot be replayed).
func LoadCannedFile(path string) (*CannedFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("mock: read canned file %s: %w", path, err)
	}
	var f CannedFile
	if err := yaml.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("mock: parse canned file %s: %w", path, err)
	}
	if len(f.Replies) == 0 {
		return nil, fmt.Errorf("mock: canned file %s declares no replies", path)
	}
	for i, r := range f.Replies {
		if r.FinishReason == "" {
			return nil, fmt.Errorf("mock: canned file %s reply[%d] has empty finish_reason", path, i)
		}
		switch r.FinishReason {
		case provider.FinishStop, provider.FinishToolCalls, provider.FinishLength, provider.FinishContentFilter:
			// allowed
		default:
			return nil, fmt.Errorf("mock: canned file %s reply[%d] finish_reason %q not one of stop/tool_calls/length/content_filter",
				path, i, r.FinishReason)
		}
		for j, tc := range r.ToolCalls {
			if tc.Name == "" {
				return nil, fmt.Errorf("mock: canned file %s reply[%d].tool_calls[%d] empty name", path, i, j)
			}
			if tc.ID == "" {
				return nil, fmt.Errorf("mock: canned file %s reply[%d].tool_calls[%d] empty id", path, i, j)
			}
			if !json.Valid([]byte(tc.Arguments)) {
				return nil, fmt.Errorf("mock: canned file %s reply[%d].tool_calls[%d] arguments %q is not valid JSON",
					path, i, j, tc.Arguments)
			}
		}
	}
	return &f, nil
}

// ToReplies converts the on-disk canned shape to in-memory [Reply]s
// suitable for [SequencedMock.SetSequence]. Each canned reply becomes a
// provider.ChatResponse with the embedded message + tool calls.
func (f *CannedFile) ToReplies() []Reply {
	out := make([]Reply, 0, len(f.Replies))
	for _, r := range f.Replies {
		var calls []provider.ToolCall
		for _, tc := range r.ToolCalls {
			calls = append(calls, provider.ToolCall{
				ID:        tc.ID,
				Name:      tc.Name,
				Arguments: json.RawMessage(tc.Arguments),
			})
		}
		reply := Reply{
			ChatResponse: provider.ChatResponse{
				Message: provider.Message{
					Role:    provider.RoleAssistant,
					Content: r.Content,
				},
				ToolCalls:    calls,
				InputTokens:  r.InputTokens,
				OutputTokens: r.OutputTokens,
				FinishReason: r.FinishReason,
			},
		}
		if r.ErrorMessage != "" {
			reply.Err = fmt.Errorf("%s", r.ErrorMessage)
		}
		out = append(out, reply)
	}
	return out
}

// SequencedMock wraps a [*Mock] and replays a FIFO list of [Reply]s
// before falling through to the embedded mock's byHash / byPrompt /
// Default lookup. It satisfies [provider.Provider] by promoting the
// embedded *Mock for Name / Capabilities / Embed and overriding Chat
// + Stream with the sequence-aware variants.
//
// Lookup order on Chat / Stream:
//
//  1. FIFO sequence installed by [SequencedMock.SetSequence],
//  2. then the embedded [*Mock]'s lookup chain (byHash → byPrompt →
//     Default).
//
// The eval harness instantiates one SequencedMock per golden, calls
// SetSequence with the canned file's replies, and lets the dispatcher
// drive. The post-sequence fall-through to Mock.Default lets multi-turn
// goldens (tool_call → tool_result → … → final answer) terminate
// cleanly even if the canned file omits a final stop reply, but
// authors are encouraged to include it explicitly for clarity.
type SequencedMock struct {
	*Mock
	mu      sync.Mutex
	replies []Reply
	idx     int
	loop    bool
}

// NewSequencedMock returns a SequencedMock wrapping the given Mock.
// Pass the same Capabilities you would to [New].
func NewSequencedMock(m *Mock) *SequencedMock {
	return &SequencedMock{Mock: m}
}

// SetSequence installs a FIFO list of replies the next len(replies)
// calls to [SequencedMock.Chat] / [SequencedMock.Stream] will consume
// IN ORDER. After the sequence is exhausted, lookup falls through to
// the embedded Mock's lookup chain.
//
// Subsequent SetSequence calls REPLACE the sequence (not append) — a
// per-golden runner constructs a fresh sequence per case.
//
// Passing a nil or empty slice clears the sequence.
func (s *SequencedMock) SetSequence(replies []Reply) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replies = append(s.replies[:0], replies...)
	s.idx = 0
	s.loop = false
}

// SetSequenceLooping is SetSequence + wrap-around at end. Used by
// stress tests that need an indefinite supply of canned replies; the
// eval harness does NOT use this so a missing canned reply is a hard
// failure rather than an infinite loop on a stale fixture.
func (s *SequencedMock) SetSequenceLooping(replies []Reply) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replies = append(s.replies[:0], replies...)
	s.idx = 0
	s.loop = true
}

// SequenceProgress reports how many replies have been consumed and
// the total length. Useful for assertions like "this golden produced
// exactly 2 turns of dialog".
func (s *SequencedMock) SequenceProgress() (consumed, total int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.idx, len(s.replies)
}

// nextSequenced returns the next sequence reply and a boolean ok
// flag. ok=false means the sequence is empty or exhausted (and not
// looping); the caller falls through to the embedded Mock.
func (s *SequencedMock) nextSequenced() (Reply, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.replies) == 0 {
		return Reply{}, false
	}
	if s.idx >= len(s.replies) {
		if !s.loop {
			return Reply{}, false
		}
		s.idx = 0
	}
	r := s.replies[s.idx]
	s.idx++
	return r, true
}

// Chat overrides [Mock.Chat] to consult the FIFO sequence first.
// On exhaustion (or empty sequence), forwards to the embedded Mock.
func (s *SequencedMock) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r, ok := s.nextSequenced()
	if !ok {
		return s.Mock.Chat(ctx, req)
	}
	if r.Err != nil {
		return nil, r.Err
	}
	resp := r.ChatResponse
	return &resp, nil
}

// Stream overrides [Mock.Stream] to consult the FIFO sequence first.
// On exhaustion, forwards to the embedded Mock. The streamed chunks
// are delivered the same way [Mock.Stream] does — one rune per chunk,
// terminated by a Done chunk.
func (s *SequencedMock) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	if !s.Mock.caps.Streaming {
		return nil, provider.ErrCapabilityNotSupported
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r, ok := s.nextSequenced()
	if !ok {
		return s.Mock.Stream(ctx, req)
	}
	out := make(chan provider.Chunk, 8)
	go func() {
		defer close(out)
		if r.Err != nil {
			select {
			case out <- provider.Chunk{Err: r.Err}:
			case <-ctx.Done():
			}
			return
		}
		for _, ru := range r.ChatResponse.Message.Content {
			select {
			case <-ctx.Done():
				return
			case out <- provider.Chunk{Delta: string(ru)}:
			}
		}
		finishReason := r.ChatResponse.FinishReason
		if finishReason == "" {
			if len(r.ChatResponse.ToolCalls) > 0 {
				finishReason = provider.FinishToolCalls
			} else {
				finishReason = provider.FinishStop
			}
		}
		if finishReason == provider.FinishToolCalls {
			for _, call := range r.ChatResponse.ToolCalls {
				callCopy := call
				select {
				case <-ctx.Done():
					return
				case out <- provider.Chunk{ToolDelta: &callCopy}:
				}
			}
		}
		select {
		case <-ctx.Done():
		case out <- provider.Chunk{
			Done:         true,
			FinishReason: finishReason,
			InputTokens:  r.ChatResponse.InputTokens,
			OutputTokens: r.ChatResponse.OutputTokens,
		}:
		}
	}()
	return out, nil
}

// Compile-time: SequencedMock satisfies the provider port.
var _ provider.Provider = (*SequencedMock)(nil)
