package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// Scripted provider returns canned ChatResponses in order.

type scriptedProvider struct {
	mu    sync.Mutex
	calls int
	resps []*provider.ChatResponse
	err   error
	// requests captures every ChatRequest that flowed into Chat,
	// in order. Used by regression tests that need to assert on
	// the message history the dispatcher built up across turns.
	requests []provider.ChatRequest
}

func newScripted(resps ...*provider.ChatResponse) *scriptedProvider {
	return &scriptedProvider{resps: resps}
}

func (s *scriptedProvider) Name() string { return "scripted" }

func (s *scriptedProvider) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, req)
	if s.err != nil {
		return nil, s.err
	}
	if s.calls >= len(s.resps) {
		// Return a terminal stop so an overrun still finishes; the test
		// catches unexpected extra calls.
		return &provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: ""},
			FinishReason: provider.FinishStop,
		}, nil
	}
	r := s.resps[s.calls]
	s.calls++
	return r, nil
}

func (s *scriptedProvider) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (s *scriptedProvider) Embed(ctx context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (s *scriptedProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Tools: true}
}

type streamingScriptedProvider struct {
	mu          sync.Mutex
	streams     [][]provider.Chunk
	streamErr   error
	chatResp    *provider.ChatResponse
	chatCalls   int
	streamCalls int
	requests    []provider.ChatRequest
}

func (s *streamingScriptedProvider) Name() string { return "streaming-scripted" }
func (s *streamingScriptedProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Tools: true, Streaming: true}
}
func (s *streamingScriptedProvider) Chat(_ context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chatCalls++
	s.requests = append(s.requests, req)
	if s.chatResp == nil {
		return nil, errors.New("unexpected Chat call")
	}
	return s.chatResp, nil
}
func (s *streamingScriptedProvider) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	s.mu.Lock()
	s.streamCalls++
	s.requests = append(s.requests, req)
	if s.streamErr != nil {
		err := s.streamErr
		s.mu.Unlock()
		return nil, err
	}
	index := s.streamCalls - 1
	if index >= len(s.streams) {
		s.mu.Unlock()
		return nil, errors.New("unexpected Stream call")
	}
	chunks := append([]provider.Chunk(nil), s.streams[index]...)
	s.mu.Unlock()

	out := make(chan provider.Chunk, len(chunks))
	go func() {
		defer close(out)
		for _, chunk := range chunks {
			select {
			case <-ctx.Done():
				return
			case out <- chunk:
			}
		}
	}()
	return out, nil
}
func (s *streamingScriptedProvider) Embed(context.Context, provider.EmbedRequest) (*provider.EmbedResponse, error) {
	return nil, provider.ErrCapabilityNotSupported
}

// In-process tools used by dispatch tests.

type pingInput struct{}

type pingTool struct{ mutates bool }

func (p *pingTool) Name() string                 { return "ping" }
func (p *pingTool) Description() string          { return "ping" }
func (p *pingTool) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (p *pingTool) OutputSchema() json.RawMessage {
	return nil
}
func (p *pingTool) Mutates() bool         { return p.mutates }
func (p *pingTool) RequiredScope() string { return "" }
func (p *pingTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[pingInput](raw)
}
func (p *pingTool) Execute(ctx context.Context, in any) (any, error) {
	return map[string]string{"pong": "ok"}, nil
}

type echoInput struct {
	Msg string `json:"msg" validate:"required,len=4"`
}

type echoTool struct{}

func (echoTool) Name() string                 { return "echo" }
func (echoTool) Description() string          { return "echo" }
func (echoTool) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (echoTool) OutputSchema() json.RawMessage {
	return nil
}
func (echoTool) Mutates() bool         { return false }
func (echoTool) RequiredScope() string { return "" }
func (echoTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[echoInput](raw)
}
func (echoTool) Execute(ctx context.Context, in any) (any, error) {
	return map[string]string{"echo": in.(echoInput).Msg}, nil
}

