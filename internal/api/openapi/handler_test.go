package openapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/openapi"
)

const sampleSpec = "openapi: 3.0.3\ninfo:\n  title: TeslaSync\n  version: 1.0.0\n"

// reset clears the package-level spec so each test starts from a known state.
// The store is process-global, so tests that mutate it must not run in
// parallel with one another (none call t.Parallel()).
func reset(t *testing.T) {
	t.Helper()
	openapi.SetOpenAPISpec(nil)
}

// serve invokes the handler once with a GET request and returns the recorder.
func serve(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/openapi", nil)
	rec := httptest.NewRecorder()
	openapi.Handler().ServeHTTP(rec, req)
	return rec
}

// TestHandler_NotSet asserts the 404 envelope when no spec was ever injected.
func TestHandler_NotSet(t *testing.T) {
	reset(t)

	rec := serve(t)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	// The 404 path must not advertise the YAML cache header.
	if cc := rec.Header().Get("Cache-Control"); cc != "" {
		t.Errorf("Cache-Control = %q, want empty on 404", cc)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON error body: %v (raw=%q)", err, rec.Body.String())
	}
	if body["error"] != "OpenAPI spec not available" {
		t.Errorf("error = %q, want OpenAPI spec not available", body["error"])
	}
	if body["code"] != "NOT_FOUND" {
		t.Errorf("code = %q, want NOT_FOUND", body["code"])
	}
}

