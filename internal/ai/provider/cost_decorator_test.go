package provider

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/limit"
)

// ccFakeRepo / ccFakeProvider mirror their rate-limit-test cousins
// but live in this file so the cost-cap tests can stand alone.
type ccFakeRepo struct {
	spend int64
	calls atomic.Int32
}

func (r *ccFakeRepo) TodaySpend(_ context.Context, _ string) (int64, error) {
	r.calls.Add(1)
	return r.spend, nil
}

type ccFakeProvider struct {
	name      string
	chatResp  *ChatResponse
	chatErr   error
	embedResp *EmbedResponse
	embedErr  error
	streamCh  chan Chunk
	streamErr error
}

func (f *ccFakeProvider) Name() string {
	if f.name == "" {
		return "openai"
	}
	return f.name
}
func (f *ccFakeProvider) Capabilities() Capabilities {
	return Capabilities{Streaming: true, Embeddings: true}
}
func (f *ccFakeProvider) Chat(context.Context, ChatRequest) (*ChatResponse, error) {
	if f.chatErr != nil {
		return nil, f.chatErr
	}
	if f.chatResp != nil {
		return f.chatResp, nil
	}
	return &ChatResponse{Message: Message{Role: RoleAssistant, Content: "ok"}, InputTokens: 100, OutputTokens: 100}, nil
}
func (f *ccFakeProvider) Stream(context.Context, ChatRequest) (<-chan Chunk, error) {
	if f.streamErr != nil {
		return nil, f.streamErr
	}
	if f.streamCh != nil {
		return f.streamCh, nil
	}
	out := make(chan Chunk, 1)
	out <- Chunk{Done: true}
	close(out)
	return out, nil
}
func (f *ccFakeProvider) Embed(context.Context, EmbedRequest) (*EmbedResponse, error) {
	if f.embedErr != nil {
		return nil, f.embedErr
	}
	if f.embedResp != nil {
		return f.embedResp, nil
	}
	return &EmbedResponse{Vectors: [][]float32{{1}}, InputTokens: 3}, nil
}

func newCostCapDecoratorTest(t *testing.T, capCents int, repoSpend int64) (*ccFakeProvider, Provider, *ccFakeRepo) {
	t.Helper()
	repo := &ccFakeRepo{spend: repoSpend}
	lookup := func(_ context.Context, _ string) (int, error) { return capCents, nil }
	cap := limit.NewCostCap(repo, lookup)
	fake := &ccFakeProvider{name: "openai"}
	return fake, WithCostCap(cap)(fake), repo
}

func TestWithCostCap_NilCapIsPassthrough(t *testing.T) {
	t.Parallel()
	fake := &ccFakeProvider{}
	if got := WithCostCap(nil)(fake); got != Provider(fake) {
		t.Errorf("nil cap should return inner unchanged")
	}
}

func TestWithCostCap_AllowsUnderCap(t *testing.T) {
	t.Parallel()
	fake, wrapped, _ := newCostCapDecoratorTest(t, 100, 0) // $1 cap, $0 spent
	ctx := WithSubject(context.Background(), "u")
	req := ChatRequest{Model: "gpt-4o-mini", Messages: []Message{{Role: RoleUser, Content: "hi"}}}
	resp, err := wrapped.Chat(ctx, req)
	if err != nil {
		t.Fatalf("Chat err: %v", err)
	}
	if resp.Message.Content != "ok" {
		t.Errorf("expected pass-through")
	}
	_ = fake
}

func TestWithCostCap_RejectsOverCap(t *testing.T) {
	t.Parallel()
	// Cap = 1 cent = 10_000 micro-cents.
	// Build a large prompt: 100k chars / 4 = 25k input tokens.
	// gpt-4o-mini @ 150_000 mc/M => 25_000 * 150_000 / 1M = 3_750 mc input.
	// Default MaxTokens=0 -> 1024 output @ 600_000 mc/M = 614 mc.
	// Total est ~ 4_364 mc — UNDER 10_000. Need to make it bigger.
	// Up the prompt to 1M chars => 250k input tokens => 37_500 mc => over.
	_, wrapped, _ := newCostCapDecoratorTest(t, 1, 0)
	bigContent := makeRepeatedString("x", 1_000_000)
	req := ChatRequest{Model: "gpt-4o-mini", Messages: []Message{{Role: RoleUser, Content: bigContent}}}
	ctx := WithSubject(context.Background(), "u")
	_, err := wrapped.Chat(ctx, req)
	if err == nil {
		t.Fatal("expected reject")
	}
	var le *limit.LimitError
	if !errors.As(err, &le) {
		t.Fatalf("expected LimitError, got %T %v", err, err)
	}
	if le.Decision.Reason != "cost_cap" {
		t.Errorf("expected reason cost_cap, got %q", le.Decision.Reason)
	}
}

