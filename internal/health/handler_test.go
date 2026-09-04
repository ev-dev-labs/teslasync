package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeChecker struct {
	err    error
	called bool
}

func (f *fakeChecker) Health(context.Context) error {
	f.called = true
	return f.err
}

func TestLivenessHandlerDoesNotCheckDependencies(t *testing.T) {
	rec := httptest.NewRecorder()
	LivenessHandler()(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var response Response
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Status != "ok" {
		t.Fatalf("status body = %q, want ok", response.Status)
	}
}

func TestReadinessHandlerChecksDependency(t *testing.T) {
	checker := &fakeChecker{err: errors.New(`database "primary" unavailable`)}
	rec := httptest.NewRecorder()
	ReadinessHandler(checker)(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if !checker.called {
		t.Fatal("readiness did not check its dependency")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	var response Response
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Status != "unhealthy" || response.Error != checker.err.Error() {
		t.Fatalf("response = %+v, want unhealthy dependency error", response)
	}
}
