package httputil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRespond(t *testing.T) {
	w := httptest.NewRecorder()
	Respond(w, http.StatusOK, map[string]string{"id": "123"})

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}

	var resp Response
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if resp.Data == nil {
		t.Error("expected data in response")
	}
	if resp.Error != nil {
		t.Error("expected no error in success response")
	}
}

func TestRespondError(t *testing.T) {
	w := httptest.NewRecorder()
	RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle not found")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}

	var resp Response
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if resp.Error == nil {
		t.Fatal("expected error in response")
	}
	if resp.Error.Code != "NOT_FOUND" {
		t.Errorf("expected code 'NOT_FOUND', got %q", resp.Error.Code)
	}
	if resp.Error.Message != "vehicle not found" {
		t.Errorf("expected message 'vehicle not found', got %q", resp.Error.Message)
	}
}

func TestRespondValidationError(t *testing.T) {
	w := httptest.NewRecorder()
	RespondValidationError(w, []ValidationDetail{
		{Field: "vin", Message: "must be 17 characters"},
		{Field: "name", Message: "required"},
	})

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var resp Response
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if resp.Error == nil {
		t.Fatal("expected error in response")
	}
	if resp.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected code 'VALIDATION_ERROR', got %q", resp.Error.Code)
	}
	if len(resp.Error.Details) != 2 {
		t.Errorf("expected 2 validation details, got %d", len(resp.Error.Details))
	}
}

func TestRespondWithPagination(t *testing.T) {
	w := httptest.NewRecorder()
	data := []string{"a", "b"}
	RespondWithPagination(w, data, Pagination{
		Cursor:     "abc123",
		HasMore:    true,
		TotalCount: 100,
	})

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp Response
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if resp.Pagination == nil {
		t.Fatal("expected pagination in response")
	}
	if !resp.Pagination.HasMore {
		t.Error("expected hasMore=true")
	}
	if resp.Pagination.Cursor != "abc123" {
		t.Errorf("expected cursor 'abc123', got %q", resp.Pagination.Cursor)
	}
}