// Minimal strategy for dispatcher tests.

type fakeStrategy struct {
	tools  []string
	system string
	ctx    []provider.Message
}

func (f fakeStrategy) FeatureID() string { return "test" }
func (f fakeStrategy) System() string    { return f.system }
func (f fakeStrategy) Tools() []string   { return f.tools }
func (f fakeStrategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return f.ctx, nil
}
func (f fakeStrategy) RedactionPolicy() strategy.RedactionPolicy { return strategy.NoRedaction{} }
func (f fakeStrategy) EvalGoldens() []strategy.EvalGolden        { return nil }

// Test helpers.

func newRegistry() *tools.Registry {
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	r.Register(echoTool{})
	r.Register(&pingTool{mutates: true})
	return r
}

func newRegistryWithMutator() *tools.Registry {
	r := tools.NewRegistry()
	r.Register(&pingTool{mutates: true})
	return r
}

func TestDispatcher_SimpleChatNoTools(t *testing.T) {
	t.Parallel()
	p := newScripted(&provider.ChatResponse{
		Message:      provider.Message{Role: provider.RoleAssistant, Content: "hello back"},
		FinishReason: provider.FinishStop,
	})
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()
	err := d.Run(context.Background(), fakeStrategy{system: "be nice"}, strategy.StrategyInput{LastMessage: "hi"}, w)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !w.Done() {
		t.Error("Done not called")
	}
	if got := w.Deltas(); len(got) != 1 || got[0] != "hello back" {
		t.Errorf("Deltas = %v", got)
	}
}

func TestDispatcher_InjectsHelixIntelligenceContract(t *testing.T) {
	t.Parallel()

	p := newScripted(&provider.ChatResponse{
		Message: provider.Message{Role: provider.RoleAssistant, Content: "grounded"},
	})
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()
	if err := d.Run(
		context.Background(),
		fakeStrategy{system: "feature format"},
		strategy.StrategyInput{LastMessage: "question"},
		w,
	); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(p.requests) != 1 {
		t.Fatalf("request count = %d, want 1", len(p.requests))
	}
	messages := p.requests[0].Messages
	if len(messages) != 3 {
		t.Fatalf("messages = %+v, want feature system + Helix contract + user", messages)
	}
	if messages[1].Role != provider.RoleSystem ||
		!strings.Contains(messages[1].Content, "Ground every fleet-specific factual claim") ||
		!strings.Contains(messages[1].Content, "generic advice") {
		t.Fatalf("Helix intelligence contract missing or incomplete: %+v", messages[1])
	}
}

