package webvitals

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebVitalsIngest_ValidBatch(t *testing.T) {
	body := `{"metrics":[
		{"name":"LCP","value":1234,"id":"v3-1","rating":"good","route":"/dashboard","ts":1.5},
		{"name":"CLS","value":0.05,"id":"v3-2","rating":"good","route":"/drives/42","ts":2.0},
		{"name":"INP","value":210,"id":"v3-3","rating":"needs-improvement","route":"/charging/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","ts":3.1}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestWebVitalsIngest_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader("not-json"))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "invalid payload") {
		t.Fatalf("want 'invalid payload' in body, got %q", rr.Body.String())
	}
}

func TestWebVitalsIngest_EmptyBatch(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(`{"metrics":[]}`))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestWebVitalsIngest_BatchTooLarge(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"metrics":[`)
	for i := 0; i < maxWebVitalsBatchSize+1; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(`{"name":"LCP","value":1,"id":"x","rating":"good","route":"/","ts":0}`)
	}
	sb.WriteString(`]}`)
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(sb.String()))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestWebVitalsIngest_UnknownMetricNameDropped(t *testing.T) {
	// Unknown metric should be silently dropped while known ones are
	// still observed — the response is 204 (overall accept) but the
	// rejection counter advances.
	body := `{"metrics":[
		{"name":"FAKE","value":99,"id":"x","rating":"good","route":"/","ts":0},
		{"name":"FCP","value":800,"id":"y","rating":"good","route":"/","ts":0}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
}

func TestWebVitalsIngest_RejectsUnknownFields(t *testing.T) {
	// Strict decoding to catch protocol drift early.
	body := `{"metrics":[{"name":"LCP","value":1,"id":"x","rating":"good","route":"/","ts":0}],"extra":"nope"}`
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestWebVitalsNormalizeRoute(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty becomes root", "", "/"},
		{"root stays root", "/", "/"},
		{"plain page lowercased", "/Dashboard", "/dashboard"},
		{"integer id replaced", "/drives/123", "/drives/:id"},
		{"integer id mid-path replaced", "/drives/123/telemetry", "/drives/:id/telemetry"},
		{"uuid with dashes replaced", "/charging/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "/charging/:id"},
		{"uuid without dashes replaced", "/c/9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d", "/c/:id"},
		{"long hex token replaced", "/share/abcdef0123456789abcdef", "/share/:id"},
		{"short alphabetic segments preserved", "/vehicles/list/state", "/vehicles/list/state"},
		{"query string stripped", "/dashboard?foo=bar", "/dashboard"},
		{"fragment stripped", "/dashboard#anchor", "/dashboard"},
		{"missing leading slash added", "dashboard", "/dashboard"},
		{"trailing slash trimmed", "/dashboard/", "/dashboard"},
		{"double slashes collapsed", "/a//b", "/a/b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeRoute(tt.in)
			if got != tt.want {
				t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestWebVitalsNormalizeRoute_LengthCap(t *testing.T) {
	// Long deep-link should be truncated, not allowed to balloon the
	// histogram label cardinality.
	long := "/" + strings.Repeat("verylongsegment/", 10)
	got := NormalizeRoute(long)
	if len(got) > maxRouteLabelLength {
		t.Errorf("NormalizeRoute returned len=%d, want <= %d (got %q)", len(got), maxRouteLabelLength, got)
	}
}

func TestWebVitalsIngest_UnknownRatingNormalized(t *testing.T) {
	// A client that ships a novel rating string must NOT be able to spawn
	// an unbounded label set. The handler should still 204.
	body := `{"metrics":[{"name":"LCP","value":1,"id":"x","rating":"weird","route":"/","ts":0}]}`
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewHandler().Ingest(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
}
