package provider

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/limit"
)

// rlFakeProvider is the test double for the rate-limit decorator.
// Records every call and lets the test inject behaviour per-method.
type rlFakeProvider struct {
	name        string
	chatCalls   atomic.Int32
	streamCalls atomic.Int32
	embedCalls  atomic.Int32

	chatResp *ChatResponse
	chatErr  error

	embedResp *EmbedResponse
	embedErr  error

	streamErr  error
	streamCh   chan Chunk
	streamHook func(<-chan Chunk) // optional inspection of the inner ch
}

func (f *rlFakeProvider) Name() string {
	if f.name == "" {
		return "fake"
	}
	return f.name
}
func (f *rlFakeProvider) Capabilities() Capabilities { return Capabilities{Streaming: true, Embeddings: true} }

func (f *rlFakeProvider) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	f.chatCalls.Add(1)
	if f.chatErr != nil {
		return nil, f.chatErr
	}
	if f.chatResp != nil {
		return f.chatResp, nil
	}
	return &ChatResponse{Message: Message{Role: RoleAssistant, Content: "ok"}, InputTokens: 5, OutputTokens: 7}, nil
}
func (f *rlFakeProvider) Stream(_ context.Context, _ ChatRequest) (<-chan Chunk, error) {
	f.streamCalls.Add(1)
	if f.streamErr != nil {
		return nil, f.streamErr
	}
	if f.streamCh != nil {
		return f.streamCh, nil
	}
	out := make(chan Chunk, 2)
	out <- Chunk{Delta: "hi"}
	out <- Chunk{Done: true}
	close(out)
	return out, nil
}
func (f *rlFakeProvider) Embed(_ context.Context, _ EmbedRequest) (*EmbedResponse, error) {
	f.embedCalls.Add(1)
	if f.embedErr != nil {
		return nil, f.embedErr
	}
	if f.embedResp != nil {
		return f.embedResp, nil
	}
	return &EmbedResponse{Vectors: [][]float32{{1}}, InputTokens: 3}, nil
}

func newRateLimitedTest(t *testing.T, q limit.Quota) (*rlFakeProvider, Provider, *limit.FakeClock) {
	t.Helper()
	clk := limit.NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	tiers := limit.MapTierResolver{"feat-x": string(limit.TierUpgrade)}
	overrides := limit.MapQuotaResolver{"feat-x": q}
	l := limit.New(tiers, limit.WithClock(clk), limit.WithQuotaResolver(overrides))
	fake := &rlFakeProvider{name: "fake"}
	return fake, WithRateLimit(l)(fake), clk
}

func TestWithRateLimit_NilLimiterIsPassthrough(t *testing.T) {
	t.Parallel()
	fake := &rlFakeProvider{}
	wrapped := WithRateLimit(nil)(fake)
	// Should be the EXACT same Provider reference.
	if wrapped != Provider(fake) {
		t.Errorf("nil limiter must return inner unchanged")
	}
}

func TestWithRateLimit_ChatPassesThroughOnAllow(t *testing.T) {
	t.Parallel()
	fake, wrapped, _ := newRateLimitedTest(t, limit.Quota{BurstReq: 5, PerMinute: 100, PerDay: 100})
	ctx := WithFeatureID(WithSubject(context.Background(), "u"), "feat-x")
	resp, err := wrapped.Chat(ctx, ChatRequest{Model: "m"})
	if err != nil {
		t.Fatalf("expected nil err, got %v", err)
	}
	if resp == nil || resp.Message.Content != "ok" {
		t.Errorf("expected pass-through response, got %+v", resp)
	}
	if fake.chatCalls.Load() != 1 {
		t.Errorf("expected 1 inner Chat call; got %d", fake.chatCalls.Load())
	}
}

func TestWithRateLimit_ChatReturnsLimitErrorOnRejection(t *testing.T) {
	t.Parallel()
	// Burst=1; do two parallel chats — second should be rejected.
	fake, wrapped, _ := newRateLimitedTest(t, limit.Quota{BurstReq: 1, PerMinute: 100, PerDay: 100})
	ctx := WithFeatureID(WithSubject(context.Background(), "u"), "feat-x")

	// Block the first call so the second observes inflight.
	gate := make(chan struct{})
	fake.chatResp = nil
	fake.chatErr = nil

	// We can't easily block a real Chat without a custom fake; instead
	// drive concurrency via two goroutines and look for one rejection.
	// Use a slow inner Chat via a custom hook.
	slowInner := &slowChatProvider{name: "fake", gate: gate}
	wrapped2 := WithRateLimit(limiterWith(t, limit.Quota{BurstReq: 1, PerMinute: 100, PerDay: 100}))(slowInner)

	var wg sync.WaitGroup
	var rejected atomic.Int32
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := wrapped2.Chat(ctx, ChatRequest{Model: "m"})
			if err != nil {
				var le *limit.LimitError
				if errors.As(err, &le) && le.Decision.Reason == "burst" {
					rejected.Add(1)
				}
			}
		}()
	}
	// Give goroutines time to enter Allow().
	time.Sleep(50 * time.Millisecond)
	close(gate)
	wg.Wait()

	if rejected.Load() != 1 {
		t.Errorf("expected exactly 1 burst rejection; got %d", rejected.Load())
	}
	_ = wrapped // silence unused
}

// slowChatProvider blocks on gate before responding. Used to force
// concurrent inflight in burst tests.
type slowChatProvider struct {
	name string
	gate chan struct{}
}