func TestDispatcher_StreamsProviderDeltasWithoutUsingChat(t *testing.T) {
	t.Parallel()

	p := &streamingScriptedProvider{streams: [][]provider.Chunk{{
		{Delta: "Hel"},
		{Delta: "ix"},
		{Done: true},
	}}}
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()

	if err := d.Run(context.Background(), fakeStrategy{}, strategy.StrategyInput{LastMessage: "hi"}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := w.Deltas(); len(got) != 2 || got[0] != "Hel" || got[1] != "ix" {
		t.Fatalf("Deltas() = %v, want token chunks", got)
	}
	if p.streamCalls != 1 || p.chatCalls != 0 {
		t.Fatalf("provider calls: stream=%d chat=%d", p.streamCalls, p.chatCalls)
	}
}

func TestDispatcher_StreamingToolChainRoundTripsCompleteCall(t *testing.T) {
	t.Parallel()

	p := &streamingScriptedProvider{streams: [][]provider.Chunk{
		{
			{ToolDelta: &provider.ToolCall{Name: "ping", Arguments: json.RawMessage(`{}`)}},
			{Done: true},
		},
		{
			{Delta: "Grounded answer"},
			{Done: true},
		},
	}}
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()

	if err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{LastMessage: "check"}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := w.ToolCalls(); len(got) != 1 || got[0].ID != "helix_call_1_1" {
		t.Fatalf("ToolCalls() = %+v, want normalized complete call", got)
	}
	if got := strings.Join(w.Deltas(), ""); got != "Grounded answer" {
		t.Fatalf("joined deltas = %q", got)
	}
	if len(p.requests) != 2 {
		t.Fatalf("request count = %d, want 2", len(p.requests))
	}
	second := p.requests[1].Messages
	if len(second) < 3 {
		t.Fatalf("second request history = %+v", second)
	}
	assistant := second[len(second)-2]
	toolMessage := second[len(second)-1]
	if len(assistant.ToolCalls) != 1 || assistant.ToolCalls[0].ID != "helix_call_1_1" {
		t.Fatalf("assistant tool-call history = %+v", assistant.ToolCalls)
	}
	if toolMessage.Role != provider.RoleTool || toolMessage.ToolID != "helix_call_1_1" {
		t.Fatalf("tool result history = %+v", toolMessage)
	}
}

func TestDispatcher_RejectsIncompleteProviderStream(t *testing.T) {
	t.Parallel()

	p := &streamingScriptedProvider{streams: [][]provider.Chunk{{
		{Delta: "partial"},
	}}}
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{}, strategy.StrategyInput{}, w)
	if !errors.Is(err, ErrStreamIncomplete) {
		t.Fatalf("Run error = %v, want ErrStreamIncomplete", err)
	}
	if w.Done() {
		t.Fatal("incomplete stream emitted a success-shaped done event")
	}
	if !errors.Is(w.RunError(), ErrStreamIncomplete) {
		t.Fatalf("terminal error = %v, want ErrStreamIncomplete", w.RunError())
	}
}

func TestDispatcher_RejectsTruncatedCompletionBeforeToolExecution(t *testing.T) {
	t.Parallel()
	p := &streamingScriptedProvider{streams: [][]provider.Chunk{{
		{ToolDelta: &provider.ToolCall{ID: "call_1", Name: "ping", Arguments: json.RawMessage(`{}`)}},
		{Done: true, FinishReason: provider.FinishLength},
	}}}
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w)
	if !errors.Is(err, ErrCompletionTruncated) {
		t.Fatalf("Run error = %v, want ErrCompletionTruncated", err)
	}
	if len(w.ToolCalls()) != 0 || len(w.ToolResults()) != 0 {
		t.Fatalf("truncated completion executed tool: calls=%v results=%v", w.ToolCalls(), w.ToolResults())
	}
	if w.Done() {
		t.Fatal("truncated completion emitted done")
	}
}

func TestDispatcher_PreservesTerminalUsage(t *testing.T) {
	t.Parallel()
	p := &streamingScriptedProvider{streams: [][]provider.Chunk{{
		{Delta: "grounded"},
		{Done: true, FinishReason: provider.FinishStop, InputTokens: 21, OutputTokens: 7},
	}}}
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()

	if err := d.Run(context.Background(), fakeStrategy{}, strategy.StrategyInput{}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}
	finishReason, inputTokens, outputTokens := w.Completion()
	if finishReason != provider.FinishStop || inputTokens != 21 || outputTokens != 7 {
		t.Fatalf("completion = %q %d/%d", finishReason, inputTokens, outputTokens)
	}
}

func TestPrivacySafeToolResultRedactsNestedLocationFields(t *testing.T) {
	t.Parallel()
	raw := json.RawMessage(`{
		"drive":{"start_lat":37.5,"end_lon":-122.3,"start_address":"1 Main St","distance_m":1200},
		"geofences":[{"name":"Home","polygon_wkt":"POLYGON((-122 37))"}],
		"heading":180
	}`)
	safe, err := privacySafeToolResult(raw)
	if err != nil {
		t.Fatalf("privacySafeToolResult: %v", err)
	}
	got := string(safe)
	for _, secret := range []string{"37.5", "-122.3", "1 Main St", "POLYGON"} {
		if strings.Contains(got, secret) {
			t.Errorf("sanitized tool result retained %q: %s", secret, got)
		}
	}
	for _, retained := range []string{`"distance_m":1200`, `"heading":180`, `"name":"Home"`} {
		if !strings.Contains(got, retained) {
			t.Errorf("sanitized tool result lost %s: %s", retained, got)
		}
	}
}

