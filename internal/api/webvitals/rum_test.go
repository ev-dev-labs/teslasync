package webvitals

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

func postBatch(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/web-vitals", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	NewHandler().Ingest(rr, req)
	return rr
}

// gatherFamily returns the gathered metric family with the given fully
// qualified name, or nil when it is not registered.
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

// histogramSum returns the observed sum for a histogram family filtered to
// the supplied label pairs. Missing series report 0.
func histogramSum(t *testing.T, family string, want map[string]string) float64 {
	t.Helper()
	f := gatherFamily(t, family)
	if f == nil {
		return 0
	}
	var total float64
	for _, m := range f.GetMetric() {
		if !labelsMatch(m.GetLabel(), want) {
			continue
		}
		total += m.GetHistogram().GetSampleSum()
	}
	return total
}

func counterValue(t *testing.T, family string, want map[string]string) float64 {
	t.Helper()
	f := gatherFamily(t, family)
	if f == nil {
		return 0
	}
	var total float64
	for _, m := range f.GetMetric() {
		if !labelsMatch(m.GetLabel(), want) {
			continue
		}
		total += m.GetCounter().GetValue()
	}
	return total
}

func gaugeValue(t *testing.T, family string, want map[string]string) (float64, bool) {
	t.Helper()
	f := gatherFamily(t, family)
	if f == nil {
		return 0, false
	}
	for _, m := range f.GetMetric() {
		if labelsMatch(m.GetLabel(), want) {
			return m.GetGauge().GetValue(), true
		}
	}
	return 0, false
}

func labelsMatch(pairs []*dto.LabelPair, want map[string]string) bool {
	got := make(map[string]string, len(pairs))
	for _, p := range pairs {
		got[p.GetName()] = p.GetValue()
	}
	for k, v := range want {
		if got[k] != v {
			return false
		}
	}
	return true
}