func (s *slowChatProvider) Name() string                                                  { return s.name }
func (s *slowChatProvider) Capabilities() Capabilities                                    { return Capabilities{} }
func (s *slowChatProvider) Stream(context.Context, ChatRequest) (<-chan Chunk, error)     { return nil, ErrCapabilityNotSupported }
func (s *slowChatProvider) Embed(context.Context, EmbedRequest) (*EmbedResponse, error)   { return nil, ErrCapabilityNotSupported }
func (s *slowChatProvider) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	<-s.gate
	return &ChatResponse{Message: Message{Role: RoleAssistant, Content: "ok"}}, nil
}

func limiterWith(t *testing.T, q limit.Quota) *limit.Limiter {
	t.Helper()
	return limit.New(
		limit.MapTierResolver{"feat-x": string(limit.TierUpgrade)},
		limit.WithQuotaResolver(limit.MapQuotaResolver{"feat-x": q}),
	)
}

func TestWithRateLimit_StreamPassesAndReleasesOnClose(t *testing.T) {
	t.Parallel()
	fake, wrapped, _ := newRateLimitedTest(t, limit.Quota{BurstReq: 1, PerMinute: 100, PerDay: 100})
	ctx := WithFeatureID(WithSubject(context.Background(), "u"), "feat-x")

	ch1, err := wrapped.Stream(ctx, ChatRequest{Model: "m"})
	if err != nil {
		t.Fatalf("Stream err: %v", err)
	}
	// Drain channel — release happens in the forked goroutine.
	for range ch1 {
	}
	// Wait a touch for the release goroutine.
	time.Sleep(20 * time.Millisecond)

	// Second stream should succeed (slot was released).
	ch2, err := wrapped.Stream(ctx, ChatRequest{Model: "m"})
	if err != nil {
		t.Fatalf("second Stream err: %v", err)
	}
	for range ch2 {
	}
	if got := fake.streamCalls.Load(); got != 2 {
		t.Errorf("expected 2 inner Stream calls; got %d", got)
	}
}

func TestWithRateLimit_StreamCancelReleasesSlot(t *testing.T) {
	t.Parallel()
	fake := &rlFakeProvider{name: "fake"}
	// Open-ended channel — never closes so we test ctx cancel.
	fake.streamCh = make(chan Chunk)
	wrapped := WithRateLimit(limiterWith(t, limit.Quota{BurstReq: 1, PerMinute: 100, PerDay: 100}))(fake)

	ctx, cancel := context.WithCancel(context.Background())
	ctx = WithFeatureID(WithSubject(ctx, "u"), "feat-x")
	out, err := wrapped.Stream(ctx, ChatRequest{Model: "m"})
	if err != nil {
		t.Fatalf("Stream err: %v", err)
	}
	cancel()

	// Drain (channel closes when the forked goroutine returns on ctx.Done).
	deadline := time.After(time.Second)
	for {
		select {
		case _, ok := <-out:
			if !ok {
				return
			}
		case <-deadline:
			t.Fatal("Stream output channel did not close after ctx cancel")
		}
	}
}

func TestWithRateLimit_EmbedPassesAndObservesTokens(t *testing.T) {
	t.Parallel()
	fake, wrapped, _ := newRateLimitedTest(t, limit.Quota{BurstReq: 5, PerMinute: 100, PerDay: 100})
	ctx := WithFeatureID(WithSubject(context.Background(), "u"), "feat-x")
	resp, err := wrapped.Embed(ctx, EmbedRequest{Model: "m", Input: []string{"hi"}})
	if err != nil {
		t.Fatalf("Embed err: %v", err)
	}
	if resp.InputTokens != 3 {
		t.Errorf("unexpected response tokens: %d", resp.InputTokens)
	}
	if fake.embedCalls.Load() != 1 {
		t.Errorf("expected 1 inner Embed call; got %d", fake.embedCalls.Load())
	}
}

func TestWithRateLimit_NameAndCapabilitiesAreDelegated(t *testing.T) {
	t.Parallel()
	fake := &rlFakeProvider{name: "vendor-x"}
	wrapped := WithRateLimit(limiterWith(t, limit.Quota{BurstReq: 5, PerMinute: 100, PerDay: 100}))(fake)
	if wrapped.Name() != "vendor-x" {
		t.Errorf("Name() not delegated; got %q", wrapped.Name())
	}
	if !wrapped.Capabilities().Streaming {
		t.Errorf("Capabilities() not delegated")
	}
}

func TestWithRateLimit_InnerStreamErrorReleasesSlot(t *testing.T) {
	t.Parallel()
	fake := &rlFakeProvider{name: "fake", streamErr: errors.New("upstream down")}
	wrapped := WithRateLimit(limiterWith(t, limit.Quota{BurstReq: 1, PerMinute: 100, PerDay: 100}))(fake)
	ctx := WithFeatureID(WithSubject(context.Background(), "u"), "feat-x")

	if _, err := wrapped.Stream(ctx, ChatRequest{Model: "m"}); err == nil {
		t.Fatal("expected upstream error")
	}
	// Slot should have been released — second call passes.
	fake.streamErr = nil
	ch, err := wrapped.Stream(ctx, ChatRequest{Model: "m"})
	if err != nil {
		t.Fatalf("second Stream after error should succeed; got %v", err)
	}
	for range ch {
	}
}
