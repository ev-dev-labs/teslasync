package provider

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
)

// captureProvider records the ChatRequest / EmbedRequest the redact
// decorator forwarded to it. Used to assert content was rewritten
// before reaching the wire.
type captureProvider struct {
	lastChat  ChatRequest
	lastEmbed EmbedRequest
	chatErr   error
}

func (c *captureProvider) Name() string { return "capture" }
func (c *captureProvider) Capabilities() Capabilities {
	return Capabilities{Embeddings: true, Streaming: true}
}
func (c *captureProvider) Chat(_ context.Context, req ChatRequest) (*ChatResponse, error) {
	c.lastChat = req
	if c.chatErr != nil {
		return nil, c.chatErr
	}
	return &ChatResponse{Message: Message{Role: RoleAssistant, Content: "ok"}}, nil
}
func (c *captureProvider) Stream(_ context.Context, req ChatRequest) (<-chan Chunk, error) {
	c.lastChat = req
	out := make(chan Chunk, 1)
	out <- Chunk{Done: true}
	close(out)
	return out, nil
}
func (c *captureProvider) Embed(_ context.Context, req EmbedRequest) (*EmbedResponse, error) {
	c.lastEmbed = req
	return &EmbedResponse{Vectors: [][]float32{{1, 2, 3}}, InputTokens: 1}, nil
}

func resolverOf(p redact.Policy, ok bool) PolicyResolver {
	return func(context.Context) (redact.Policy, bool) { return p, ok }
}

func TestWithRedaction_ChatRewritesPIIBeforeForwarding(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)

	original := "VIN 5YJ3E1EA2JF000316 alice@example.com"
	req := ChatRequest{Model: "test", Messages: []Message{{Role: RoleUser, Content: original}}}
	ctx := WithFeatureID(context.Background(), "feature-x")
	if _, err := wrapped.Chat(ctx, req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	got := cap.lastChat.Messages[0].Content
	if strings.Contains(got, "5YJ3E1EA2JF000316") {
		t.Errorf("VIN survived to provider: %q", got)
	}
	if strings.Contains(got, "alice@example.com") {
		t.Errorf("email survived to provider: %q", got)
	}
}

func TestWithRedaction_DoesNotMutateInputRequest(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)

	original := "VIN 5YJ3E1EA2JF000316"
	req := ChatRequest{Model: "test", Messages: []Message{{Role: RoleUser, Content: original}}}
	ctx := WithFeatureID(context.Background(), "feature-x")
	if _, err := wrapped.Chat(ctx, req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	// Caller's request must be untouched — the audit decorator (one
	// rung outwards) hashes the SAME variable after the call returns.
	if req.Messages[0].Content != original {
		t.Errorf("input mutated: %q", req.Messages[0].Content)
	}
}

func TestWithRedaction_RecordsMetaWithClasses(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)

	req := ChatRequest{
		Model:    "test",
		Messages: []Message{{Role: RoleUser, Content: "VIN 5YJ3E1EA2JF000316 alice@example.com"}},
	}
	ctx := WithFeatureID(context.Background(), "feature-x")
	if _, err := wrapped.Chat(ctx, req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	hash := chatRequestHash(req)
	meta, ok := redact.ConsumeMeta(redact.MetaKey("feature-x", hash))
	if !ok {
		t.Fatal("meta not recorded")
	}
	if meta.Bypass {
		t.Error("bypass should be false for normal call")
	}
	wantAny := map[redact.PIIClass]bool{redact.ClassVIN: true, redact.ClassEmail: true}
	for _, c := range meta.Classes {
		delete(wantAny, c)
	}
	if len(wantAny) != 0 {
		t.Errorf("missing classes: %v (got %v)", wantAny, meta.Classes)
	}
}

