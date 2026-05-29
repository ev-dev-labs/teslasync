package apitest

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// DoRequest performs a JSON request against handler and returns the recorder.
// It deliberately omits header overrides so specialized tests build requests
// explicitly.
func DoRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// AssertStatus fails the test if the recorded response's status code
// does not match expected. The recorded body is included in the error
// message to make CI failures self-diagnosing without a re-run.
func AssertStatus(t *testing.T, rec *httptest.ResponseRecorder, expected int) {
	t.Helper()
	if rec.Code != expected {
		t.Errorf("expected status %d, got %d. Body: %s", expected, rec.Code, rec.Body.String())
	}
}

// AssertJSON decodes a flat JSON object response. Use typed decoding inline for
// arrays, scalars, or struct-shaped responses.
func AssertJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response is not valid JSON: %v. Body: %s", err, rec.Body.String())
	}
	return result
}

// AssertContentType uses substring matching so "application/json" accepts the
// charset suffix; byte-exact tests should assert on the header directly.
func AssertContentType(t *testing.T, rec *httptest.ResponseRecorder, expected string) {
	t.Helper()
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, expected) {
		t.Errorf("expected Content-Type containing %q, got %q", expected, ct)
	}
}
