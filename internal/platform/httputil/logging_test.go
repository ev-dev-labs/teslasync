package httputil

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func TestLoggedTransport_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer srv.Close()

	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	transport := &LoggedTransport{
		Base: http.DefaultTransport,
		Name: "test-api",
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/test", nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	output := buf.String()
	if !contains(output, "test-api") {
		t.Error("expected adapter name 'test-api' in log output")
	}
	if !contains(output, "outbound request") {
		t.Error("expected 'outbound request' in log output")
	}
	if !contains(output, "outbound response") {
		t.Error("expected 'outbound response' in log output")
	}
}

func TestLoggedTransport_Error(t *testing.T) {
	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	transport := &LoggedTransport{
		Base: http.DefaultTransport,
		Name: "fail-api",
	}

	// Request to a non-existent server
	req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:1/nope", nil)
	_, err := transport.RoundTrip(req)
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}

	output := buf.String()
	if !contains(output, "error") {
		t.Error("expected error-level log for failed request")
	}
	if !contains(output, "fail-api") {
		t.Error("expected adapter name in error log")
	}
}

func TestLoggedTransport_SanitizesAPIKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	transport := &LoggedTransport{
		Base: http.DefaultTransport,
		Name: "secret-api",
	}

	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/data?api_key=SUPERSECRET&other=visible", srv.URL), nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	output := buf.String()
	if contains(output, "SUPERSECRET") {
		t.Error("API key should be sanitized from logs")
	}
	if !contains(output, "REDACTED") {
		t.Error("expected 'REDACTED' placeholder for sanitized key")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && bytes.Contains([]byte(s), []byte(substr))
}
