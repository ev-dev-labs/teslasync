package adminlogstream

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/platform"
)

// drainSSEEvents reads SSE events from the response body until either
// stop closes, the body EOFs, or `max` events arrive. The reader runs
// in a goroutine and pushes events onto a channel so the test goroutine
// owns the resulting slice exclusively (no shared-slice race).
func drainSSEEvents(t *testing.T, body interface {
	Read(p []byte) (int, error)
}, max int, stop <-chan struct{}) []sseEvent {
	t.Helper()
	out := make(chan sseEvent, max+8)
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(body)
		scanner.Buffer(make([]byte, 64*1024), 256*1024)
		var cur sseEvent
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				cur.event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				cur.data += strings.TrimPrefix(line, "data: ")
			case line == "":
				if cur.event != "" || cur.data != "" {
					out <- cur
					cur = sseEvent{}
				}
			}
		}
	}()

	events := []sseEvent{}
	deadline := time.After(3 * time.Second)
	for len(events) < max {
		select {
		case e := <-out:
			events = append(events, e)
		case <-stop:
			return events
		case <-done:
			// Drain any pending events.
			for {
				select {
				case e := <-out:
					events = append(events, e)
				default:
					return events
				}
			}
		case <-deadline:
			return events
		}
	}
	return events
}

type sseEvent struct {
	event string
	data  string
}

func TestAdminLogStreamHandler_NilHandlerReturns503(t *testing.T) {
	var h *AdminLogStreamHandler
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, AdminLogStreamPath, nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestAdminLogStreamHandler_NonGETReturns405(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, AdminLogStreamPath, nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("Allow header = %q, want GET", got)
	}
}

func TestAdminLogStreamHandler_BadLevelReturns400(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, AdminLogStreamPath+"?level=bogus", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAdminLogStreamHandler_BadGrepReturns400(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)
	rec := httptest.NewRecorder()
	// Unbalanced parenthesis is invalid Go regexp.
	req := httptest.NewRequest(http.MethodGet, AdminLogStreamPath+"?grep=%28unclosed", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAdminLogStreamHandler_OversizedGrepReturns400(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)
	rec := httptest.NewRecorder()
	long := strings.Repeat("a", adminLogStreamMaxGrepLen+1)
	req := httptest.NewRequest(http.MethodGet, AdminLogStreamPath+"?grep="+long, nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAdminLogStreamHandler_StreamsConnectedThenLogEvents(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)

	server := httptest.NewServer(http.HandlerFunc(h.ServeHTTP))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"?level=debug", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	// Push a couple of log events. The handler subscribes before
	// returning the connected envelope, and the registry copies the
	// payload so we can race-free fan it out from this goroutine.
	go func() {
		// Wait one tick for the subscribe to complete.
		time.Sleep(150 * time.Millisecond)
		reg.WriteLevel(zerolog.InfoLevel, []byte(`{"level":"info","msg":"first"}`))
		reg.WriteLevel(zerolog.WarnLevel, []byte(`{"level":"warn","msg":"second"}`))
	}()

	stop := make(chan struct{})
	defer close(stop)
	events := drainSSEEvents(t, resp.Body, 3, stop)
	if len(events) < 3 {
		t.Fatalf("got %d events, want at least 3 (connected + 2 logs): %+v", len(events), events)
	}
	if events[0].event != "connected" {
		t.Fatalf("first event = %q, want connected", events[0].event)
	}
	if events[1].event != "log" || !strings.Contains(events[1].data, `"first"`) {
		t.Fatalf("event[1] = %+v, want log/first", events[1])
	}
	if events[2].event != "log" || !strings.Contains(events[2].data, `"second"`) {
		t.Fatalf("event[2] = %+v, want log/second", events[2])
	}
}

func TestAdminLogStreamHandler_LevelFilterDropsBelowMin(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)

	server := httptest.NewServer(http.HandlerFunc(h.ServeHTTP))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"?level=warn", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()

	go func() {
		time.Sleep(150 * time.Millisecond)
		reg.WriteLevel(zerolog.InfoLevel, []byte(`{"msg":"info-skipped"}`))
		reg.WriteLevel(zerolog.WarnLevel, []byte(`{"msg":"warn-kept"}`))
	}()

	stop := make(chan struct{})
	defer close(stop)
	events := drainSSEEvents(t, resp.Body, 2, stop)
	if len(events) < 2 {
		t.Fatalf("expected at least connected + warn event, got %d: %+v", len(events), events)
	}
	for _, e := range events {
		if strings.Contains(e.data, "info-skipped") {
			t.Fatalf("info-level event leaked through warn filter: %+v", e)
		}
	}
}

func TestAdminLogStreamHandler_GrepMatchesRegex(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)
	server := httptest.NewServer(http.HandlerFunc(h.ServeHTTP))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"?level=debug&grep=mqtt", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()

	go func() {
		time.Sleep(150 * time.Millisecond)
		reg.WriteLevel(zerolog.InfoLevel, []byte(`{"component":"http"}`))
		reg.WriteLevel(zerolog.InfoLevel, []byte(`{"component":"mqtt"}`))
	}()

	stop := make(chan struct{})
	defer close(stop)
	events := drainSSEEvents(t, resp.Body, 2, stop)
	for _, e := range events[1:] {
		if !strings.Contains(e.data, "mqtt") {
			t.Fatalf("event leaked past grep filter: %+v", e)
		}
	}
}