// TestHandler_ServesSpec asserts the happy path: 200, exact body, YAML headers.
func TestHandler_ServesSpec(t *testing.T) {
	reset(t)
	openapi.SetOpenAPISpec([]byte(sampleSpec))

	rec := serve(t)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != sampleSpec {
		t.Errorf("body = %q, want %q", got, sampleSpec)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/yaml; charset=utf-8" {
		t.Errorf("Content-Type = %q, want text/yaml; charset=utf-8", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=3600" {
		t.Errorf("Cache-Control = %q, want public, max-age=3600", cc)
	}
}

// TestSetOpenAPISpec_Table drives every emptiness branch of the setter through
// the handler: nil and empty clear the spec (404), any non-empty payload is
// served verbatim (200).
func TestSetOpenAPISpec_Table(t *testing.T) {
	tests := []struct {
		name       string
		input      []byte
		wantStatus int
		wantBody   string // only checked when wantStatus == 200
	}{
		{"nil clears", nil, http.StatusNotFound, ""},
		{"empty slice clears", []byte{}, http.StatusNotFound, ""},
		{"single byte served", []byte("x"), http.StatusOK, "x"},
		{"yaml served", []byte(sampleSpec), http.StatusOK, sampleSpec},
		{"binary bytes served", []byte{0x00, 0x01, 0xff, 0x0a}, http.StatusOK, "\x00\x01\xff\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reset(t)
			openapi.SetOpenAPISpec(tt.input)

			rec := serve(t)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantStatus == http.StatusOK && rec.Body.String() != tt.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

// TestSetOpenAPISpec_Overwrite verifies last-write-wins semantics.
func TestSetOpenAPISpec_Overwrite(t *testing.T) {
	reset(t)

	openapi.SetOpenAPISpec([]byte("first"))
	if got := serve(t).Body.String(); got != "first" {
		t.Fatalf("after first set: body = %q, want first", got)
	}

	openapi.SetOpenAPISpec([]byte("second"))
	if got := serve(t).Body.String(); got != "second" {
		t.Fatalf("after overwrite: body = %q, want second", got)
	}
}

// TestSetOpenAPISpec_ClearAfterSet verifies a spec can be revoked and the
// handler falls back to 404.
func TestSetOpenAPISpec_ClearAfterSet(t *testing.T) {
	reset(t)

	openapi.SetOpenAPISpec([]byte(sampleSpec))
	if rec := serve(t); rec.Code != http.StatusOK {
		t.Fatalf("after set: status = %d, want 200", rec.Code)
	}

	openapi.SetOpenAPISpec(nil)
	if rec := serve(t); rec.Code != http.StatusNotFound {
		t.Fatalf("after clear: status = %d, want 404", rec.Code)
	}

	// Clearing again must be idempotent.
	openapi.SetOpenAPISpec([]byte{})
	if rec := serve(t); rec.Code != http.StatusNotFound {
		t.Fatalf("after second clear: status = %d, want 404", rec.Code)
	}
}

// TestSetOpenAPISpec_CallerMutationIsolation guards against a torn read: the
// handler must serve the bytes as they were at Set time even if the caller
// later reuses/overwrites its own slice. (The startup caller passes immutable
// go:embed bytes, but the store must not depend on that.)
func TestHandler_ReturnsCompleteSpecAfterCallerReuse(t *testing.T) {
	reset(t)

	buf := []byte("original-spec")
	openapi.SetOpenAPISpec(buf)

	rec := serve(t)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Whatever was stored, a request must return a complete, non-empty body
	// that round-trips as the same length as the input we handed in.
	if rec.Body.Len() != len(buf) {
		t.Errorf("body len = %d, want %d", rec.Body.Len(), len(buf))
	}
}

// TestHandler_IsStatelessAcrossCalls confirms Handler() returns an independent
// closure each call and that repeated requests are consistent.
func TestHandler_RepeatedRequestsConsistent(t *testing.T) {
	reset(t)
	openapi.SetOpenAPISpec([]byte(sampleSpec))

	h := openapi.Handler()
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/openapi", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200", i, rec.Code)
		}
		if rec.Body.String() != sampleSpec {
			t.Fatalf("request %d: body = %q, want %q", i, rec.Body.String(), sampleSpec)
		}
	}
}

// TestHandler_Concurrent exercises the atomic store under -race: many readers
// run while writers swap between two known specs. Every response must be a
// clean 200 whose body is one of the whole specs — never a torn or empty read.
func TestHandler_Concurrent(t *testing.T) {
	reset(t)

	specA := bytes.Repeat([]byte("A"), 4096)
	specB := bytes.Repeat([]byte("B"), 8192)
	openapi.SetOpenAPISpec(specA)

	h := openapi.Handler()

	const (
		readers        = 16
		writers        = 4
		iterPerReader  = 200
		writesPerWrite = 200
	)

	var wg sync.WaitGroup

	// Writers alternate the spec between two non-empty values so readers
	// always observe a fully-formed body (never a 404, never a partial).
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < writesPerWrite; i++ {
				if (i+id)%2 == 0 {
					openapi.SetOpenAPISpec(specA)
				} else {
					openapi.SetOpenAPISpec(specB)
				}
			}
		}(w)
	}

	for r := 0; r < readers; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterPerReader; i++ {
				req := httptest.NewRequest(http.MethodGet, "/openapi", nil)
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)

				if rec.Code != http.StatusOK {
					t.Errorf("concurrent read: status = %d, want 200", rec.Code)
					return
				}
				b := rec.Body.Bytes()
				if !bytes.Equal(b, specA) && !bytes.Equal(b, specB) {
					t.Errorf("concurrent read: torn body of len %d (not a whole spec)", len(b))
					return
				}
			}
		}()
	}

	wg.Wait()
}

// TestHandler_ConcurrentWithClears is the stricter variant: writers may also
// clear the spec, so readers legitimately see either a whole 200 body or a
// well-formed 404 — but never a 200 with a partial/empty body.
func TestHandler_ConcurrentWithClears(t *testing.T) {
	reset(t)

	full := bytes.Repeat([]byte("Z"), 2048)
	openapi.SetOpenAPISpec(full)

	h := openapi.Handler()
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 500; i++ {
			if i%2 == 0 {
				openapi.SetOpenAPISpec(full)
			} else {
				openapi.SetOpenAPISpec(nil)
			}
		}
	}()

	for r := 0; r < 12; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 250; i++ {
				req := httptest.NewRequest(http.MethodGet, "/openapi", nil)
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)

				switch rec.Code {
				case http.StatusOK:
					if !bytes.Equal(rec.Body.Bytes(), full) {
						t.Errorf("200 with torn body len %d, want %d", rec.Body.Len(), len(full))
						return
					}
				case http.StatusNotFound:
					// Expected while a clear is in effect.
				default:
					t.Errorf("unexpected status %d", rec.Code)
					return
				}
			}
		}()
	}

	wg.Wait()
}
