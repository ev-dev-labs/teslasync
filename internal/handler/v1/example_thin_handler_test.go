//go:build phase47_example
// +build phase47_example

// example_thin_handler_test.go is a self-contained illustration of the
// canonical thin-handler shape. It is gated behind the `phase47_example`
// build tag so it does NOT run in normal
// `go test ./...` invocations — its purpose is documentation, not
// runtime coverage. To experiment locally:
//
//	go test -tags phase47_example -v -run TestExampleThinHandler ./internal/handler/v1/...
//
// The pattern below intentionally avoids depending on any concrete
// internal/app or internal/port type, so contributors can adapt it to
// new bounded contexts without coupling to today's services.

package v1_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ExampleService stands in for a real port interface declared under
// internal/port/<name>. Real handlers depend on a port — never on a
// concrete repository, adapter, or service struct.
type ExampleService interface {
	GetDisplayName(ctx context.Context, id int64) (string, error)
}

// fakeExampleService implements the port for the test. In production
// the wire-up lives in cmd/teslasync (or internal/app/<name>svc); the
// handler accepts whatever satisfies the port.
type fakeExampleService struct{ name string }

func (f *fakeExampleService) GetDisplayName(_ context.Context, _ int64) (string, error) {
	return f.name, nil
}

// newExampleHandler is THE thin handler shape:
//
//   - Constructor takes the port interface (NOT a *sql.DB, NOT a
//     concrete repo).
//   - The returned http.HandlerFunc decodes inputs, calls the use-case,
//     encodes a DTO. Zero database/adapter/model imports.
func newExampleHandler(svc ExampleService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, err := svc.GetDisplayName(r.Context(), 42)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"display_name": name})
	}
}

func TestExampleThinHandler(t *testing.T) {
	h := newExampleHandler(&fakeExampleService{name: "Model 3"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles/42", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	var got map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["display_name"] != "Model 3" {
		t.Errorf("body: %+v", got)
	}
}
