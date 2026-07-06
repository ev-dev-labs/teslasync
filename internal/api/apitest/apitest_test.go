package apitest_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apitest"
)

// Compile-time guarantees: the real *testing.T still satisfies the widened
// interface (backward compatibility), and the recording fake used below is a
// valid stand-in for it.
var (
	_ apitest.TestingT = (*testing.T)(nil)
	_ apitest.TestingT = (*recordingT)(nil)
)

// recordingT is a minimal apitest.TestingT implementation that records the
// helper calls made against it instead of failing a real *testing.T. It lets
// the assertion helpers' own failure paths be exercised deterministically.
//
// Errorf models testing.T.Errorf (marks failure, keeps running); Fatalf models
// testing.T.Fatalf (marks failure, then aborts the goroutine via
// runtime.Goexit). Because Fatalf aborts, every helper invocation that uses a
// recordingT is run through runCapture so a Fatalf never tears down the test
// goroutine itself.
type recordingT struct {
	helperCalls int
	errorf      []string
	fatalf      []string
}

func (r *recordingT) Helper() { r.helperCalls++ }

func (r *recordingT) Errorf(format string, args ...any) {
	r.errorf = append(r.errorf, fmt.Sprintf(format, args...))
}

func (r *recordingT) Fatalf(format string, args ...any) {
	r.fatalf = append(r.fatalf, fmt.Sprintf(format, args...))
	runtime.Goexit()
}

// runCapture runs fn in its own goroutine and blocks until it returns or aborts
// via runtime.Goexit (as Fatalf does). The channel close establishes a
// happens-before edge, so fields written by fn are safe to read afterwards
// under -race without any sleeps or polling.
func runCapture(fn func()) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		fn()
	}()
	<-done
}

// capturedRequest records what a handler observed about an inbound request so
// DoRequest's request-construction behaviour can be asserted.
type capturedRequest struct {
	seen        bool
	method      string
	path        string
	rawQuery    string
	body        string
	contentType string
}

func recordingHandler(status int, respBody string, captured *capturedRequest) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		captured.seen = true
		captured.method = r.Method
		captured.path = r.URL.Path
		captured.rawQuery = r.URL.RawQuery
		captured.body = string(b)
		captured.contentType = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	})
}

func TestDoRequest_BuildsRequestAndReturnsRecorder(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantMethod string
		wantPath   string
		wantQuery  string
		wantBody   string
	}{
		{"get no body", http.MethodGet, "/healthz", "", http.MethodGet, "/healthz", "", ""},
		{"post with body", http.MethodPost, "/api/v1/vehicles", `{"a":1}`, http.MethodPost, "/api/v1/vehicles", "", `{"a":1}`},
		{"put with body", http.MethodPut, "/res/1", `{"n":"y"}`, http.MethodPut, "/res/1", "", `{"n":"y"}`},
		{"delete no body", http.MethodDelete, "/res/1", "", http.MethodDelete, "/res/1", "", ""},
		{"patch with body", http.MethodPatch, "/res/2", `{"op":"x"}`, http.MethodPatch, "/res/2", "", `{"op":"x"}`},
		{"path with query", http.MethodGet, "/list?limit=10&offset=5", "", http.MethodGet, "/list", "limit=10&offset=5", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var cap capturedRequest
			h := recordingHandler(http.StatusOK, `{"ok":true}`, &cap)

			rec := apitest.DoRequest(h, tc.method, tc.path, tc.body)

			if rec == nil {
				t.Fatal("DoRequest returned nil recorder")
			}
			if !cap.seen {
				t.Fatal("handler was not invoked")
			}
			if cap.method != tc.wantMethod {
				t.Errorf("method = %q, want %q", cap.method, tc.wantMethod)
			}
			if cap.path != tc.wantPath {
				t.Errorf("path = %q, want %q", cap.path, tc.wantPath)
			}
			if cap.rawQuery != tc.wantQuery {
				t.Errorf("rawQuery = %q, want %q", cap.rawQuery, tc.wantQuery)
			}
			if cap.body != tc.wantBody {
				t.Errorf("request body = %q, want %q", cap.body, tc.wantBody)
			}
			// Content-Type is always set on the outbound request, even when
			// there is no body.
			if cap.contentType != "application/json" {
				t.Errorf("request Content-Type = %q, want application/json", cap.contentType)
			}
			if rec.Code != http.StatusOK {
				t.Errorf("recorder Code = %d, want %d", rec.Code, http.StatusOK)
			}
			if got := rec.Body.String(); got != `{"ok":true}` {
				t.Errorf("recorder body = %q, want %q", got, `{"ok":true}`)
			}
		})
	}
}