func TestWithCostCap_StreamPassesUnderCap(t *testing.T) {
	t.Parallel()
	_, wrapped, _ := newCostCapDecoratorTest(t, 100, 0)
	ctx := WithSubject(context.Background(), "u")
	ch, err := wrapped.Stream(ctx, ChatRequest{Model: "gpt-4o-mini"})
	if err != nil {
		t.Fatalf("Stream err: %v", err)
	}
	for range ch {
	}
}

func TestWithCostCap_EmbedPassesUnderCap(t *testing.T) {
	t.Parallel()
	_, wrapped, _ := newCostCapDecoratorTest(t, 100, 0)
	ctx := WithSubject(context.Background(), "u")
	resp, err := wrapped.Embed(ctx, EmbedRequest{Model: "text-embedding-3-small", Input: []string{"hi"}})
	if err != nil {
		t.Fatalf("Embed err: %v", err)
	}
	if resp.InputTokens != 3 {
		t.Errorf("unexpected resp")
	}
}

func TestWithCostCap_SettingsErrorRejects(t *testing.T) {
	t.Parallel()
	repo := &ccFakeRepo{}
	failingLookup := func(_ context.Context, _ string) (int, error) {
		return 0, errors.New("settings down")
	}
	cap := limit.NewCostCap(repo, failingLookup)
	fake := &ccFakeProvider{name: "openai"}
	wrapped := WithCostCap(cap)(fake)

	ctx := WithSubject(context.Background(), "u")
	_, err := wrapped.Chat(ctx, ChatRequest{Model: "gpt-4o-mini"})
	if err == nil {
		t.Fatal("expected reject on settings failure")
	}
	var le *limit.LimitError
	if !errors.As(err, &le) {
		t.Fatalf("expected LimitError, got %T", err)
	}
	if le.Decision.Reason != "settings_unavailable" {
		t.Errorf("expected reason settings_unavailable, got %q", le.Decision.Reason)
	}
}

func TestWithCostCap_NameDelegated(t *testing.T) {
	t.Parallel()
	_, wrapped, _ := newCostCapDecoratorTest(t, 100, 0)
	if wrapped.Name() != "openai" {
		t.Errorf("Name not delegated, got %q", wrapped.Name())
	}
}

func TestWithCostCap_NilLookupTreatedAsPassthrough(t *testing.T) {
	t.Parallel()
	// NewCostCap panics on nil lookup — to test the decorator's nil-cap
	// path, just confirm a nil cap is passthrough (covered above) and
	// the wiring catches nil lookup at construction.
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected NewCostCap to panic on nil lookup")
		}
	}()
	_ = limit.NewCostCap(&ccFakeRepo{}, nil)
}

func TestEstimateTokensRoundsUpForShortMessages(t *testing.T) {
	t.Parallel()
	in, out := estimateTokens(ChatRequest{Messages: []Message{{Content: "x"}}})
	if in != 1 {
		t.Errorf("expected 1 input token for 1-char msg, got %d", in)
	}
	if out != 1024 {
		t.Errorf("expected default 1024 output tokens when MaxTokens=0, got %d", out)
	}
}

func TestEstimateTokensHonoursMaxTokens(t *testing.T) {
	t.Parallel()
	_, out := estimateTokens(ChatRequest{Messages: []Message{{Content: "hi"}}, MaxTokens: 50})
	if out != 50 {
		t.Errorf("expected 50, got %d", out)
	}
}

func makeRepeatedString(s string, n int) string {
	b := make([]byte, n*len(s))
	for i := 0; i < n; i++ {
		copy(b[i*len(s):], s)
	}
	return string(b)
}