// touchAllRUMMetrics drives one sample through every metric family so the
// lazily-created label sets exist before a Gather() assertion.
func touchAllRUMMetrics(t *testing.T) {
	t.Helper()
	postBatch(t, `{"context":{"device":"desktop","connection":"3g","release":"0.0.1","theme":"light"},
		"metrics":[
			{"name":"LCP","value":1000,"id":"a","rating":"good","route":"/reg","ts":0},
			{"name":"INP","value":100,"id":"b","rating":"good","route":"/reg","ts":0},
			{"name":"CLS","value":0.02,"id":"c","rating":"good","route":"/reg","ts":0},
			{"name":"FCP","value":700,"id":"d","rating":"good","route":"/reg","ts":0},
			{"name":"TTFB","value":80,"id":"e","rating":"good","route":"/reg","ts":0},
			{"name":"RouteChange","value":200,"id":"f","rating":"good","route":"/reg","ts":0},
			{"name":"TTUC","value":900,"id":"g","rating":"good","route":"/reg","ts":0}],
		"events":[{"kind":"user_action","outcome":"success","route":"/reg"}]}`)
	postBatch(t, `{"metrics":[{"name":"NOPE","value":1,"id":"z","rating":"good","route":"/reg","ts":0}]}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload validation
// ─────────────────────────────────────────────────────────────────────────────

func TestIngest_AcceptsContextAndEvents(t *testing.T) {
	body := `{
		"context":{"device":"mobile","connection":"4g","release":"1.4.2","theme":"dark"},
		"metrics":[{"name":"LCP","value":1500,"id":"a","rating":"good","route":"/ctxtest","ts":1}],
		"events":[{"kind":"query","outcome":"failure","route":"/ctxtest"}]
	}`
	rr := postBatch(t, body)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d (%s)", rr.Code, rr.Body.String())
	}

	if got := histogramSum(t, "teslasync_frontend_web_vitals_lcp_seconds", map[string]string{"route": "/ctxtest"}); got != 1.5 {
		t.Errorf("lcp seconds sum = %v, want 1.5 (ms must be divided by 1000)", got)
	}
	if got := counterValue(t, "teslasync_frontend_web_vitals_samples_total", map[string]string{
		"name": "LCP", "rating": "good", "device": "mobile", "connection": "4g", "theme": "dark",
	}); got < 1 {
		t.Errorf("dimension counter = %v, want >= 1", got)
	}
	if got := counterValue(t, "teslasync_frontend_ux_events_total", map[string]string{
		"kind": "query", "outcome": "failure", "route": "/ctxtest",
	}); got != 1 {
		t.Errorf("ux events counter = %v, want 1", got)
	}
}

func TestIngest_EventsOnlyBatchAccepted(t *testing.T) {
	rr := postBatch(t, `{"events":[{"kind":"cache","outcome":"hit","route":"/eventsonly","count":5}]}`)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d (%s)", rr.Code, rr.Body.String())
	}
	if got := counterValue(t, "teslasync_frontend_ux_events_total", map[string]string{
		"kind": "cache", "outcome": "hit", "route": "/eventsonly",
	}); got != 5 {
		t.Errorf("ux events counter = %v, want 5", got)
	}
}

func TestIngest_RejectsEmptyMetricsAndEvents(t *testing.T) {
	if rr := postBatch(t, `{"metrics":[],"events":[]}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestIngest_RejectsOversizedEventBatch(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"events":[`)
	for i := 0; i <= maxEventsPerBatch; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(`{"kind":"retry","outcome":"retried","route":"/x"}`)
	}
	sb.WriteString(`]}`)
	if rr := postBatch(t, sb.String()); rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestIngest_RejectsUnknownContextField(t *testing.T) {
	body := `{"context":{"device":"mobile","ipAddress":"1.2.3.4"},"metrics":[{"name":"LCP","value":1,"id":"a","rating":"good","route":"/","ts":0}]}`
	if rr := postBatch(t, body); rr.Code != http.StatusBadRequest {
		t.Fatalf("unknown context field must be rejected; got %d", rr.Code)
	}
}

func TestIngest_RejectsUnknownUXKindAndOutcome(t *testing.T) {
	before := counterValue(t, "teslasync_web_vitals_samples_rejected_total", map[string]string{"reason": "unknown_ux_kind"})
	// Nothing in this batch is valid, so the whole batch is refused (400) and
	// no cardinality capacity is consumed.
	rr := postBatch(t, `{"events":[{"kind":"exfiltrate","outcome":"success","route":"/"},{"kind":"query","outcome":"weird","route":"/"}]}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
	after := counterValue(t, "teslasync_web_vitals_samples_rejected_total", map[string]string{"reason": "unknown_ux_kind"})
	if after <= before {
		t.Errorf("unknown_ux_kind rejection counter did not advance (%v -> %v)", before, after)
	}
	if got := counterValue(t, "teslasync_web_vitals_samples_rejected_total", map[string]string{"reason": "unknown_ux_outcome"}); got < 1 {
		t.Errorf("unknown_ux_outcome counter = %v, want >= 1", got)
	}

	// A mixed batch still succeeds and records only the valid event.
	if rr := postBatch(t, `{"events":[{"kind":"nope","outcome":"success","route":"/mixedux"},{"kind":"retry","outcome":"retried","route":"/mixedux"}]}`); rr.Code != http.StatusNoContent {
		t.Fatalf("mixed batch: want 204, got %d", rr.Code)
	}
	if got := counterValue(t, "teslasync_frontend_ux_events_total", map[string]string{
		"kind": "retry", "outcome": "retried", "route": "/mixedux",
	}); got != 1 {
		t.Errorf("valid event in mixed batch = %v, want 1", got)
	}
}

func TestIngest_RejectsOutOfRangeAndNegativeValues(t *testing.T) {
	rr := postBatch(t, `{"metrics":[
		{"name":"LCP","value":-1,"id":"a","rating":"good","route":"/range","ts":0},
		{"name":"LCP","value":999999999,"id":"b","rating":"good","route":"/range","ts":0},
		{"name":"CLS","value":1000,"id":"c","rating":"poor","route":"/range","ts":0}
	]}`)
	// Every sample is invalid, so the batch is refused outright.
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
	if got := histogramSum(t, "teslasync_frontend_web_vitals_lcp_seconds", map[string]string{"route": "/range"}); got != 0 {
		t.Errorf("out-of-range LCP samples were observed (sum=%v)", got)
	}
	for _, reason := range []string{"negative_value", "value_out_of_range"} {
		if got := counterValue(t, "teslasync_web_vitals_samples_rejected_total", map[string]string{"reason": reason}); got < 1 {
			t.Errorf("reason %q counter = %v, want >= 1", reason, got)
		}
	}
}

func TestObserveVital_RejectsNonFiniteValues(t *testing.T) {
	dims := dimensions{Device: unknownLabel, Connection: unknownLabel, Theme: unknownLabel, Release: unknownLabel}
	for _, v := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		ok, reason := observeVital(MetricLCP, v, "good", "/nonfinite", dims)
		if ok {
			t.Fatalf("observeVital accepted non-finite value %v", v)
		}
		if reason != "non_finite_value" && reason != "negative_value" {
			t.Fatalf("value %v: reason = %q", v, reason)
		}
	}
}