func TestDoRequest_PropagatesHandlerStatusAndBody(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{"created", http.StatusCreated, `{"id":1}`},
		{"no content", http.StatusNoContent, ""},
		{"bad request", http.StatusBadRequest, `{"error":"bad"}`},
		{"not found", http.StatusNotFound, `{"error":"nope"}`},
		{"server error", http.StatusInternalServerError, `{"error":"boom"}`},
		{"teapot", http.StatusTeapot, ``},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var cap capturedRequest
			h := recordingHandler(tc.status, tc.body, &cap)

			rec := apitest.DoRequest(h, http.MethodGet, "/x", "")

			if rec.Code != tc.status {
				t.Errorf("Code = %d, want %d", rec.Code, tc.status)
			}
			if got := rec.Body.String(); got != tc.body {
				t.Errorf("body = %q, want %q", got, tc.body)
			}
		})
	}
}

func TestDoRequest_EmptyBodySendsNoBytes(t *testing.T) {
	var cap capturedRequest
	h := recordingHandler(http.StatusOK, "", &cap)

	apitest.DoRequest(h, http.MethodPost, "/thing", "")

	if cap.body != "" {
		t.Errorf("empty body arg should produce an empty request body, got %q", cap.body)
	}
}

func TestAssertStatus(t *testing.T) {
	tests := []struct {
		name     string
		code     int
		expected int
		wantFail bool
	}{
		{"match 200", http.StatusOK, http.StatusOK, false},
		{"match 500", http.StatusInternalServerError, http.StatusInternalServerError, false},
		{"match teapot", http.StatusTeapot, http.StatusTeapot, false},
		{"mismatch 200 vs 404", http.StatusOK, http.StatusNotFound, true},
		{"mismatch 500 vs 200", http.StatusInternalServerError, http.StatusOK, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			rec.Code = tc.code
			rec.Body.WriteString("diagnostic-body")

			fake := &recordingT{}
			runCapture(func() { apitest.AssertStatus(fake, rec, tc.expected) })

			if fake.helperCalls != 1 {
				t.Errorf("Helper() called %d times, want 1", fake.helperCalls)
			}
			if len(fake.fatalf) != 0 {
				t.Errorf("AssertStatus must never call Fatalf, got %v", fake.fatalf)
			}
			gotFail := len(fake.errorf) > 0
			if gotFail != tc.wantFail {
				t.Fatalf("failure=%v, want %v (errorf=%v)", gotFail, tc.wantFail, fake.errorf)
			}
			if tc.wantFail {
				if len(fake.errorf) != 1 {
					t.Fatalf("expected exactly one Errorf, got %d: %v", len(fake.errorf), fake.errorf)
				}
				msg := fake.errorf[0]
				if !strings.Contains(msg, fmt.Sprintf("%d", tc.expected)) {
					t.Errorf("message %q should contain expected code %d", msg, tc.expected)
				}
				if !strings.Contains(msg, fmt.Sprintf("%d", tc.code)) {
					t.Errorf("message %q should contain actual code %d", msg, tc.code)
				}
				if !strings.Contains(msg, "diagnostic-body") {
					t.Errorf("message %q should echo the response body for self-diagnosis", msg)
				}
			}
		})
	}
}

func TestAssertContentType(t *testing.T) {
	tests := []struct {
		name      string
		header    string
		setHeader bool
		expected  string
		wantFail  bool
	}{
		{"exact json", "application/json", true, "application/json", false},
		{"json with charset suffix", "application/json; charset=utf-8", true, "application/json", false},
		{"substring match", "application/json", true, "json", false},
		{"text plain exact", "text/plain", true, "text/plain", false},
		{"mismatch html vs json", "text/html", true, "application/json", true},
		{"missing header", "", false, "application/json", true},
		{"empty expected always matches", "text/html", true, "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			if tc.setHeader {
				rec.Header().Set("Content-Type", tc.header)
			}

			fake := &recordingT{}
			runCapture(func() { apitest.AssertContentType(fake, rec, tc.expected) })

			if fake.helperCalls != 1 {
				t.Errorf("Helper() called %d times, want 1", fake.helperCalls)
			}
			if len(fake.fatalf) != 0 {
				t.Errorf("AssertContentType must never call Fatalf, got %v", fake.fatalf)
			}
			gotFail := len(fake.errorf) > 0
			if gotFail != tc.wantFail {
				t.Fatalf("failure=%v, want %v (errorf=%v)", gotFail, tc.wantFail, fake.errorf)
			}
			if tc.wantFail {
				msg := fake.errorf[0]
				if !strings.Contains(msg, fmt.Sprintf("%q", tc.expected)) {
					t.Errorf("message %q should contain expected %q", msg, tc.expected)
				}
			}
		})
	}
}