func TestDispatcher_FallsBackWhenStreamCapabilityDrifts(t *testing.T) {
	t.Parallel()

	p := &streamingScriptedProvider{
		streamErr: provider.ErrCapabilityNotSupported,
		chatResp: &provider.ChatResponse{
			Message: provider.Message{Role: provider.RoleAssistant, Content: "fallback"},
		},
	}
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()

	if err := d.Run(context.Background(), fakeStrategy{}, strategy.StrategyInput{}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := strings.Join(w.Deltas(), ""); got != "fallback" {
		t.Fatalf("joined deltas = %q", got)
	}
	if p.streamCalls != 1 || p.chatCalls != 1 {
		t.Fatalf("provider calls: stream=%d chat=%d", p.streamCalls, p.chatCalls)
	}
}

func TestDispatcher_SingleToolCall(t *testing.T) {
	t.Parallel()
	p := newScripted(
		&provider.ChatResponse{
			Message: provider.Message{Role: provider.RoleAssistant},
			ToolCalls: []provider.ToolCall{{
				ID:        "call_1",
				Name:      "ping",
				Arguments: json.RawMessage(`{}`),
			}},
			FinishReason: provider.FinishToolCalls,
		},
		&provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "done"},
			FinishReason: provider.FinishStop,
		},
	)
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if calls := w.ToolCalls(); len(calls) != 1 || calls[0].Name != "ping" {
		t.Errorf("ToolCalls = %v", calls)
	}
	if results := w.ToolResults(); len(results["ping"]) != 1 {
		t.Errorf("ToolResults = %v", results)
	}
	if d := w.Deltas(); len(d) != 1 || d[0] != "done" {
		t.Errorf("Deltas = %v", d)
	}
}

func TestDispatcher_MultiStepToolChain(t *testing.T) {
	t.Parallel()
	p := newScripted(
		// Turn 1: call ping.
		&provider.ChatResponse{
			ToolCalls: []provider.ToolCall{{
				ID:        "call_1",
				Name:      "ping",
				Arguments: json.RawMessage(`{}`),
			}},
		},
		// Turn 2: call echo.
		&provider.ChatResponse{
			ToolCalls: []provider.ToolCall{{
				ID:        "call_2",
				Name:      "echo",
				Arguments: json.RawMessage(`{"msg":"abcd"}`),
			}},
		},
		// Turn 3: stop.
		&provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "all done"},
			FinishReason: provider.FinishStop,
		},
	)
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	r.Register(echoTool{})
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping", "echo"}}, strategy.StrategyInput{}, w)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	calls := w.ToolCalls()
	if len(calls) != 2 || calls[0].Name != "ping" || calls[1].Name != "echo" {
		t.Errorf("expected ping then echo, got %v", calls)
	}
}

func TestDispatcher_MaxIterationCutoff(t *testing.T) {
	t.Parallel()
	// Provider always proposes a tool call → loop never naturally
	// terminates → MaxIterations should kick in.
	infiniteCall := &provider.ChatResponse{
		ToolCalls: []provider.ToolCall{{
			ID:        "loop",
			Name:      "ping",
			Arguments: json.RawMessage(`{}`),
		}},
	}
	resps := make([]*provider.ChatResponse, 0, 10)
	for i := 0; i < 10; i++ {
		resps = append(resps, infiniteCall)
	}
	p := newScripted(resps...)
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	d := New(r, p, nil, 3) // max=3
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w)
	if !errors.Is(err, ErrMaxIterations) {
		t.Errorf("err = %v, want ErrMaxIterations", err)
	}
	if got := len(w.ToolCalls()); got != 3 {
		t.Errorf("ToolCalls count = %d, want 3", got)
	}
}

