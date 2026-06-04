package weberrors

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWebErrorsIngest_ValidReport(t *testing.T) {
	body := `{
		"name":"TypeError",
		"message":"Cannot read properties of undefined",
		"stack":"TypeError: Cannot read properties of undefined\n    at Foo (Foo.tsx:42:7)",
		"route":"/dashboard",
		"userAgent":"Mozilla/5.0",
		"occurredAt":"2026-05-04T22:30:00.000Z"
	}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestWebErrorsIngest_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader("not-json"))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "invalid payload") {
		t.Fatalf("want 'invalid payload' in body, got %q", rr.Body.String())
	}
}

func TestWebErrorsIngest_EmptyReport(t *testing.T) {
	body := `{"route":"/dashboard"}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "empty error report") {
		t.Fatalf("want 'empty error report' in body, got %q", rr.Body.String())
	}
}

func TestWebErrorsIngest_RejectsUnknownFields(t *testing.T) {
	body := `{"name":"TypeError","message":"x","route":"/","extra":"nope"}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestWebErrorsIngest_BodyTooLargeRejected(t *testing.T) {
	// http.MaxBytesReader surfaces the oversized body during decode.
	huge := strings.Repeat("A", webErrorsRequestBodyLimit+1024)
	body := `{"name":"Error","message":"` + huge + `","route":"/"}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestWebErrorsIngest_LongStackAccepted(t *testing.T) {
	// A 6 KB stack must be accepted (under the 8 KB max). Verifies the
	// truncation path doesn't reject otherwise-valid reports.
	stack := strings.Repeat("at Foo (foo.tsx:1:1)\\n", 300)
	body := `{"name":"Error","message":"x","stack":"` + stack + `","route":"/"}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestNormalizeWebErrorName(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty becomes Other", "", "Other"},
		{"whitespace becomes Other", "   ", "Other"},
		{"unknown becomes Other", "MyCustomError", "Other"},
		{"known TypeError preserved", "TypeError", "TypeError"},
		{"known ChunkLoadError preserved", "ChunkLoadError", "ChunkLoadError"},
		{"known AbortError preserved", "AbortError", "AbortError"},
		{"too-long name truncated then bucketed", strings.Repeat("X", 200), "Other"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeWebErrorName(tt.in); got != tt.want {
				t.Errorf("normalizeWebErrorName(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestWebErrorsIngest_UnknownNameBucketedAsOther(t *testing.T) {
	// Should still 204 — the handler accepts the report but normalises
	// the name to "Other" before observing the histogram.
	body := `{"name":"WidgetExploded","message":"oops","route":"/"}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
}

func TestWebErrorsIngest_RouteNormalisedForLabelCardinality(t *testing.T) {
	// /drives/123 must be normalised so the histogram doesn't grow a
	// label per drive id. We assert on summary count rather than the
	// internal label by recording a single ingest and reading it back.
	h := NewHandler()
	body := `{"name":"TypeError","message":"x","route":"/drives/12345"}`
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}

	// Summary should report the route as `/drives/:id`.
	sumReq := httptest.NewRequest(http.MethodGet, "/admin/web-errors/summary", nil)
	sumRec := httptest.NewRecorder()
	h.Summary(sumRec, sumReq)
	if sumRec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", sumRec.Code)
	}
	var resp struct {
		Total int `json:"total"`
		Top   []struct {
			Name  string `json:"name"`
			Route string `json:"route"`
			Count int    `json:"count"`
		} `json:"top"`
	}
	if err := json.Unmarshal(sumRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("want total=1, got %d", resp.Total)
	}
	if len(resp.Top) != 1 || resp.Top[0].Route != "/drives/:id" {
		t.Fatalf("want top[0].Route=/drives/:id, got %+v", resp.Top)
	}
}

func TestWebErrorsSummary_RollingWindowEvictsOldEntries(t *testing.T) {
	// Fake clock lets the test step past the rolling window deterministically.
	now := time.Now()
	h := &Handler{now: func() time.Time { return now }}

	// Record at t0.
	h.recordRolling("TypeError", "/dashboard")

	// Step forward 30 minutes — entry still present.
	now = now.Add(30 * time.Minute)
	if got := h.snapshotForTest(); len(got) != 1 {
		t.Fatalf("want 1 entry at t+30m, got %d", len(got))
	}

	// Step forward past 1 hour total — entry must be evicted on next access.
	now = now.Add(31 * time.Minute)
	h.recordRolling("TypeError", "/dashboard") // triggers eviction sweep
	got := h.snapshotForTest()
	if len(got) != 1 {
		t.Fatalf("want 1 entry (the new one) after eviction, got %d", len(got))
	}
}

func TestWebErrorsSummary_TopNAndOrdering(t *testing.T) {
	now := time.Now()
	h := &Handler{now: func() time.Time { return now }}

	for i := 0; i < 5; i++ {
		h.recordRolling("TypeError", "/dashboard")
	}
	for i := 0; i < 3; i++ {
		h.recordRolling("Error", "/drives")
	}
	for i := 0; i < 1; i++ {
		h.recordRolling("AbortError", "/charging")
	}
	// A 4th bucket — should be excluded by Top-N=3.
	h.recordRolling("ChunkLoadError", "/admin")

	sumReq := httptest.NewRequest(http.MethodGet, "/admin/web-errors/summary", nil)
	sumRec := httptest.NewRecorder()
	h.Summary(sumRec, sumReq)

	var resp struct {
		Total int `json:"total"`
		Top   []struct {
			Name  string `json:"name"`
			Route string `json:"route"`
			Count int    `json:"count"`
		} `json:"top"`
		WindowSeconds int    `json:"window_seconds"`
		AsOf          string `json:"as_of"`
	}
	if err := json.Unmarshal(sumRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if resp.Total != 10 {
		t.Fatalf("want total=10, got %d", resp.Total)
	}
	if resp.WindowSeconds != int(webErrorSummaryWindow.Seconds()) {
		t.Fatalf("want window_seconds=%d, got %d", int(webErrorSummaryWindow.Seconds()), resp.WindowSeconds)
	}
	if resp.AsOf == "" {
		t.Fatalf("want as_of populated")
	}
	if len(resp.Top) != webErrorSummaryTopN {
		t.Fatalf("want top length=%d, got %d", webErrorSummaryTopN, len(resp.Top))
	}
	if resp.Top[0].Count != 5 || resp.Top[0].Name != "TypeError" {
		t.Fatalf("want top[0]={TypeError,5}, got %+v", resp.Top[0])
	}
	if resp.Top[1].Count != 3 || resp.Top[1].Name != "Error" {
		t.Fatalf("want top[1]={Error,3}, got %+v", resp.Top[1])
	}
}

// snapshotForTest exposes a copy of the rolling buffer (after eviction
// sweep) so tests can assert on its contents without holding the lock.
func (h *Handler) snapshotForTest() []rollingErrorEntry {
	now := h.callNow()
	cutoff := now.Add(-webErrorSummaryWindow)

	h.mu.Lock()
	defer h.mu.Unlock()
	kept := h.rolling[:0]
	for _, e := range h.rolling {
		if !e.at.Before(cutoff) {
			kept = append(kept, e)
		}
	}
	h.rolling = kept
	out := make([]rollingErrorEntry, len(h.rolling))
	copy(out, h.rolling)
	return out
}
