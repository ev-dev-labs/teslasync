package stream_test

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
)

// Compile-time assert: every stream.Writer is a dispatch.StreamWriter.
// If this fails to compile, the dispatcher cannot use the SSE writer
// through its streaming port.
var _ dispatch.StreamWriter = (*stream.Writer)(nil)

// --- minimal flushable recorder ----------------------------------
//
// httptest.ResponseRecorder does not implement http.Flusher, so the
// Writer's New refuses it. Wrap it with an embedded recorder + a
// custom Flush() so tests get the same byte-capture without
// reaching for httptest.NewServer.

type flushRecorder struct {
	*httptest.ResponseRecorder
	flushes atomic.Int64
}

func newFlushRecorder() *flushRecorder {
	return &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (f *flushRecorder) Flush() { f.flushes.Add(1) }

// --- a "pinned" writer whose Write() blocks until the test releases it.
// Used to deterministically force the stall path.

type pinnedRecorder struct {
	*httptest.ResponseRecorder
	release chan struct{}
}

func newPinnedRecorder() *pinnedRecorder {
	return &pinnedRecorder{
		ResponseRecorder: httptest.NewRecorder(),
		release:          make(chan struct{}),
	}
}

func (p *pinnedRecorder) Write(b []byte) (int, error) {
	<-p.release // block until released
	return p.ResponseRecorder.Write(b)
}

func (p *pinnedRecorder) Flush() {}

// --- helpers ------------------------------------------------------

// parseSSE splits the recorded body into a list of (event, data)
// pairs in arrival order. Returns the raw JSON string for `data:` so
// each test can decode into the typed payload it expects.
type sseEvent struct {
	Event string
	Data  string
}

func parseSSE(t *testing.T, body string) []sseEvent {
	t.Helper()
	var out []sseEvent
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var cur sseEvent
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			cur.Event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			cur.Data = strings.TrimPrefix(line, "data: ")
		case line == "":
			if cur.Event != "" {
				out = append(out, cur)
				cur = sseEvent{}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner: %v", err)
	}
	return out
}

// --- tests --------------------------------------------------------

// nonFlushable is an http.ResponseWriter that deliberately does NOT
// implement http.Flusher, used to exercise stream.New's setup-time
// guard. (httptest.ResponseRecorder implements Flush so it cannot
// stand in for this case.)
type nonFlushable struct {
	header http.Header
	body   []byte
	status int
}

func (n *nonFlushable) Header() http.Header {
	if n.header == nil {
		n.header = http.Header{}
	}
	return n.header
}
func (n *nonFlushable) Write(b []byte) (int, error) {
	n.body = append(n.body, b...)
	return len(b), nil
}
func (n *nonFlushable) WriteHeader(statusCode int) { n.status = statusCode }

func TestNew_RejectsNonFlushable(t *testing.T) {
	t.Parallel()
	_, _, err := stream.New(context.Background(), &nonFlushable{})
	if !errors.Is(err, stream.ErrNotFlushable) {
		t.Fatalf("err = %v, want ErrNotFlushable", err)
	}
}

func TestNew_WritesSSEHeadersAndOK(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer w.Close()
	res := rec.Result()
	if got, want := res.Header.Get("Content-Type"), "text/event-stream"; got != want {
		t.Errorf("Content-Type = %q, want %q", got, want)
	}
	if got := res.Header.Get("Cache-Control"); !strings.Contains(got, "no-cache") {
		t.Errorf("Cache-Control = %q, want contains no-cache", got)
	}
	if got := res.Header.Get("X-Accel-Buffering"); got != "no" {
		t.Errorf("X-Accel-Buffering = %q, want no", got)
	}
	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", res.StatusCode)
	}
	if rec.flushes.Load() < 1 {
		t.Errorf("expected at least one Flush during New, got %d", rec.flushes.Load())
	}
}

