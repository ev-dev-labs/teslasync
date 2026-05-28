package apitest

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// DoRequest performs an HTTP request against the given handler and
// returns the response recorder. If body is non-empty it is sent as
// the request body with Content-Type "application/json".
//
// This is the standard "fire one request at a chi/http.ServeMux router
// fixture" helper used by acceptance + handler tests across
// internal/api. It deliberately stays narrow:
//   - JSON-only Content-Type (every internal/api endpoint takes JSON)
//   - String body (callers do their own json.Marshal — keeps the call
//     site explicit about what JSON shape is being sent)
//   - No header overrides (tests that need custom headers build the
//     httptest.NewRequest themselves)
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

// AssertJSON decodes the recorded response body as a generic JSON
// object and returns it. Tests then assert against the resulting
// map[string]interface{} (e.g. body["status"] == "ok"). Decoding
// failures are fatal because they almost always indicate a serious
// wire-shape regression that subsequent assertions would crash on.
//
// Use this only for flat-object responses. Array/scalar/typed-struct
// responses should be decoded inline in the test with a typed target.
func AssertJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response is not valid JSON: %v. Body: %s", err, rec.Body.String())
	}
	return result
}

// AssertContentType fails the test if the recorded response's
// Content-Type header does not CONTAIN expected. We use Contains
// rather than equality so that "application/json" matches
// "application/json; charset=utf-8" — callers that need byte-exact
// matching on the full header value should assert on
// rec.Header().Get("Content-Type") directly (see
// internal/api/httpx/json_test.go for the exact-spelling pin).
func AssertContentType(t *testing.T, rec *httptest.ResponseRecorder, expected string) {
	t.Helper()
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, expected) {
		t.Errorf("expected Content-Type containing %q, got %q", expected, ct)
	}
}
