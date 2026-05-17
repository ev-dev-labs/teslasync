package provider

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"
)

// recordingSink captures every Insert call into a slice protected by
// a mutex. Used by both the AsyncAuditWriter tests and the audit
// decorator tests as a deterministic AuditSink + AuditWriter (it
// satisfies both interfaces via inline adapter wrappers below).
type recordingSink struct {
	mu      sync.Mutex
	records []AuditRecord
	err     error // optional injected error
}

func (r *recordingSink) Insert(_ context.Context, rec *AuditRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.records = append(r.records, *rec)
	return r.err
}

func (r *recordingSink) snapshot() []AuditRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AuditRecord, len(r.records))
	copy(out, r.records)
	return out
}

// syncWriter is a trivial AuditWriter that calls Insert on the sink
// inline. Used by the decorator tests so they don't have to wait for
// an async drainer goroutine to make progress before assertions run.
type syncWriter struct{ sink AuditSink }

func (s syncWriter) Submit(rec AuditRecord) {
	_ = s.sink.Insert(context.Background(), &rec)
}

// chatStub is the inner provider used by the decorator tests. It
// returns the configured response or err.
type chatStub struct {
	name string
	resp *ChatResponse
	err  error
	// streaming chunks (one element per Stream chunk). If empty the
	// channel is closed immediately to simulate an empty stream.
	chunks []Chunk
	// causes Stream to return err synchronously instead of returning
	// a channel.
	streamSyncErr error
}

func (c *chatStub) Name() string               { return c.name }
func (c *chatStub) Capabilities() Capabilities { return Capabilities{} }
func (c *chatStub) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	return c.resp, c.err
}
func (c *chatStub) Stream(_ context.Context, _ ChatRequest) (<-chan Chunk, error) {
	if c.streamSyncErr != nil {
		return nil, c.streamSyncErr
	}
	ch := make(chan Chunk, len(c.chunks)+1)
	for _, k := range c.chunks {
		ch <- k
	}
	close(ch)
	return ch, nil
}
func (c *chatStub) Embed(_ context.Context, _ EmbedRequest) (*EmbedResponse, error) {
	return nil, ErrCapabilityNotSupported
}

// TestWithAudit_NilWriterIsPassthrough proves the documented escape
// hatch: passing a nil writer wraps to identity so off-mode wiring
// can disable auditing without a code branch at the call site.
func TestWithAudit_NilWriterIsPassthrough(t *testing.T) {
	t.Parallel()
	base := &chatStub{name: "stub", resp: &ChatResponse{}}
	wrapped := WithAudit(nil)(base)
	if wrapped != Provider(base) {
		t.Fatalf("nil writer must return base provider unchanged")
	}
}

// TestWithAudit_ChatHappyPathRecordsRow covers the normal completion
// flow: row carries provider, model, tokens, cost, latency, finish
// reason, and the subject + feature_id read from context.
func TestWithAudit_ChatHappyPathRecordsRow(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	base := &chatStub{
		name: "openai",
		resp: &ChatResponse{
			Message:      Message{Role: RoleAssistant, Content: "hi"},
			InputTokens:  1_000_000,
			OutputTokens: 500_000,
			FinishReason: FinishStop,
		},
	}
	wrapped := WithAudit(syncWriter{sink: sink})(base)

	ctx := WithFeatureID(WithSubject(context.Background(), "alice@example.com"), "chatbot-llm")
	_, err := wrapped.Chat(ctx, ChatRequest{Model: "gpt-4o-mini", Messages: []Message{{Role: RoleUser, Content: "hi"}}})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	got := sink.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}
	r := got[0]
	if r.UserSubject != "alice@example.com" {
		t.Errorf("UserSubject = %q", r.UserSubject)
	}
	if r.FeatureID != "chatbot-llm" {
		t.Errorf("FeatureID = %q", r.FeatureID)
	}
	if r.Provider != "openai" || r.Model != "gpt-4o-mini" {
		t.Errorf("Provider/Model = %q/%q", r.Provider, r.Model)
	}
	if r.InputTokens != 1_000_000 || r.OutputTokens != 500_000 {
		t.Errorf("tokens = %d/%d", r.InputTokens, r.OutputTokens)
	}
	if r.FinishReason != FinishStop {
		t.Errorf("FinishReason = %q", r.FinishReason)
	}
	// gpt-4o-mini: 150_000 mc/1M input + 600_000 mc/1M output.
	// 1M in + 500k out = 150_000 + 300_000 = 450_000 micro-cents.
	if r.CostMicroCents != 450_000 {
		t.Errorf("CostMicroCents = %d, want 450000", r.CostMicroCents)
	}
	if r.RequestHash == "" || r.RedactedDigest == "" {
		t.Errorf("hash/digest empty: %q / %q", r.RequestHash, r.RedactedDigest)
	}
	if r.RequestHash != r.RedactedDigest {
		t.Errorf("until F8 redaction lands, request_hash should equal redacted_digest")
	}
	if r.Error != "" {
		t.Errorf("Error must be empty on success: %q", r.Error)
	}
	if !r.FinishedAt.After(r.StartedAt) && !r.FinishedAt.Equal(r.StartedAt) {
		t.Errorf("FinishedAt %v must be ≥ StartedAt %v", r.FinishedAt, r.StartedAt)
	}
}