func TestAdminLogStreamHandler_DisconnectClosesSubscriber(t *testing.T) {
	reg := platform.NewLogSubscriberRegistry()
	h := NewAdminLogStreamHandler(reg)
	server := httptest.NewServer(http.HandlerFunc(h.ServeHTTP))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}

	// Wait for subscribe.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if reg.SubscriberCount() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if reg.SubscriberCount() != 1 {
		t.Fatalf("SubscriberCount = %d, want 1 after connect", reg.SubscriberCount())
	}

	cancel()
	resp.Body.Close()

	// Wait for the handler's defer to run.
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if reg.SubscriberCount() == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("SubscriberCount = %d after disconnect, want 0", reg.SubscriberCount())
}

func TestAdminLogStreamHandler_DropTickEmitsAfterBufferOverflow(t *testing.T) {
	reg := platform.NewLogSubscriberRegistryWithCapacity(1)
	h := NewAdminLogStreamHandler(reg)
	server := httptest.NewServer(http.HandlerFunc(h.ServeHTTP))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"?level=debug", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()

	// Wait for subscriber to register, then flood the registry past
	// its 1-slot buffer. The handler is in a select with a
	// per-second drop ticker so it will surface a `drop` event
	// within ~1.2s.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if reg.SubscriberCount() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	for i := 0; i < 100; i++ {
		reg.WriteLevel(zerolog.InfoLevel, []byte(`{"i":1}`))
	}

	stop := make(chan struct{})
	defer close(stop)
	events := drainSSEEvents(t, resp.Body, 6, stop)
	sawDrop := false
	for _, e := range events {
		if e.event == "drop" {
			sawDrop = true
			break
		}
	}
	if !sawDrop {
		t.Fatalf("no drop event emitted in %d events: %+v", len(events), events)
	}
}

func TestParseLogStreamLevel(t *testing.T) {
	cases := []struct {
		in        string
		want      zerolog.Level
		wantLabel string
		wantErr   bool
	}{
		{"", zerolog.InfoLevel, "info", false},
		{"info", zerolog.InfoLevel, "info", false},
		{"INFO", zerolog.InfoLevel, "info", false},
		{"debug", zerolog.DebugLevel, "debug", false},
		{"warn", zerolog.WarnLevel, "warn", false},
		{"warning", zerolog.WarnLevel, "warn", false},
		{"error", zerolog.ErrorLevel, "error", false},
		{"err", zerolog.ErrorLevel, "error", false},
		{"fatal", zerolog.FatalLevel, "fatal", false},
		{"panic", zerolog.PanicLevel, "panic", false},
		{"trace", zerolog.NoLevel, "", true},
		{"unknown", zerolog.NoLevel, "", true},
	}
	for _, tc := range cases {
		got, label, err := parseLogStreamLevel(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("parseLogStreamLevel(%q) err = nil, want error", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseLogStreamLevel(%q) err = %v, want nil", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseLogStreamLevel(%q) level = %v, want %v", tc.in, got, tc.want)
		}
		if label != tc.wantLabel {
			t.Errorf("parseLogStreamLevel(%q) label = %q, want %q", tc.in, label, tc.wantLabel)
		}
	}
}

func TestWriteSSERaw_StripsTrailingNewlinesAndPreservesBody(t *testing.T) {
	rec := httptest.NewRecorder()
	if !writeSSERaw(rec, "log", []byte(`{"a":1}`+"\n")) {
		t.Fatalf("writeSSERaw returned false")
	}
	got := rec.Body.String()
	want := "event: log\ndata: {\"a\":1}\n\n"
	if got != want {
		t.Fatalf("writeSSERaw output mismatch:\ngot:  %q\nwant: %q", got, want)
	}
}

func TestWriteSSERaw_HandlesEmbeddedNewline(t *testing.T) {
	rec := httptest.NewRecorder()
	if !writeSSERaw(rec, "log", []byte("line1\nline2")) {
		t.Fatalf("writeSSERaw returned false")
	}
	got := rec.Body.String()
	want := "event: log\ndata: line1\ndata: line2\n\n"
	if got != want {
		t.Fatalf("writeSSERaw embedded-newline output mismatch:\ngot:  %q\nwant: %q", got, want)
	}
}
