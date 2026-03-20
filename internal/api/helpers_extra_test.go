package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Tests that complement the existing api_test.go coverage.

func TestWriteJSONContentType(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"k": "v"})

	ct := w.Header().Get("Content-Type")
	if ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json; charset=utf-8")
	}
}

func TestWriteErrorAllStatusCodes(t *testing.T) {
	tests := []struct {
		status   int
		wantCode string
	}{
		{http.StatusTeapot, "ERROR"},
	}
	for _, tt := range tests {
		w := httptest.NewRecorder()
		writeError(w, tt.status, "msg")
		var r map[string]string
		json.Unmarshal(w.Body.Bytes(), &r)
		if r["code"] != tt.wantCode {
			t.Errorf("status %d: code = %q, want %q", tt.status, r["code"], tt.wantCode)
		}
	}
}

func TestPaginationBoundary(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?limit=1000", nil)
	limit, _ := pagination(r)
	if limit != 1000 {
		t.Errorf("limit = %d, want 1000 (max allowed)", limit)
	}

	r2 := httptest.NewRequest("GET", "/test?limit=1001", nil)
	limit2, _ := pagination(r2)
	if limit2 != 50 {
		t.Errorf("limit = %d, want 50 (fallback for over-max)", limit2)
	}
}

func TestParseDateRangePartial(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=2024-06-15", nil)
	start, end := parseDateRange(r)
	if start.IsZero() {
		t.Error("start should not be zero")
	}
	if !end.IsZero() {
		t.Error("end should be zero when not provided")
	}
}

func TestParseDateRangeInvalid(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=invalid&end=also-invalid", nil)
	start, end := parseDateRange(r)
	if !start.IsZero() {
		t.Error("start should be zero for invalid format")
	}
	if !end.IsZero() {
		t.Error("end should be zero for invalid format")
	}
}

func TestHttpStatusCodeMapping(t *testing.T) {
	if httpStatusCode(http.StatusNotFound) != "NOT_FOUND" {
		t.Error("404 should map to NOT_FOUND")
	}
	if httpStatusCode(http.StatusConflict) != "CONFLICT" {
		t.Error("409 should map to CONFLICT")
	}
	if httpStatusCode(299) != "ERROR" {
		t.Error("unmapped status should return ERROR")
	}
}
