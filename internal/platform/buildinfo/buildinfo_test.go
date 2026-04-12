package buildinfo

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInfo(t *testing.T) {
	info := Info()
	if info["version"] != "dev" {
		t.Errorf("expected default version 'dev', got %q", info["version"])
	}
	if info["commit"] != "unknown" {
		t.Errorf("expected default commit 'unknown', got %q", info["commit"])
	}
	if info["build_date"] != "unknown" {
		t.Errorf("expected default build_date 'unknown', got %q", info["build_date"])
	}
}

func TestHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/version", nil)
	w := httptest.NewRecorder()

	Handler()(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var info map[string]string
	if err := json.NewDecoder(w.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if info["version"] != "dev" {
		t.Errorf("expected version 'dev', got %q", info["version"])
	}
}

func TestHandler_OverriddenValues(t *testing.T) {
	// Override values to simulate ldflags
	oldVersion, oldCommit, oldDate := Version, Commit, BuildDate
	Version, Commit, BuildDate = "1.2.3", "abc123", "2026-01-01"
	defer func() { Version, Commit, BuildDate = oldVersion, oldCommit, oldDate }()

	req := httptest.NewRequest(http.MethodGet, "/version", nil)
	w := httptest.NewRecorder()
	Handler()(w, req)

	var info map[string]string
	if err := json.NewDecoder(w.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if info["version"] != "1.2.3" {
		t.Errorf("expected version '1.2.3', got %q", info["version"])
	}
	if info["commit"] != "abc123" {
		t.Errorf("expected commit 'abc123', got %q", info["commit"])
	}
}
