package tesla

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// installRecorder swaps the global TracerProvider with one that captures
// every span into the returned recorder. Caller MUST defer cleanup() so
// tests don't leak the recorder into siblings.
func installRecorder(t *testing.T) (*tracetest.SpanRecorder, func()) {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	return rec, func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prev)
	}
}

// findSpanByName returns the first recorded span whose name starts with
// prefix. Returns nil if no match.
func findSpanByName(rec *tracetest.SpanRecorder, prefix string) sdktrace.ReadOnlySpan {
	for _, s := range rec.Ended() {
		if strings.HasPrefix(s.Name(), prefix) {
			return s
		}
	}
	return nil
}

// TestDoRequest_EmitsSpan exercises the doRequest chokepoint via a public
// wrapper (GetUserRegion). It verifies that a parent span tesla.GetUserRegion
// is opened, a child tesla.HTTP span carries http.* attributes, and the
// http.response.status_code attribute reflects the upstream response.
func TestDoRequest_EmitsSpan(t *testing.T) {
	rec, cleanup := installRecorder(t)
	defer cleanup()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"region":"na"}`))
	}))
	defer srv.Close()

	c := NewClient(config.TeslaConfig{
		BaseURL: srv.URL,
		AuthURL: srv.URL,
		Timeout: 5 * time.Second,
	})
	c.SetTokens("test-token", "refresh", time.Now().Add(time.Hour))

	body, status, err := c.GetUserRegion(context.Background())
	if err != nil {
		t.Fatalf("GetUserRegion: unexpected error: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if string(body) == "" {
		t.Fatalf("expected response body, got empty")
	}

	parent := findSpanByName(rec, "tesla.GetUserRegion")
	if parent == nil {
		t.Fatal("expected tesla.GetUserRegion span, none recorded")
	}
	child := findSpanByName(rec, "tesla.HTTP GET ")
	if child == nil {
		t.Fatal("expected tesla.HTTP GET ... child span, none recorded")
	}

	// Verify attributes on the HTTP chokepoint span.
	gotMethod := false
	gotPath := false
	gotStatus := false
	for _, attr := range child.Attributes() {
		switch string(attr.Key) {
		case "http.request.method":
			if attr.Value.AsString() == http.MethodGet {
				gotMethod = true
			}
		case "tesla.api.path":
			if attr.Value.AsString() == "/api/1/users/region" {
				gotPath = true
			}
		case "http.response.status_code":
			if attr.Value.AsInt64() == int64(http.StatusOK) {
				gotStatus = true
			}
		}
	}
	if !gotMethod {
		t.Errorf("missing http.request.method=GET on chokepoint span; attrs=%v", child.Attributes())
	}
	if !gotPath {
		t.Errorf("missing tesla.api.path on chokepoint span; attrs=%v", child.Attributes())
	}
	if !gotStatus {
		t.Errorf("missing http.response.status_code on chokepoint span; attrs=%v", child.Attributes())
	}

	// Parent → child relationship.
	if parent.SpanContext().TraceID() != child.SpanContext().TraceID() {
		t.Errorf("parent and child spans have different trace IDs (parent=%s, child=%s)",
			parent.SpanContext().TraceID(), child.SpanContext().TraceID())
	}
}

// TestDoRequest_RecordsErrorOn5xx asserts that a 5xx response from the
// upstream Tesla API surfaces on the chokepoint span as RecordError +
// Status=Error. This is the SLO-relevant path operators search for in
// Tempo when triaging Fleet API outages.
func TestDoRequest_RecordsErrorOn5xx(t *testing.T) {
	rec, cleanup := installRecorder(t)
	defer cleanup()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(config.TeslaConfig{
		BaseURL: srv.URL,
		AuthURL: srv.URL,
		Timeout: 5 * time.Second,
	})
	c.SetTokens("test-token", "refresh", time.Now().Add(time.Hour))

	_, status, err := c.GetUserRegion(context.Background())
	if err == nil {
		t.Fatal("expected error on 500 response, got nil")
	}
	if status != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", status)
	}

	child := findSpanByName(rec, "tesla.HTTP GET ")
	if child == nil {
		t.Fatal("expected tesla.HTTP GET ... span, none recorded")
	}
	if got := child.Status().Code.String(); got != "Error" {
		t.Errorf("span status = %q, want Error", got)
	}
	if len(child.Events()) == 0 {
		t.Errorf("expected at least one span event (RecordError), got none")
	}
}