func TestIngest_NavigationMetricsRecorded(t *testing.T) {
	rr := postBatch(t, `{"metrics":[
		{"name":"RouteChange","value":320,"id":"n1","rating":"good","route":"/nav","ts":0},
		{"name":"TTUC","value":1250,"id":"n2","rating":"good","route":"/nav","ts":0}
	]}`)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d (%s)", rr.Code, rr.Body.String())
	}
	if got := histogramSum(t, "teslasync_frontend_route_transition_seconds", map[string]string{"route": "/nav"}); got != 0.32 {
		t.Errorf("route transition sum = %v, want 0.32", got)
	}
	if got := histogramSum(t, "teslasync_frontend_time_to_usable_content_seconds", map[string]string{"route": "/nav"}); got != 1.25 {
		t.Errorf("TTUC sum = %v, want 1.25", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy
// ─────────────────────────────────────────────────────────────────────────────

func TestNormalizeRoute_PrivacyRedaction(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"vin redacted", "/vehicles/5YJ3E1EA7JF000316", "/vehicles/:id"},
		{"vin lowercase redacted", "/vehicles/5yj3e1ea7jf000316", "/vehicles/:id"},
		{"coordinate pair redacted", "/map/37.7749,-122.4194", "/map/:id"},
		{"single coordinate redacted", "/map/37.7749", "/map/:id"},
		{"email redacted", "/user/jane.doe@example.com", "/user/:id"},
		{"percent encoded redacted", "/search/%2Fsecret", "/search/:id"},
		{"share token redacted", "/share/aB3xQ9zL2mK7", "/share/:id"},
		{"numeric id redacted", "/drives/123", "/drives/:id"},
		{"uuid redacted", "/charging/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "/charging/:id"},
		{"absolute url authority stripped", "https://tenant.example.com/dashboard", "/dashboard"},
		{"query string stripped", "/dashboard?vin=5YJ3E1EA7JF000316", "/dashboard"},
		{"fragment stripped", "/dashboard#lat=37.7", "/dashboard"},
		{"unicode segment redacted", "/search/Berlin Straße", "/search/:id"},
		{"safe nested route preserved", "/analytics/battery-degradation", "/analytics/battery-degradation"},
		// Defence in depth: a share token is a hyphenated word with no digits,
		// indistinguishable by shape from a real page name. The `/s/{token}`
		// parameter position is therefore pinned. The SPA already templates
		// this client-side (web/src/lib/routeTemplate.ts); this guards a
		// hand-rolled or stale client.
		{"share token pinned by route template", "/s/share-token-abc", "/s/:id"},
		{"share token uppercase pinned", "/s/ShareTokenAbc", "/s/:id"},
		{"share token with query pinned", "/s/share-token-abc?secret=1", "/s/:id"},
		{"share route root untouched", "/s", "/s"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeRoute(tt.in); got != tt.want {
				t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeRoute_DepthCapped(t *testing.T) {
	got := NormalizeRoute("/a/b/c/d/e/f/g/h/i")
	segments := strings.Count(got, "/")
	if segments > maxRouteSegments {
		t.Errorf("NormalizeRoute kept %d segments (%q), want <= %d", segments, got, maxRouteSegments)
	}
}

func TestNormalizeRoute_NeverLeaksRawIdentifiers(t *testing.T) {
	// Property-style guard: no normalised route may contain a digit run of
	// four or more characters (the shortest plausible entity ID) or an "@".
	inputs := []string{
		"/drives/48291/telemetry",
		"/vehicles/5YJ3E1EA7JF000316/battery",
		"/share/6f1a4c2b9e8d7f0a1b2c3d4e5f60718293a4b5c6",
		"/user/ops@example.com/settings",
		"/map/37.774900,-122.419400",
	}
	longDigits := regexp.MustCompile(`\d{4,}`)
	for _, in := range inputs {
		got := NormalizeRoute(in)
		if longDigits.MatchString(got) {
			t.Errorf("NormalizeRoute(%q) = %q leaked a digit run", in, got)
		}
		if strings.Contains(got, "@") {
			t.Errorf("NormalizeRoute(%q) = %q leaked an e-mail", in, got)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Cardinality bounds
// ─────────────────────────────────────────────────────────────────────────────

func TestBoundedRegistry_CapsDistinctValues(t *testing.T) {
	r := newBoundedRegistry("test_label", 3, "__overflow__")
	for _, v := range []string{"a", "b", "c"} {
		if got := r.Admit(v, nil); got != v {
			t.Fatalf("Admit(%q) = %q, want passthrough", v, got)
		}
	}
	if got := r.Admit("d", nil); got != "__overflow__" {
		t.Fatalf("Admit(\"d\") = %q, want overflow", got)
	}
	// Admission is sticky — an already-admitted value never flaps.
	if got := r.Admit("a", nil); got != "a" {
		t.Fatalf("Admit(\"a\") after overflow = %q, want \"a\"", got)
	}
	if r.Size() != 3 {
		t.Fatalf("Size() = %d, want 3", r.Size())
	}
}

func TestBoundedRegistry_PerRequestBudget(t *testing.T) {
	r := newBoundedRegistry("test_budget", 100, "__overflow__")
	budget := newAdmissionBudget(2)

	if got := r.Admit("a", budget); got != "a" {
		t.Fatalf("first admit = %q", got)
	}
	if got := r.Admit("b", budget); got != "b" {
		t.Fatalf("second admit = %q", got)
	}
	// Third NEW value exceeds the per-request budget even though the global
	// cap has plenty of room.
	if got := r.Admit("c", budget); got != "__overflow__" {
		t.Fatalf("third admit = %q, want overflow", got)
	}
	if r.Size() != 2 {
		t.Fatalf("budget-exceeded value was still admitted: size=%d", r.Size())
	}
	// Already-admitted values keep passing through without spending budget.
	if got := r.Admit("a", budget); got != "a" {
		t.Fatalf("repeat admit = %q", got)
	}
}

func TestIngest_RouteCardinalityIsBounded(t *testing.T) {
	original := defaultRouteAdmitter
	defaultRouteAdmitter = NewRouteAdmitter("", 2, maxNewRoutesPerBatch)
	t.Cleanup(func() { defaultRouteAdmitter = original })

	for i := 0; i < 25; i++ {
		body := `{"metrics":[{"name":"FCP","value":100,"id":"x","rating":"good","route":"/card` + string(rune('a'+i%25)) + `","ts":0}]}`
		if rr := postBatch(t, body); rr.Code != http.StatusNoContent {
			t.Fatalf("want 204, got %d", rr.Code)
		}
	}
	if got := defaultRouteAdmitter.Size(); got > 2 {
		t.Fatalf("route registry admitted %d routes, want <= 2", got)
	}
	if got := histogramSum(t, "teslasync_frontend_web_vitals_fcp_seconds", map[string]string{"route": overflowRoute}); got == 0 {
		t.Fatalf("overflow route bucket received no samples")
	}
	if got := counterValue(t, "teslasync_frontend_label_overflow_total", map[string]string{"label": "route"}); got < 1 {
		t.Fatalf("label overflow counter = %v, want >= 1", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Abuse: an anonymous caller must not be able to consume cardinality capacity
// or mint deployment annotations with a batch that carries nothing valid.
// ─────────────────────────────────────────────────────────────────────────────

func TestIngest_InvalidBatchConsumesNoRouteCapacity(t *testing.T) {
	originalRoutes := defaultRouteAdmitter
	originalReleases := releaseRegistry
	defaultRouteAdmitter = NewRouteAdmitter("", 80, maxNewRoutesPerBatch)
	releaseRegistry = newReleaseRegistry()
	t.Cleanup(func() {
		defaultRouteAdmitter = originalRoutes
		releaseRegistry = originalReleases
	})

	// 50 requests, each with a unique route and a unique release, none of
	// which contains a single valid sample.
	for i := 0; i < 50; i++ {
		body := fmt.Sprintf(
			`{"context":{"release":"9.9.%d"},"metrics":[{"name":"NOTAVITAL","value":1,"id":"x","rating":"good","route":"/abuse-%d","ts":0}]}`,
			i, i,
		)
		if rr := postBatch(t, body); rr.Code != http.StatusBadRequest {
			t.Fatalf("request %d: want 400, got %d", i, rr.Code)
		}
	}

	if got := defaultRouteAdmitter.Size(); got != 0 {
		t.Errorf("invalid batches admitted %d routes, want 0", got)
	}
	if got := releaseRegistry.Size(); got != 0 {
		t.Errorf("invalid batches admitted %d releases, want 0", got)
	}
	if f := gatherFamily(t, "teslasync_frontend_release_info"); f != nil {
		for _, m := range f.GetMetric() {
			for _, l := range m.GetLabel() {
				if strings.HasPrefix(l.GetValue(), "9.9.") {
					t.Errorf("invalid batch published a release annotation for %q", l.GetValue())
				}
			}
		}
	}
	if got := counterValue(t, "teslasync_web_vitals_batches_rejected_total", nil); got < 50 {
		t.Errorf("batches_rejected_total = %v, want >= 50", got)
	}
}

func TestIngest_SingleBatchCannotAdmitManyRoutes(t *testing.T) {
	original := defaultRouteAdmitter
	defaultRouteAdmitter = NewRouteAdmitter("", 80, maxNewRoutesPerBatch)
	t.Cleanup(func() { defaultRouteAdmitter = original })

	var sb strings.Builder
	sb.WriteString(`{"metrics":[`)
	for i := 0; i < 40; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		fmt.Fprintf(&sb, `{"name":"LCP","value":1000,"id":"x","rating":"good","route":"/burst-%c","ts":0}`, rune('a'+i%26))
	}
	sb.WriteString(`]}`)

	if rr := postBatch(t, sb.String()); rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
	if got := defaultRouteAdmitter.Size(); got > maxNewRoutesPerBatch {
		t.Fatalf("one batch admitted %d routes, want <= %d", got, maxNewRoutesPerBatch)
	}
	if got := counterValue(t, "teslasync_frontend_label_overflow_total", map[string]string{"label": "route_batch_budget"}); got < 1 {
		t.Fatalf("per-batch budget overflow counter = %v, want >= 1", got)
	}
}

func TestIngest_ReleaseAdmittedOnlyAfterAcceptedContent(t *testing.T) {
	original := releaseRegistry
	releaseRegistry = newReleaseRegistry()
	t.Cleanup(func() { releaseRegistry = original })

	// Invalid content — release must not be admitted.
	if rr := postBatch(t, `{"context":{"release":"7.7.7-invalid"},"metrics":[{"name":"BOGUS","value":1,"id":"x","rating":"good","route":"/rel-gate","ts":0}]}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
	if releaseRegistry.Size() != 0 {
		t.Fatalf("release admitted from an invalid batch")
	}

	// Valid content — release is admitted and annotated.
	if rr := postBatch(t, `{"context":{"release":"7.7.8-valid"},"metrics":[{"name":"LCP","value":1000,"id":"x","rating":"good","route":"/rel-gate","ts":0}]}`); rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
	if releaseRegistry.Size() != 1 {
		t.Fatalf("release registry size = %d, want 1", releaseRegistry.Size())
	}
	if _, ok := gaugeValue(t, "teslasync_frontend_release_info", map[string]string{"release": "7.7.8-valid"}); !ok {
		t.Fatalf("valid batch did not publish the release annotation")
	}
}

func TestIsAdmissibleRouteTemplate(t *testing.T) {
	tests := []struct {
		route string
		want  bool
	}{
		{"/", true},
		{"/dashboard", true},
		{"/drives/:id", true},
		{"/analytics/battery-degradation", true},
		{"/drives/:id/telemetry", true},
		// A template that begins with an identifier is never a real SPA route.
		{"/:id", false},
		{"/:id/:id", false},
		{"/:id/dashboard", false},
		{overflowRoute, false},
		{"dashboard", false},
	}
	for _, tt := range tests {
		if got := isAdmissibleRouteTemplate(tt.route); got != tt.want {
			t.Errorf("isAdmissibleRouteTemplate(%q) = %v, want %v", tt.route, got, tt.want)
		}
	}
}

func TestIngest_IdentifierOnlyRoutesNeverAdmitted(t *testing.T) {
	original := defaultRouteAdmitter
	defaultRouteAdmitter = NewRouteAdmitter("", 80, maxNewRoutesPerBatch)
	t.Cleanup(func() { defaultRouteAdmitter = original })

	for i := 0; i < 20; i++ {
		body := fmt.Sprintf(
			`{"metrics":[{"name":"LCP","value":1000,"id":"x","rating":"good","route":"/%d/%d/%d","ts":0}]}`,
			i, i+1, i+2,
		)
		if rr := postBatch(t, body); rr.Code != http.StatusNoContent {
			t.Fatalf("want 204, got %d", rr.Code)
		}
	}
	if got := defaultRouteAdmitter.Size(); got != 0 {
		t.Fatalf("identifier-only routes admitted %d series, want 0", got)
	}
	if got := counterValue(t, "teslasync_frontend_label_overflow_total", map[string]string{"label": "route_shape"}); got < 1 {
		t.Fatalf("route_shape overflow counter = %v, want >= 1", got)
	}
}

func TestNormalizeDimensions_ClosedSets(t *testing.T) {
	tests := []struct {
		fn   func(string) string
		in   string
		want string
	}{
		{normalizeDevice, "mobile", "mobile"},
		{normalizeDevice, "MOBILE", "mobile"},
		{normalizeDevice, "smart-fridge", unknownLabel},
		{normalizeDevice, "", unknownLabel},
		{normalizeConnection, "slow-2g", "slow-2g"},
		{normalizeConnection, "6g", unknownLabel},
		{normalizeTheme, "light", "light"},
		{normalizeTheme, "solarized", unknownLabel},
		{normalizeRating, "needs-improvement", "needs-improvement"},
		{normalizeRating, "weird", unknownLabel},
	}
	for _, tt := range tests {
		if got := tt.fn(tt.in); got != tt.want {
			t.Errorf("normalize(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestNormalizeRelease_ValidatesAndCaps(t *testing.T) {
	original := releaseRegistry
	releaseRegistry = newBoundedRegistry("release", 2, overflowRelease)
	t.Cleanup(func() { releaseRegistry = original })

	if got := normalizeRelease("1.4.2"); got != "1.4.2" {
		t.Errorf("normalizeRelease(\"1.4.2\") = %q", got)
	}
	if got := normalizeRelease("2.0.0-rc.1+build7"); got != "2.0.0-rc.1+build7" {
		t.Errorf("normalizeRelease semver+build = %q", got)
	}
	if got := normalizeRelease("3.0.0"); got != overflowRelease {
		t.Errorf("third release = %q, want %q", got, overflowRelease)
	}
	for _, bad := range []string{"", "  ", "rel;DROP TABLE", strings.Repeat("v", maxReleaseLabelLength+1), "<script>"} {
		if got := normalizeRelease(bad); got != unknownLabel {
			t.Errorf("normalizeRelease(%q) = %q, want %q", bad, got, unknownLabel)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Release / deployment annotations
// ─────────────────────────────────────────────────────────────────────────────

func TestReleaseAnnotationGaugesPublished(t *testing.T) {
	originalNow := nowFunc
	fixed := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	nowFunc = func() time.Time { return fixed }
	original := releaseRegistry
	releaseRegistry = newReleaseRegistry()
	t.Cleanup(func() {
		releaseRegistry = original
		nowFunc = originalNow
	})

	body := `{"context":{"release":"9.9.9-annotation"},"metrics":[{"name":"TTFB","value":90,"id":"r","rating":"good","route":"/rel","ts":0}]}`
	if rr := postBatch(t, body); rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}

	if v, ok := gaugeValue(t, "teslasync_frontend_release_info", map[string]string{"release": "9.9.9-annotation"}); !ok || v != 1 {
		t.Errorf("release_info = %v (present=%v), want 1", v, ok)
	}
	v, ok := gaugeValue(t, "teslasync_frontend_release_first_seen_timestamp_seconds", map[string]string{"release": "9.9.9-annotation"})
	if !ok {
		t.Fatal("release_first_seen_timestamp_seconds not published")
	}
	if v != float64(fixed.Unix()) {
		t.Errorf("first seen timestamp = %v, want %v", v, float64(fixed.Unix()))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus registration
// ─────────────────────────────────────────────────────────────────────────────

func TestAllRUMMetricsAreRegistered(t *testing.T) {
	want := []string{
		"teslasync_frontend_web_vitals_lcp_seconds",
		"teslasync_frontend_web_vitals_inp_seconds",
		"teslasync_frontend_web_vitals_cls_ratio",
		"teslasync_frontend_web_vitals_fcp_seconds",
		"teslasync_frontend_web_vitals_ttfb_seconds",
		"teslasync_frontend_route_transition_seconds",
		"teslasync_frontend_time_to_usable_content_seconds",
		"teslasync_frontend_web_vitals_samples_total",
		"teslasync_frontend_ux_events_total",
		"teslasync_frontend_release_info",
		"teslasync_frontend_release_first_seen_timestamp_seconds",
		"teslasync_frontend_label_overflow_total",
		"teslasync_web_vitals_batches_ingested_total",
		"teslasync_web_vitals_samples_ingested_total",
		"teslasync_web_vitals_samples_rejected_total",
		"teslasync_web_vitals_batches_rejected_total",
		"teslasync_web_vitals_value",
	}
	touchAllRUMMetrics(t)

	for _, name := range want {
		if gatherFamily(t, name) == nil {
			t.Errorf("metric family %q is not registered/exported", name)
		}
	}
}

func TestVitalsSpecsCoverEveryAcceptedName(t *testing.T) {
	for _, name := range []string{MetricLCP, MetricINP, MetricCLS, MetricFCP, MetricTTFB, MetricRouteChange, MetricTTUC} {
		if _, ok := vitalsSpecs[name]; !ok {
			t.Errorf("vitalsSpecs missing accepted metric %q", name)
		}
	}
	if len(vitalsSpecs) != 7 {
		t.Errorf("vitalsSpecs has %d entries; update the closed set deliberately", len(vitalsSpecs))
	}
}

func TestTimeMetricsUseSecondsUnit(t *testing.T) {
	// Every time-based spec must divide by 1000 so the exported `_seconds`
	// family really is seconds and matches the SLO thresholds.
	for name, spec := range vitalsSpecs {
		if name == MetricCLS {
			if spec.divisor != 1 {
				t.Errorf("CLS divisor = %v, want 1 (unitless score)", spec.divisor)
			}
			continue
		}
		if spec.divisor != 1000 {
			t.Errorf("%s divisor = %v, want 1000 (ms -> s)", name, spec.divisor)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SLO catalogue contract
// ─────────────────────────────────────────────────────────────────────────────

// TestSLOCatalogReferencesRegisteredMetrics is the guard that stops an SLO
// from silently pointing at a metric that no longer exists (the failure mode
// that left `frontend_lcp` querying a non-existent series). Every
// `teslasync_frontend_*` identifier used in slo/catalog.yaml must resolve to a
// registered Prometheus family.
func TestSLOCatalogReferencesRegisteredMetrics(t *testing.T) {
	path := filepath.Join("..", "..", "..", "slo", "catalog.yaml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("SLO catalog not readable from this working directory: %v", err)
	}
	// Ensure the families exist before gathering.
	touchAllRUMMetrics(t)

	ref := regexp.MustCompile(`teslasync_frontend_[a-z0-9_]+`)
	suffixes := []string{"_bucket", "_count", "_sum"}
	seen := map[string]struct{}{}
	for _, match := range ref.FindAllString(string(raw), -1) {
		base := match
		for _, s := range suffixes {
			if strings.HasSuffix(base, s) {
				base = strings.TrimSuffix(base, s)
				break
			}
		}
		seen[base] = struct{}{}
	}
	if len(seen) == 0 {
		t.Fatal("no teslasync_frontend_* metrics referenced by slo/catalog.yaml")
	}
	for name := range seen {
		if gatherFamily(t, name) == nil {
			t.Errorf("slo/catalog.yaml references %q but no such Prometheus family is registered", name)
		}
	}
}

// TestIngestPayloadRoundTripsWireContract locks the JSON wire contract so a
// frontend change that renames a field fails here rather than silently
// dropping telemetry in production.
func TestIngestPayloadRoundTripsWireContract(t *testing.T) {
	in := webVitalsBatch{
		Context: &clientContext{Device: "tablet", Connection: "5g", Release: "1.0.0", Theme: "light"},
		Metrics: []webVitalsMetric{{
			Name: MetricLCP, Value: 1200, ID: "id", Rating: "good",
			NavigationType: "navigate", Route: "/wire", TsMs: 12,
		}},
		Events: []uxEvent{{Kind: "retry", Outcome: "retried", Route: "/wire", Count: 2}},
	}
	blob, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, key := range []string{
		`"context"`, `"device"`, `"connection"`, `"release"`, `"theme"`,
		`"metrics"`, `"name"`, `"value"`, `"rating"`, `"navigationType"`, `"route"`, `"ts"`,
		`"events"`, `"kind"`, `"outcome"`, `"count"`,
	} {
		if !strings.Contains(string(blob), key) {
			t.Errorf("wire contract missing key %s in %s", key, blob)
		}
	}
	if rr := postBatch(t, string(blob)); rr.Code != http.StatusNoContent {
		t.Fatalf("round-tripped payload rejected: %d (%s)", rr.Code, rr.Body.String())
	}
}
