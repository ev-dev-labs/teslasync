package weberrors

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apivitals "github.com/ev-dev-labs/teslasync/internal/api/webvitals"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// Bounded route admission on the web-errors surface.
//
// `{route}` is client-supplied on an anonymous endpoint. Normalising it is not
// enough: a caller can mint an unbounded number of DIFFERENT well-formed,
// safe-word templates (`/alpha`, `/bravo`, …), each of which is a new
// Prometheus series that persists for the full retention window. The surface
// therefore folds routes through its own capped admission registry.

func postReport(t *testing.T, h *Handler, route string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{
		"name":    "TypeError",
		"message": "boom",
		"route":   route,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/web-errors", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Ingest(rr, req)
	return rr
}

func gatherFamily(t *testing.T, name string) *dto.MetricFamily {
	t.Helper()
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	for _, f := range families {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

func counterValue(t *testing.T, family string, want map[string]string) float64 {
	t.Helper()
	f := gatherFamily(t, family)
	if f == nil {
		return 0
	}
	var total float64
	for _, m := range f.GetMetric() {
		got := make(map[string]string, len(m.GetLabel()))
		for _, l := range m.GetLabel() {
			got[l.GetName()] = l.GetValue()
		}
		match := true
		for k, v := range want {
			if got[k] != v {
				match = false
				break
			}
		}
		if match {
			total += m.GetCounter().GetValue()
		}
	}
	return total
}

// routeLabelValues returns every distinct `route` label currently present on
// teslasync_web_errors_total.
func routeLabelValues(t *testing.T) map[string]struct{} {
	t.Helper()
	out := map[string]struct{}{}
	f := gatherFamily(t, "teslasync_web_errors_total")
	if f == nil {
		return out
	}
	for _, m := range f.GetMetric() {
		for _, l := range m.GetLabel() {
			if l.GetName() == "route" {
				out[l.GetValue()] = struct{}{}
			}
		}
	}
	return out
}

// TestRouteLabelIsCardinalityBounded is the substantive assertion: more than
// `cap` distinct, perfectly well-formed safe-word routes must NOT produce more
// than `cap` distinct label values.
func TestRouteLabelIsCardinalityBounded(t *testing.T) {
	const cap = 4
	original := routeAdmitter
	routeAdmitter = apivitals.NewRouteAdmitter("weberrorstest", cap, maxNewErrorRoutesPerRequest)
	t.Cleanup(func() { routeAdmitter = original })

	h := NewHandler()
	before := routeLabelValues(t)

	// 40 distinct safe-word routes: every one normalises to itself, so nothing
	// but the admission cap can bound them.
	const attempts = 40
	for i := 0; i < attempts; i++ {
		route := fmt.Sprintf("/synthetic-%c%c", rune('a'+i/26), rune('a'+i%26))
		if rr := postReport(t, h, route); rr.Code != http.StatusNoContent {
			t.Fatalf("request %d: want 204, got %d", i, rr.Code)
		}
	}

	if got := routeAdmitter.Size(); got > cap {
		t.Fatalf("admitted %d routes, want <= %d", got, cap)
	}

	after := routeLabelValues(t)
	newLabels := 0
	for label := range after {
		if _, existed := before[label]; !existed {
			newLabels++
		}
	}
	// cap admitted templates + the shared overflow bucket.
	if newLabels > cap+1 {
		t.Fatalf("web_errors_total gained %d route labels from %d requests, want <= %d",
			newLabels, attempts, cap+1)
	}
	if _, ok := after[apivitals.OverflowRoute]; !ok {
		t.Fatalf("overflow bucket %q never received a report", apivitals.OverflowRoute)
	}
	if got := counterValue(t, "teslasync_frontend_label_overflow_total", map[string]string{
		"label": "weberrorstest_route",
	}); got < 1 {
		t.Fatalf("overflow counter for this surface = %v, want >= 1", got)
	}
}

// TestPerRequestAdmissionBudget proves one POST cannot introduce more than one
// new template, so a single request can never burn the surface's budget.
func TestPerRequestAdmissionBudget(t *testing.T) {
	original := routeAdmitter
	routeAdmitter = apivitals.NewRouteAdmitter("weberrorsbudget", 80, 1)
	t.Cleanup(func() { routeAdmitter = original })

	h := NewHandler()
	// A web-error report carries exactly one route, so a well-behaved client
	// admits exactly one new template per request.
	for i := 0; i < 5; i++ {
		if rr := postReport(t, h, fmt.Sprintf("/budget-%c", rune('a'+i))); rr.Code != http.StatusNoContent {
			t.Fatalf("want 204, got %d", rr.Code)
		}
	}
	if got := routeAdmitter.Size(); got != 5 {
		t.Fatalf("admitted %d routes across 5 requests, want 5", got)
	}
}

// TestSurfacesDoNotStarveEachOther pins the deliberate decision to give each
// ingest surface its own registry.
func TestSurfacesDoNotStarveEachOther(t *testing.T) {
	a := apivitals.NewRouteAdmitter("starve_a", 2, 8)
	b := apivitals.NewRouteAdmitter("starve_b", 2, 8)

	batchA := a.NewBatch()
	for _, r := range []string{"/alpha", "/bravo", "/charlie"} {
		batchA.Admit(r)
	}
	if a.Size() != 2 {
		t.Fatalf("surface A admitted %d, want 2", a.Size())
	}
	// Surface B is untouched by A's exhaustion.
	if b.Size() != 0 {
		t.Fatalf("surface B size = %d before use, want 0", b.Size())
	}
	batchB := b.NewBatch()
	if got := batchB.Admit("/delta"); got != "/delta" {
		t.Fatalf("surface B admit = %q, want /delta — A starved B", got)
	}
}

// TestOverflowLabelIsClosed proves the overflow value is a fixed constant, not
// derived from client input.
func TestOverflowLabelIsClosed(t *testing.T) {
	admitter := apivitals.NewRouteAdmitter("closedlabel", 1, 8)
	batch := admitter.NewBatch()
	batch.Admit("/first")
	for _, hostile := range []string{"/second", "/third", "/-attacker-controlled", "/x"} {
		if got := batch.Admit(hostile); got != apivitals.OverflowRoute {
			t.Fatalf("Admit(%q) = %q, want the closed overflow label %q",
				hostile, got, apivitals.OverflowRoute)
		}
	}
}

// TestUnadmissibleShapesNeverTakeASeries mirrors the web-vitals guard: a
// template whose first segment is an identifier is a probe, never a page.
func TestUnadmissibleShapesNeverTakeASeries(t *testing.T) {
	original := routeAdmitter
	routeAdmitter = apivitals.NewRouteAdmitter("weberrorsshape", 80, 4)
	t.Cleanup(func() { routeAdmitter = original })

	h := NewHandler()
	for i := 0; i < 10; i++ {
		if rr := postReport(t, h, fmt.Sprintf("/%d/%d", i, i+1)); rr.Code != http.StatusNoContent {
			t.Fatalf("want 204, got %d", rr.Code)
		}
	}
	if got := routeAdmitter.Size(); got != 0 {
		t.Fatalf("identifier-first routes admitted %d series, want 0", got)
	}
	if got := counterValue(t, "teslasync_frontend_label_overflow_total", map[string]string{
		"label": "weberrorsshape_route_shape",
	}); got < 1 {
		t.Fatalf("route_shape overflow counter = %v, want >= 1", got)
	}
}
