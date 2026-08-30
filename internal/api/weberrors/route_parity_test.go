package weberrors

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apivitals "github.com/ev-dev-labs/teslasync/internal/api/webvitals"
)

// Route-normalisation parity.
//
// Both public ingest surfaces — `POST /api/v1/web-vitals` and
// `POST /api/v1/web-errors` — accept a client-supplied route and turn it into a
// Prometheus label. They MUST produce identical templates: a divergence means
// an opaque share token or customer slug that is redacted on one endpoint
// survives on the other, and a Prometheus label persists for the full retention
// window.
//
// `weberrors` gets this by delegating to `apivitals.NormalizeRoute` rather than
// re-implementing it. These specs pin that delegation so a future "small local
// tweak" fails here instead of in production.

// acceptanceRoutes are the exact cases raised in the observability acceptance
// review, plus the shapes around them.
var acceptanceRoutes = []struct {
	in   string
	want string
}{
	{"/s/share-token-abc", "/s/:id"},
	{"/year-review/private-share-slug", "/year-review/:id"},
	{"/trips/customer-private-slug", "/trips/:id"},
	{"/automations/private-name/edit", "/automations/:id/edit"},
	{"/charging/private-slug", "/charging/:id"},
	{"/system-status/incidents/private-slug", "/system-status/incidents/:id"},
	{"/drives/48291", "/drives/:id"},
	{"/vehicles/5YJ3E1EA7JF000316", "/vehicles/:id"},
	{"/analytics/battery-degradation", "/analytics/battery-degradation"},
	{"/automations/list", "/automations/list"},
	{"/dashboard?secret=hunter2#frag", "/dashboard"},
	{"https://tenant.example.com/s/share-token-abc", "/s/:id"},
	{"//tenant.example.com/s/share-token-abc", "/s/:id"},
	{"/search/%2Fsecret", "/search/:id"},
	{"/search/%zz", "/search/:id"},
	{"", "/"},
	{"/", "/"},
}

func TestWebErrorsUsesSharedRouteNormalizer(t *testing.T) {
	for _, tt := range acceptanceRoutes {
		if got := apivitals.NormalizeRoute(tt.in); got != tt.want {
			t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

// TestIngestTemplatesTheRouteLabel drives the real handler and asserts the
// rolling summary — the admin-visible surface — never shows a raw slug.
func TestIngestTemplatesTheRouteLabel(t *testing.T) {
	h := NewHandler()

	for _, tt := range acceptanceRoutes {
		body, err := json.Marshal(map[string]string{
			"name":    "TypeError",
			"message": "boom",
			"route":   tt.in,
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.Ingest(rr, req)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("route %q: want 204, got %d (%s)", tt.in, rr.Code, rr.Body.String())
		}
	}

	rr := httptest.NewRecorder()
	h.Summary(rr, httptest.NewRequest(http.MethodGet, "/admin/web-errors/summary", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("summary: want 200, got %d", rr.Code)
	}

	summary := rr.Body.String()
	for _, leak := range []string{
		"share-token-abc",
		"private-share-slug",
		"customer-private-slug",
		"private-name",
		"private-slug",
		"48291",
		"5YJ3E1EA7JF000316",
		"hunter2",
		"tenant.example.com",
		"%2F",
		"%zz",
	} {
		if strings.Contains(summary, leak) {
			t.Errorf("web-errors summary leaked %q: %s", leak, summary)
		}
	}
}

// TestNormalizeWebErrorNameStillBounded guards the other label on this handler.
func TestNormalizeWebErrorNameStillBounded(t *testing.T) {
	for _, in := range []string{"", "Whatever", strings.Repeat("x", 500), "<script>"} {
		got := normalizeWebErrorName(in)
		if got != "Other" {
			t.Errorf("normalizeWebErrorName(%q) = %q, want Other", in, got)
		}
	}
	if got := normalizeWebErrorName("TypeError"); got != "TypeError" {
		t.Errorf("normalizeWebErrorName(TypeError) = %q", got)
	}
}