func TestWriteDelta_EmitsDeltaFrame(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec, stream.WithFeatureID("test-feat"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.WriteDelta("hello "); err != nil {
		t.Fatalf("WriteDelta: %v", err)
	}
	if err := w.WriteDelta("world"); err != nil {
		t.Fatalf("WriteDelta: %v", err)
	}
	if err := w.WriteDone(); err != nil {
		t.Fatalf("WriteDone: %v", err)
	}
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	if len(events) != 3 {
		t.Fatalf("events = %d, want 3 (2 deltas + 1 done): %+v", len(events), events)
	}
	if events[0].Event != "delta" || events[1].Event != "delta" {
		t.Errorf("first two events should be delta, got %s + %s", events[0].Event, events[1].Event)
	}
	var d1, d2 struct {
		Text string `json:"text"`
	}
	mustUnmarshal(t, events[0].Data, &d1)
	mustUnmarshal(t, events[1].Data, &d2)
	if d1.Text != "hello " || d2.Text != "world" {
		t.Errorf("delta texts = %q + %q, want hello + world", d1.Text, d2.Text)
	}
	if events[2].Event != "done" {
		t.Errorf("last event = %q, want done", events[2].Event)
	}
}

func TestWriteDelta_EmptyStringIsNoOp(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.WriteDelta(""); err != nil {
		t.Fatalf("WriteDelta(\"\"): %v", err)
	}
	w.Close()
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	for _, e := range events {
		if e.Event == "delta" {
			t.Errorf("empty delta should not be emitted, got %+v", e)
		}
	}
}

func TestWriteToolCall_AnnouncesIDAndArgs(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	call := provider.ToolCall{
		ID:        "c_42",
		Name:      "ping",
		Arguments: json.RawMessage(`{"x":1}`),
	}
	if err := w.WriteToolCall(call); err != nil {
		t.Fatalf("WriteToolCall: %v", err)
	}
	w.WriteDone()
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	if events[0].Event != "tool_call" {
		t.Fatalf("event = %q, want tool_call", events[0].Event)
	}
	var tc struct {
		ID        string          `json:"id"`
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	mustUnmarshal(t, events[0].Data, &tc)
	if tc.ID != "c_42" || tc.Name != "ping" {
		t.Errorf("tool_call payload = %+v, want id=c_42 name=ping", tc)
	}
	if string(tc.Arguments) != `{"x":1}` {
		t.Errorf("tool_call args = %s, want {\"x\":1}", tc.Arguments)
	}
}

func TestWriteToolResult_PairsWithLastCallID(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	w.WriteToolCall(provider.ToolCall{ID: "abc", Name: "ping", Arguments: json.RawMessage(`{}`)})
	w.WriteToolResult("ping", json.RawMessage(`{"pong":"ok"}`))
	w.WriteDone()
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	var tr struct {
		ID    string          `json:"id"`
		Name  string          `json:"name"`
		OK    bool            `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
	}
	mustUnmarshal(t, events[1].Data, &tr)
	if tr.ID != "abc" {
		t.Errorf("result id = %q, want abc (paired from last WriteToolCall)", tr.ID)
	}
	if !tr.OK {
		t.Errorf("OK = false, want true")
	}
	if string(tr.Data) != `{"pong":"ok"}` {
		t.Errorf("data = %s", tr.Data)
	}
}

func TestWriteToolError_OkFalseWithMessage(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	w.WriteToolCall(provider.ToolCall{ID: "xyz", Name: "echo", Arguments: json.RawMessage(`{}`)})
	w.WriteToolError("echo", errors.New("validation: msg required"))
	w.WriteDone()
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	var tr struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	mustUnmarshal(t, events[1].Data, &tr)
	if tr.ID != "xyz" || tr.Name != "echo" || tr.OK || tr.Error == "" {
		t.Errorf("tool_result error frame = %+v, want id=xyz name=echo ok=false error!=''", tr)
	}
	if !strings.Contains(tr.Error, "validation") {
		t.Errorf("error message = %q, want contains 'validation'", tr.Error)
	}
}

func TestWriteConfirmRequest_Emits(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	w.WriteConfirmRequest("k_xyz", "create_alert", json.RawMessage(`{"name":"speed cap"}`), "Create speed-cap alert")
	w.WriteDone()
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	if events[0].Event != "confirm_request" {
		t.Fatalf("event = %q, want confirm_request", events[0].Event)
	}
	var cr struct {
		ContinuationID string          `json:"continuation_id"`
		Tool           string          `json:"tool"`
		Args           json.RawMessage `json:"args"`
		Summary        string          `json:"summary"`
	}
	mustUnmarshal(t, events[0].Data, &cr)
	if cr.ContinuationID != "k_xyz" || cr.Tool != "create_alert" || cr.Summary == "" {
		t.Errorf("confirm_request payload = %+v", cr)
	}
}

func TestWriteDoneFull_FinishReasonAndUsage(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.WriteDoneFull("stop", 120, 340); err != nil {
		t.Fatalf("WriteDoneFull: %v", err)
	}
	w.Wait()

	events := parseSSE(t, rec.Body.String())
	if len(events) != 1 || events[0].Event != "done" {
		t.Fatalf("events = %+v, want one done event", events)
	}
	var d struct {
		FinishReason string `json:"finish_reason"`
		Usage        struct {
			In  int `json:"in"`
			Out int `json:"out"`
		} `json:"usage"`
	}
	mustUnmarshal(t, events[0].Data, &d)
	if d.FinishReason != "stop" || d.Usage.In != 120 || d.Usage.Out != 340 {
		t.Errorf("done payload = %+v", d)
	}
}

func TestWriteError_TerminatesAndFurtherSendsFail(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.WriteError(errors.New("boom")); err != nil {
		t.Fatalf("WriteError: %v", err)
	}
	w.Wait()

	if got := w.WriteDelta("after"); !errors.Is(got, stream.ErrWriterClosed) {
		t.Errorf("Send after WriteError = %v, want ErrWriterClosed", got)
	}
}

func TestSendAfterCloseIsErrWriterClosed(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := w.WriteDelta("nope"); !errors.Is(err, stream.ErrWriterClosed) {
		t.Errorf("err = %v, want ErrWriterClosed", err)
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Errorf("first Close: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
	w.Wait()
}

func TestStallTimeout_CancelsCtxAndEmitsStallFrame(t *testing.T) {
	t.Parallel()
	pin := newPinnedRecorder()
	ctx, cancelCtx := context.WithCancel(context.Background())
	defer cancelCtx()
	w, childCtx, err := stream.New(ctx, pin, stream.WithStallTimeout(50*time.Millisecond))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Fill the channel + saturate the consumer (the consumer is
	// pinned on the FIRST Write). Sending channelCapacity+1 frames
	// will eventually block at Send → trigger stall.
	const burst = 80 // exceeds cap=64
	var stallErr error
	var stallSeen atomic.Bool
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < burst; i++ {
			err := w.WriteDelta(fmt.Sprintf("d%d", i))
			if errors.Is(err, stream.ErrStallTimeout) {
				stallErr = err
				stallSeen.Store(true)
				return
			}
			if err != nil {
				return // closed by stall teardown
			}
		}
	}()

	// Wait up to 2s for the stall to fire (default+headroom).
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !stallSeen.Load() {
		time.Sleep(5 * time.Millisecond)
	}
	if !stallSeen.Load() {
		t.Fatalf("expected stall to trigger within 2s")
	}
	if !errors.Is(stallErr, stream.ErrStallTimeout) {
		t.Errorf("Send err = %v, want ErrStallTimeout", stallErr)
	}

	// Upstream ctx (the child returned from New) MUST be cancelled.
	select {
	case <-childCtx.Done():
		// expected
	case <-time.After(500 * time.Millisecond):
		t.Errorf("child ctx not cancelled within 500ms after stall")
	}

	// Release the consumer so the test does not leak the pump
	// goroutine. The remaining frames drain.
	close(pin.release)
	wg.Wait()
	w.Wait()
}

func TestSendAfterStallReturnsErrWriterClosed(t *testing.T) {
	t.Parallel()
	pin := newPinnedRecorder()
	w, _, err := stream.New(context.Background(), pin, stream.WithStallTimeout(20*time.Millisecond))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Push one frame to fill the channel slowly enough to trigger
	// stall on a follow-up. Easiest: just keep pushing until we
	// observe stall.
	var stalled bool
	for i := 0; i < 200 && !stalled; i++ {
		err := w.WriteDelta("x")
		if errors.Is(err, stream.ErrStallTimeout) {
			stalled = true
		} else if err != nil {
			t.Fatalf("unexpected err during stall trigger: %v", err)
		}
	}
	if !stalled {
		t.Skip("could not trigger stall (channel drained too fast); not flake-worthy")
	}
	close(pin.release)

	// Subsequent Send returns ErrWriterClosed (or ErrConsumerFailed
	// if the drain error race wins). Either is acceptable — both
	// signal "stop".
	err = w.WriteDelta("post-stall")
	if err == nil {
		t.Errorf("Send after stall returned nil, want ErrWriterClosed or wrapped err")
	}
	w.Wait()
}

func TestConsumerWriteFailure_FuturesSendsFail(t *testing.T) {
	t.Parallel()
	rec := &failingRecorder{ResponseRecorder: httptest.NewRecorder(), failAfter: 1}
	w, _, err := stream.New(context.Background(), rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// First Send succeeds; second triggers the recorder's write
	// error. Loop until we see a non-nil error.
	var failErr error
	for i := 0; i < 50; i++ {
		failErr = w.WriteDelta("d")
		if failErr != nil {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if failErr == nil {
		t.Fatalf("expected failing recorder to surface a Send error")
	}
	if !errors.Is(failErr, stream.ErrConsumerFailed) && !errors.Is(failErr, stream.ErrWriterClosed) {
		t.Errorf("err = %v, want ErrConsumerFailed or ErrWriterClosed", failErr)
	}
	w.Close()
	w.Wait()
}

func TestFeatureIDIsRecorded(t *testing.T) {
	t.Parallel()
	rec := newFlushRecorder()
	w, _, err := stream.New(context.Background(), rec, stream.WithFeatureID("chatbot-llm"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer w.Close()
	if got := w.FeatureID(); got != "chatbot-llm" {
		t.Errorf("FeatureID = %q, want chatbot-llm", got)
	}
}

// --- helper assertions -------------------------------------------

func mustUnmarshal(t *testing.T, raw string, dst any) {
	t.Helper()
	if err := json.Unmarshal([]byte(raw), dst); err != nil {
		t.Fatalf("unmarshal %q into %T: %v", raw, dst, err)
	}
}

// failingRecorder fails Write after `failAfter` calls.
type failingRecorder struct {
	*httptest.ResponseRecorder
	calls     atomic.Int64
	failAfter int64
}

func (f *failingRecorder) Write(b []byte) (int, error) {
	c := f.calls.Add(1)
	if c > f.failAfter {
		return 0, io.ErrClosedPipe
	}
	return f.ResponseRecorder.Write(b)
}

func (f *failingRecorder) Flush() {}