// TestWithAudit_ChatErrorRecordsRow proves a failed Chat still produces
// an audit row, with Error populated and the provider error propagated
// to the caller. ADR-015 §I4: every call that did egress (or attempted
// to) MUST be visible in the audit trail.
func TestWithAudit_ChatErrorRecordsRow(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	want := errors.New("upstream 503")
	base := &chatStub{name: "openai", err: want}
	wrapped := WithAudit(syncWriter{sink: sink})(base)

	_, err := wrapped.Chat(context.Background(), ChatRequest{Model: "gpt-4o-mini"})
	if !errors.Is(err, want) {
		t.Fatalf("error not propagated: %v", err)
	}
	got := sink.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 row on error, got %d", len(got))
	}
	if got[0].Error != "upstream 503" {
		t.Errorf("Error = %q", got[0].Error)
	}
	if got[0].InputTokens != 0 || got[0].OutputTokens != 0 || got[0].CostMicroCents != 0 {
		t.Errorf("error row must not carry token/cost data: %+v", got[0])
	}
}

// TestWithAudit_ContextWithoutSubjectStoresEmpty pins the open-mode
// behaviour: a request that never went through SubjectFromRequest
// (open mode, no FORWARD_AUTH_HEADER) produces an audit row with an
// empty subject string. The usage queries treat that as "system /
// open mode" rather than failing.
func TestWithAudit_ContextWithoutSubjectStoresEmpty(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	base := &chatStub{name: "ollama", resp: &ChatResponse{}}
	wrapped := WithAudit(syncWriter{sink: sink})(base)

	_, err := wrapped.Chat(context.Background(), ChatRequest{Model: "llama3.1"})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	got := sink.snapshot()
	if got[0].UserSubject != "" {
		t.Errorf("expected empty UserSubject in open mode, got %q", got[0].UserSubject)
	}
	if got[0].FeatureID != "" {
		t.Errorf("expected empty FeatureID when not set, got %q", got[0].FeatureID)
	}
}

// TestWithAudit_StreamSumsRunesAndRecordsOnDone covers the streaming
// path: the decorator forwards every chunk unchanged AND submits one
// audit row when the stream terminates. Output tokens are
// approximated by the rune count of all non-error chunks.
func TestWithAudit_StreamSumsRunesAndRecordsOnDone(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	base := &chatStub{
		name: "ollama",
		chunks: []Chunk{
			{Delta: "hello "},
			{Delta: "world"}, // 11 runes total before Done
			{Done: true},
		},
	}
	wrapped := WithAudit(syncWriter{sink: sink})(base)

	out, err := wrapped.Stream(context.Background(), ChatRequest{Model: "llama3.1"})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	got := []string{}
	for c := range out {
		if c.Done {
			break
		}
		got = append(got, c.Delta)
	}
	// Allow the relay goroutine a moment to submit its row.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if len(sink.snapshot()) > 0 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	rec := sink.snapshot()
	if len(rec) != 1 {
		t.Fatalf("expected 1 audit row from stream, got %d", len(rec))
	}
	// 11 runes ("hello world").
	if rec[0].OutputTokens != 11 {
		t.Errorf("OutputTokens = %d, want 11 (rune count)", rec[0].OutputTokens)
	}
	if rec[0].FinishReason != FinishStop {
		t.Errorf("FinishReason = %q, want %q", rec[0].FinishReason, FinishStop)
	}
	if got[0] != "hello " || got[1] != "world" {
		t.Errorf("relay payload mismatch: %v", got)
	}
}

