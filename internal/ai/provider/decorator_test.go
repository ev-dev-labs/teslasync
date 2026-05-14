package provider

import (
	"context"
	"testing"
)

// stubProvider records the wrap order for [TestChain_AppliesInOrder].
type stubProvider struct {
	name  string
	calls *[]string
}

func (s *stubProvider) Name() string               { return s.name }
func (s *stubProvider) Capabilities() Capabilities { return Capabilities{} }
func (s *stubProvider) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	*s.calls = append(*s.calls, "base.chat")
	return &ChatResponse{}, nil
}
func (s *stubProvider) Stream(_ context.Context, _ ChatRequest) (<-chan Chunk, error) {
	*s.calls = append(*s.calls, "base.stream")
	ch := make(chan Chunk)
	close(ch)
	return ch, nil
}
func (s *stubProvider) Embed(_ context.Context, _ EmbedRequest) (*EmbedResponse, error) {
	*s.calls = append(*s.calls, "base.embed")
	return &EmbedResponse{}, nil
}

// recordingDecorator returns a decorator that prepends a tag to the
// call slice before delegating to the inner provider, and similarly
// after. Used to prove [Chain] composes left-to-right (outer-to-inner).
func recordingDecorator(tag string, calls *[]string) Decorator {
	return func(inner Provider) Provider {
		return &recordingProvider{tag: tag, inner: inner, calls: calls}
	}
}

type recordingProvider struct {
	tag   string
	inner Provider
	calls *[]string
}

func (r *recordingProvider) Name() string               { return r.inner.Name() }
func (r *recordingProvider) Capabilities() Capabilities { return r.inner.Capabilities() }
func (r *recordingProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	*r.calls = append(*r.calls, r.tag+".chat.before")
	resp, err := r.inner.Chat(ctx, req)
	*r.calls = append(*r.calls, r.tag+".chat.after")
	return resp, err
}
func (r *recordingProvider) Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error) {
	*r.calls = append(*r.calls, r.tag+".stream.before")
	ch, err := r.inner.Stream(ctx, req)
	*r.calls = append(*r.calls, r.tag+".stream.after")
	return ch, err
}
func (r *recordingProvider) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	*r.calls = append(*r.calls, r.tag+".embed.before")
	resp, err := r.inner.Embed(ctx, req)
	*r.calls = append(*r.calls, r.tag+".embed.after")
	return resp, err
}

// TestChain_AppliesInOrder proves that Chain(base, A, B) wraps as
// B(A(base)) — i.e. B is the outermost decorator.
func TestChain_AppliesInOrder(t *testing.T) {
	t.Parallel()
	calls := []string{}
	base := &stubProvider{name: "base", calls: &calls}
	wrapped := Chain(Provider(base),
		recordingDecorator("inner", &calls),
		recordingDecorator("outer", &calls),
	)
	_, _ = wrapped.Chat(context.Background(), ChatRequest{})

	want := []string{
		"outer.chat.before",
		"inner.chat.before",
		"base.chat",
		"inner.chat.after",
		"outer.chat.after",
	}
	if !slicesEqual(calls, want) {
		t.Fatalf("call order = %v, want %v", calls, want)
	}
}

// TestChain_NilDecoratorsSkipped covers the documented behaviour of
// silently skipping nil decorators (so build-time conditional cross-cuts
// do not require call-site refactoring).
func TestChain_NilDecoratorsSkipped(t *testing.T) {
	t.Parallel()
	calls := []string{}
	base := &stubProvider{name: "base", calls: &calls}
	wrapped := Chain(Provider(base),
		nil,
		recordingDecorator("only", &calls),
		nil,
	)
	_, _ = wrapped.Chat(context.Background(), ChatRequest{})
	want := []string{"only.chat.before", "base.chat", "only.chat.after"}
	if !slicesEqual(calls, want) {
		t.Fatalf("nil-skip order = %v, want %v", calls, want)
	}
}

// TestChain_NoDecoratorsReturnsBase — the empty case is identity.
func TestChain_NoDecoratorsReturnsBase(t *testing.T) {
	t.Parallel()
	calls := []string{}
	base := &stubProvider{name: "base", calls: &calls}
	wrapped := Chain(Provider(base))
	if wrapped.Name() != "base" {
		t.Fatalf("Chain with no decorators must return base, got Name=%q", wrapped.Name())
	}
}

func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