func TestWithRedaction_BypassPolicySkipsRedaction(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	policy := redact.DefaultPolicy()
	policy.Bypass = true
	wrapped := WithRedaction(resolverOf(policy, true))(cap)

	req := ChatRequest{
		Model:    "test",
		Messages: []Message{{Role: RoleUser, Content: "VIN 5YJ3E1EA2JF000316"}},
	}
	ctx := WithFeatureID(context.Background(), "feat-bypass")
	if _, err := wrapped.Chat(ctx, req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	if !strings.Contains(cap.lastChat.Messages[0].Content, "5YJ3E1EA2JF000316") {
		t.Errorf("bypass=true must pass VIN through verbatim, got %q", cap.lastChat.Messages[0].Content)
	}
	hash := chatRequestHash(req)
	meta, ok := redact.ConsumeMeta(redact.MetaKey("feat-bypass", hash))
	if !ok {
		t.Fatal("meta not recorded for bypass")
	}
	if !meta.Bypass {
		t.Error("Bypass must be true in meta when policy.Bypass=true")
	}
}

func TestWithRedaction_NoPolicyInCtxBypasses(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	// Resolver returns ok=false → decorator must bypass + audit.
	wrapped := WithRedaction(func(context.Context) (redact.Policy, bool) {
		return redact.DefaultPolicy(), false
	})(cap)

	req := ChatRequest{
		Model:    "test",
		Messages: []Message{{Role: RoleUser, Content: "VIN 5YJ3E1EA2JF000316"}},
	}
	ctx := WithFeatureID(context.Background(), "feat-nopolicy")
	if _, err := wrapped.Chat(ctx, req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	if !strings.Contains(cap.lastChat.Messages[0].Content, "5YJ3E1EA2JF000316") {
		t.Errorf("missing-policy must not strip content, got %q", cap.lastChat.Messages[0].Content)
	}
	hash := chatRequestHash(req)
	meta, ok := redact.ConsumeMeta(redact.MetaKey("feat-nopolicy", hash))
	if !ok {
		t.Fatal("missing-policy must still record meta (with bypass=true)")
	}
	if !meta.Bypass {
		t.Error("missing-policy meta must mark bypass=true so admin sees it")
	}
}

func TestWithRedaction_NilResolverIsPassthrough(t *testing.T) {
	t.Parallel()
	cap := &captureProvider{}
	got := WithRedaction(nil)(cap)
	// Compile-time identity by interface — calling Chat must reach
	// captureProvider with the original content untouched.
	req := ChatRequest{Messages: []Message{{Content: "VIN 5YJ3E1EA2JF000316"}}}
	if _, err := got.Chat(context.Background(), req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	if !strings.Contains(cap.lastChat.Messages[0].Content, "5YJ3E1EA2JF000316") {
		t.Errorf("nil resolver must passthrough, got %q", cap.lastChat.Messages[0].Content)
	}
}

func TestWithRedaction_PropagatesError(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{chatErr: errors.New("boom")}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)
	_, err := wrapped.Chat(context.Background(), ChatRequest{Messages: []Message{{Content: "foo"}}})
	if err == nil || err.Error() != "boom" {
		t.Errorf("error = %v, want boom", err)
	}
}

func TestWithRedaction_EmbedRedacts(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)

	req := EmbedRequest{Model: "embed", Input: []string{"VIN 5YJ3E1EA2JF000316", "no pii here"}}
	ctx := WithFeatureID(context.Background(), "embed-x")
	if _, err := wrapped.Embed(ctx, req); err != nil {
		t.Fatalf("Embed err = %v", err)
	}
	if strings.Contains(cap.lastEmbed.Input[0], "5YJ3E1EA2JF000316") {
		t.Errorf("VIN survived in embed input: %q", cap.lastEmbed.Input[0])
	}
	if cap.lastEmbed.Input[1] != "no pii here" {
		t.Errorf("non-PII input mutated: %q", cap.lastEmbed.Input[1])
	}
	// Original request not mutated.
	if req.Input[0] != "VIN 5YJ3E1EA2JF000316" {
		t.Errorf("input slice mutated: %q", req.Input[0])
	}
}

func TestWithRedaction_StreamRedacts(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)

	req := ChatRequest{Messages: []Message{{Content: "VIN 5YJ3E1EA2JF000316"}}}
	ctx := WithFeatureID(context.Background(), "stream-x")
	ch, err := wrapped.Stream(ctx, req)
	if err != nil {
		t.Fatalf("Stream err = %v", err)
	}
	for range ch {
		// drain
	}
	if strings.Contains(cap.lastChat.Messages[0].Content, "5YJ3E1EA2JF000316") {
		t.Errorf("VIN survived in stream request: %q", cap.lastChat.Messages[0].Content)
	}
}

func TestWithRedaction_PreservesNonPIIMessagesUnchanged(t *testing.T) {
	redact.ResetMeta()
	defer redact.ResetMeta()

	cap := &captureProvider{}
	wrapped := WithRedaction(resolverOf(redact.DefaultPolicy(), true))(cap)

	req := ChatRequest{Messages: []Message{
		{Role: RoleSystem, Content: "you are a helpful assistant"},
		{Role: RoleUser, Content: "hello"},
	}}
	if _, err := wrapped.Chat(context.Background(), req); err != nil {
		t.Fatalf("Chat err = %v", err)
	}
	for i, m := range cap.lastChat.Messages {
		if m.Content != req.Messages[i].Content {
			t.Errorf("message %d content changed: got %q want %q", i, m.Content, req.Messages[i].Content)
		}
	}
}