func TestAssertJSON_Success(t *testing.T) {
	tests := []struct {
		name  string
		body  string
		check func(t *testing.T, got map[string]interface{})
	}{
		{
			name: "flat object",
			body: `{"status":"ok","n":3}`,
			check: func(t *testing.T, got map[string]interface{}) {
				if got["status"] != "ok" {
					t.Errorf(`status = %v, want "ok"`, got["status"])
				}
				if got["n"] != float64(3) {
					t.Errorf("n = %v (%T), want float64(3)", got["n"], got["n"])
				}
			},
		},
		{
			name: "empty object",
			body: `{}`,
			check: func(t *testing.T, got map[string]interface{}) {
				if got == nil {
					t.Fatal("expected non-nil empty map")
				}
				if len(got) != 0 {
					t.Errorf("len = %d, want 0", len(got))
				}
			},
		},
		{
			name: "nested object and array",
			body: `{"a":{"b":1},"c":[1,2]}`,
			check: func(t *testing.T, got map[string]interface{}) {
				inner, ok := got["a"].(map[string]interface{})
				if !ok {
					t.Fatalf("a = %v (%T), want nested object", got["a"], got["a"])
				}
				if inner["b"] != float64(1) {
					t.Errorf("a.b = %v, want 1", inner["b"])
				}
				arr, ok := got["c"].([]interface{})
				if !ok || len(arr) != 2 {
					t.Errorf("c = %v, want 2-element array", got["c"])
				}
			},
		},
		{
			// json.Unmarshal of "null" into a map leaves it nil and returns no
			// error, so AssertJSON must return nil without aborting.
			name: "null yields nil map without failure",
			body: `null`,
			check: func(t *testing.T, got map[string]interface{}) {
				if got != nil {
					t.Errorf("got = %v, want nil map for JSON null", got)
				}
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			rec.Body.WriteString(tc.body)

			fake := &recordingT{}
			var got map[string]interface{}
			runCapture(func() { got = apitest.AssertJSON(fake, rec) })

			if fake.helperCalls != 1 {
				t.Errorf("Helper() called %d times, want 1", fake.helperCalls)
			}
			if len(fake.errorf) != 0 {
				t.Errorf("AssertJSON must never call Errorf, got %v", fake.errorf)
			}
			if len(fake.fatalf) != 0 {
				t.Fatalf("valid JSON must not call Fatalf, got %v", fake.fatalf)
			}
			tc.check(t, got)
		})
	}
}

func TestAssertJSON_Failure(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"not json", "not json"},
		{"empty body", ""},
		{"array not object", "[1,2,3]"},
		{"number not object", "123"},
		{"string not object", `"hello"`},
		{"truncated object", `{"a":`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			rec.Body.WriteString(tc.body)

			fake := &recordingT{}
			runCapture(func() { _ = apitest.AssertJSON(fake, rec) })

			if fake.helperCalls != 1 {
				t.Errorf("Helper() called %d times, want 1", fake.helperCalls)
			}
			if len(fake.errorf) != 0 {
				t.Errorf("AssertJSON must never call Errorf, got %v", fake.errorf)
			}
			if len(fake.fatalf) != 1 {
				t.Fatalf("expected exactly one Fatalf for invalid JSON, got %d: %v", len(fake.fatalf), fake.fatalf)
			}
			msg := fake.fatalf[0]
			if !strings.Contains(msg, "not valid JSON") {
				t.Errorf("message %q should explain the JSON failure", msg)
			}
			// The offending body is echoed to keep CI failures self-diagnosing.
			if tc.body != "" && !strings.Contains(msg, tc.body) {
				t.Errorf("message %q should echo the offending body %q", msg, tc.body)
			}
		})
	}
}