func TestDispatcher_ConfirmDeniedAbortsRun(t *testing.T) {
	t.Parallel()
	p := newScripted(&provider.ChatResponse{
		ToolCalls: []provider.ToolCall{{
			ID:        "x",
			Name:      "ping",
			Arguments: json.RawMessage(`{}`),
		}},
	})
	r := newRegistryWithMutator() // ping is mutating here
	denying := func(_ context.Context, _ ConfirmRequest) (ConfirmDecision, error) {
		return ConfirmDenied, nil
	}
	d := New(r, p, denying, 0)
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w)
	if !errors.Is(err, ErrConfirmationDenied) {
		t.Errorf("err = %v, want ErrConfirmationDenied", err)
	}
	// ToolCall was announced (so the UI showed it) but no result/error event.
	if len(w.ToolCalls()) != 1 {
		t.Errorf("expected 1 announced call, got %d", len(w.ToolCalls()))
	}
	if results := w.ToolResults(); len(results) != 0 {
		t.Errorf("denied call should not produce result, got %v", results)
	}
}

func TestDispatcher_ConfirmApprovedExecutesMutator(t *testing.T) {
	t.Parallel()
	p := newScripted(
		&provider.ChatResponse{
			ToolCalls: []provider.ToolCall{{
				ID:        "x",
				Name:      "ping",
				Arguments: json.RawMessage(`{}`),
			}},
		},
		&provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "done"},
			FinishReason: provider.FinishStop,
		},
	)
	r := newRegistryWithMutator()
	approving := func(_ context.Context, _ ConfirmRequest) (ConfirmDecision, error) {
		return ConfirmApproved, nil
	}
	d := New(r, p, approving, 0)
	w := NewCaptureWriter()

	if err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if results := w.ToolResults(); len(results["ping"]) != 1 {
		t.Errorf("expected ping result, got %v", results)
	}
}

func TestDispatcher_ToolNotInStrategyAllowlistRejected(t *testing.T) {
	t.Parallel()
	p := newScripted(
		&provider.ChatResponse{
			ToolCalls: []provider.ToolCall{{
				ID:        "x",
				Name:      "echo",
				Arguments: json.RawMessage(`{"msg":"abcd"}`),
			}},
		},
		&provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "ok"},
			FinishReason: provider.FinishStop,
		},
	)
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	r.Register(echoTool{})
	// Strategy whitelists ping only; LLM hallucinates "echo".
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()

	err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	errs := w.ToolErrors()
	if len(errs["echo"]) == 0 {
		t.Error("expected tool error for disallowed echo")
	}
	if !strings.Contains(errs["echo"][0].Error(), "not allowed") {
		t.Errorf("error message = %v", errs["echo"][0])
	}
}

func TestDispatcher_ToolValidationFailureSurfacedToLLM(t *testing.T) {
	t.Parallel()
	p := newScripted(
		&provider.ChatResponse{
			ToolCalls: []provider.ToolCall{{
				ID:        "x",
				Name:      "echo",
				Arguments: json.RawMessage(`{"msg":"ABC"}`), // len=4 fails
			}},
		},
		&provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "saw the error"},
			FinishReason: provider.FinishStop,
		},
	)
	r := tools.NewRegistry()
	r.Register(echoTool{})
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()
	if err := d.Run(context.Background(), fakeStrategy{tools: []string{"echo"}}, strategy.StrategyInput{}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(w.ToolErrors()["echo"]) == 0 {
		t.Error("expected tool error for failed validation")
	}
}

func TestDispatcher_ProviderErrorReturned(t *testing.T) {
	t.Parallel()
	p := &scriptedProvider{err: errors.New("boom")}
	d := New(tools.NewRegistry(), p, nil, 0)
	w := NewCaptureWriter()
	err := d.Run(context.Background(), fakeStrategy{}, strategy.StrategyInput{}, w)
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Errorf("expected provider error, got %v", err)
	}
}

