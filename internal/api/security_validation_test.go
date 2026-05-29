package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "test error")

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
	if !strings.Contains(w.Body.String(), "test error") {
		t.Errorf("body should contain 'test error', got: %s", w.Body.String())
	}
}

func TestWriteJSONResponse(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"key": "value"})

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	ct := w.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if !strings.Contains(w.Body.String(), `"key":"value"`) {
		t.Errorf("body should contain key:value, got: %s", w.Body.String())
	}
}