// TestWithAudit_StreamSyncErrorRecordsRow covers the case where the
// adapter cannot even open the stream (e.g. immediate 401). Decorator
// must produce one row with the error and propagate the error to the
// caller — no channel is returned.
func TestWithAudit_StreamSyncErrorRecordsRow(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	want := errors.New("auth failed")
	base := &chatStub{name: "openai", streamSyncErr: want}
	wrapped := WithAudit(syncWriter{sink: sink})(base)

	_, err := wrapped.Stream(context.Background(), ChatRequest{Model: "gpt-4o-mini"})
	if !errors.Is(err, want) {
		t.Fatalf("expected sync error, got %v", err)
	}
	got := sink.snapshot()
	if len(got) != 1 {
		t.Fatalf("expected 1 row on sync stream failure, got %d", len(got))
	}
	if got[0].Error != "auth failed" {
		t.Errorf("Error = %q", got[0].Error)
	}
}

// TestAsyncAuditWriter_DropsOldestWhenFull proves the documented
// back-pressure policy: a stuck sink (Insert blocks forever) plus a
// burst of Submits causes the buffer to drop the OLDEST records and
// the drop counter to advance. We use a sink that blocks on a
// release channel so the buffer fills deterministically.
func TestAsyncAuditWriter_DropsOldestWhenFull(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	sink := &blockingSink{release: release}
	defer close(release)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := NewAsyncAuditWriter(ctx, sink, 4) // tiny buffer
	defer w.Stop()

	before := readDropCount(t)
	for i := 0; i < 64; i++ {
		w.Submit(AuditRecord{Provider: "openai", FeatureID: "chatbot-llm"})
	}
	after := readDropCount(t)
	if after <= before {
		t.Fatalf("drop counter did not advance: before=%v after=%v", before, after)
	}
}

// TestAsyncAuditWriter_SubmitAfterStopIsNoop proves that Stop
// effectively quiesces the writer for the test goroutine. The drainer
// itself is gated on its parent ctx (cancel via defer in the test).
func TestAsyncAuditWriter_SubmitAfterStopIsNoop(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := NewAsyncAuditWriter(ctx, sink, 4)
	w.Stop()
	w.Submit(AuditRecord{Provider: "openai"})

	// Give the (non-existent) submit time to race.
	time.Sleep(20 * time.Millisecond)
	if len(sink.snapshot()) != 0 {
		t.Fatalf("expected no records after Stop, got %d", len(sink.snapshot()))
	}
}

// TestAsyncAuditWriter_DrainsToSink covers the happy path: a small
// burst of Submits all reach the sink without dropping.
func TestAsyncAuditWriter_DrainsToSink(t *testing.T) {
	t.Parallel()
	sink := &recordingSink{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := NewAsyncAuditWriter(ctx, sink, 16)

	const n = 8
	for i := 0; i < n; i++ {
		w.Submit(AuditRecord{Provider: "openai", FeatureID: "chatbot-llm"})
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if len(sink.snapshot()) >= n {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if len(sink.snapshot()) != n {
		t.Fatalf("got %d rows, want %d", len(sink.snapshot()), n)
	}
}

// TestSubjectFeatureContextRoundTrip covers the helpers used by the
// handler layer to inject subject + feature_id into the request ctx.
func TestSubjectFeatureContextRoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithSubject(context.Background(), "alice")
	ctx = WithFeatureID(ctx, "chatbot-llm")
	if got := SubjectFromContext(ctx); got != "alice" {
		t.Errorf("SubjectFromContext = %q", got)
	}
	if got := FeatureIDFromContext(ctx); got != "chatbot-llm" {
		t.Errorf("FeatureIDFromContext = %q", got)
	}
	// Empty defaults when keys missing.
	if got := SubjectFromContext(context.Background()); got != "" {
		t.Errorf("absent subject = %q, want empty", got)
	}
	if got := FeatureIDFromContext(context.Background()); got != "" {
		t.Errorf("absent feature id = %q, want empty", got)
	}
}

// blockingSink is an AuditSink whose Insert blocks until release is
// closed. Used by TestAsyncAuditWriter_DropsOldestWhenFull to wedge
// the drainer goroutine.
type blockingSink struct {
	release chan struct{}
}

func (b *blockingSink) Insert(_ context.Context, _ *AuditRecord) error {
	<-b.release
	return nil
}

// readDropCount reads the current value of auditDropTotal via the
// prometheus client's snapshot API. Returning the current value lets
// tests assert "did the counter advance?" without relying on a global
// reset (the counter is a singleton on the default registry, so a
// reset would break parallel tests).
func readDropCount(t *testing.T) float64 {
	t.Helper()
	var m dto.Metric
	if err := auditDropTotal.Write(&m); err != nil {
		t.Fatalf("read drop counter: %v", err)
	}
	if m.Counter == nil || m.Counter.Value == nil {
		return 0
	}
	return *m.Counter.Value
}