func TestDispatcher_StrategyReferencesMissingTool(t *testing.T) {
	t.Parallel()
	d := New(tools.NewRegistry(), newScripted(), nil, 0)
	w := NewCaptureWriter()
	err := d.Run(context.Background(), fakeStrategy{tools: []string{"nope"}}, strategy.StrategyInput{}, w)
	if err == nil || !strings.Contains(err.Error(), "unregistered tool") {
		t.Errorf("expected unregistered-tool error, got %v", err)
	}
}

func TestContinuationState_RoundTrip(t *testing.T) {
	t.Parallel()
	in := ContinuationState{
		FeatureID:   "feature-x",
		Messages:    []json.RawMessage{json.RawMessage(`{"role":"user"}`)},
		PendingCall: json.RawMessage(`{"name":"ping","arguments":{}}`),
	}
	raw, err := MarshalState(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	out, err := UnmarshalState(raw)
	if err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if out.FeatureID != in.FeatureID {
		t.Errorf("FeatureID round-trip lost: %v", out)
	}
	if len(out.Messages) != 1 {
		t.Errorf("Messages round-trip lost: %v", out)
	}
}

// TestDispatcher_AssistantToolCallRoundTrip is a regression test for
// the strict-provider failure surfaced when Azure / OpenAI rejected
// iter 1 of a multi-turn dispatch with:
//
//	azure chat status 400: Invalid value for 'content':
//	expected a string, got null. param: messages.[N].content
//
// Root cause: the dispatcher appended `resp.Message` to the
// conversation history but the proposed tool calls lived on the
// separate `resp.ToolCalls` field, so the assistant message that
// went back into iter 1's request had neither content nor
// tool_calls. Strict OpenAI-spec providers reject that.
//
// Fix: dispatch.go copies `resp.ToolCalls` onto `asst.ToolCalls`
// (plural, on provider.Message) before appending. This test
// asserts the next request the provider sees DOES carry the
// proposed tool_calls so it can re-emit them on the wire.
func TestDispatcher_AssistantToolCallRoundTrip(t *testing.T) {
	t.Parallel()
	p := newScripted(
		&provider.ChatResponse{
			Message: provider.Message{Role: provider.RoleAssistant},
			ToolCalls: []provider.ToolCall{{
				ID:        "call_42",
				Name:      "ping",
				Arguments: json.RawMessage(`{}`),
			}},
			FinishReason: provider.FinishToolCalls,
		},
		&provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "ok"},
			FinishReason: provider.FinishStop,
		},
	)
	r := tools.NewRegistry()
	r.Register(&pingTool{})
	d := New(r, p, nil, 0)
	w := NewCaptureWriter()

	if err := d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{}, w); err != nil {
		t.Fatalf("Run: %v", err)
	}

	if got := len(p.requests); got < 2 {
		t.Fatalf("provider request count = %d, want >= 2", got)
	}

	iter1 := p.requests[1].Messages
	var asst *provider.Message
	for i := range iter1 {
		m := &iter1[i]
		if m.Role == provider.RoleAssistant && len(m.ToolCalls) > 0 {
			asst = m
			break
		}
	}
	if asst == nil {
		t.Fatalf("iter 1 messages did not contain an assistant turn with ToolCalls; got %#v", iter1)
	}
	if len(asst.ToolCalls) != 1 {
		t.Fatalf("assistant turn ToolCalls len = %d, want 1", len(asst.ToolCalls))
	}
	if asst.ToolCalls[0].ID != "call_42" || asst.ToolCalls[0].Name != "ping" {
		t.Errorf("round-tripped ToolCall = %+v, want {ID:call_42 Name:ping}", asst.ToolCalls[0])
	}

	var foundTool bool
	for _, m := range iter1 {
		if m.Role == provider.RoleTool && m.ToolID == "call_42" {
			foundTool = true
			break
		}
	}
	if !foundTool {
		t.Errorf("iter 1 missing tool result for call_42; messages=%#v", iter1)
	}
}
