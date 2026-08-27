package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func frontendSLO(t *testing.T, name string) SLO {
	t.Helper()
	cat := loadRealCatalogT(t)
	for _, s := range cat.SLOs {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("SLO %q not found in catalogue", name)
	return SLO{}
}

func TestFrontendSLOsExistForEveryCoreWebVital(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	want := map[string]string{
		"frontend_lcp":              "teslasync_frontend_web_vitals_lcp_seconds",
		"frontend_inp":              "teslasync_frontend_web_vitals_inp_seconds",
		"frontend_cls":              "teslasync_frontend_web_vitals_cls_ratio",
		"frontend_fcp":              "teslasync_frontend_web_vitals_fcp_seconds",
		"frontend_ttfb":             "teslasync_frontend_web_vitals_ttfb_seconds",
		"frontend_route_transition": "teslasync_frontend_route_transition_seconds",
	}
	found := map[string]SLO{}
	for _, s := range cat.SLOs {
		found[s.Name] = s
	}
	for name, metric := range want {
		s, ok := found[name]
		if !ok {
			t.Errorf("catalogue is missing SLO %q", name)
			continue
		}
		if got := sliHistogramBase(s); got != metric {
			t.Errorf("%s: SLI histogram = %q, want %q", name, got, metric)
		}
		if !hasTag(s, "frontend") {
			t.Errorf("%s: must carry the `frontend` tag so dashboards specialise", name)
		}
		if !hasTag(s, "rum") {
			t.Errorf("%s: must carry the `rum` tag", name)
		}
	}
}

// TestNoTTUCSLOUntilPagesAreWired keeps the catalogue honest.
//
// `teslasync_frontend_time_to_usable_content_seconds` is only populated when a
// page explicitly calls `markContentReady(token)`. With no wired pages the
// histogram has no samples, and slogen's ratio expression falls back to
// `vector(1)` for an empty denominator — an SLO over it would report a
// permanent 100% success and a full error budget forever. That is a dishonest
// green light, so the SLO must not exist until the readiness integration
// lands. See docs/runbooks/frontend-rum-slos.md §"Gated: TTUC readiness".
func TestNoTTUCSLOUntilPagesAreWired(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	for _, s := range cat.SLOs {
		if s.Name == "frontend_time_to_usable_content" {
			t.Fatal("frontend_time_to_usable_content SLO exists; only add it in the same change that wires markContentReady() into pages")
		}
		if strings.Contains(s.SLI.GoodEvents, "time_to_usable_content") ||
			strings.Contains(s.SLI.ValidEvents, "time_to_usable_content") {
			t.Fatalf("SLO %q builds on the un-wired TTUC histogram", s.Name)
		}
	}
}

// TestFrontendSLOThresholdsUseCorrectUnits guards the single most damaging
// failure mode for these SLOs: a millisecond threshold written against a
// `_seconds` histogram (or vice versa) silently reports 100% success forever.
func TestFrontendSLOThresholdsUseCorrectUnits(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"frontend_lcp":              `le="2.5"`,
		"frontend_inp":              `le="0.2"`,
		"frontend_cls":              `le="0.1"`,
		"frontend_fcp":              `le="1.8"`,
		"frontend_ttfb":             `le="0.8"`,
		"frontend_route_transition": `le="0.5"`,
	}
	for name, threshold := range cases {
		s := frontendSLO(t, name)
		if !strings.Contains(s.SLI.GoodEvents, threshold) {
			t.Errorf("%s: good_events %q does not use threshold %s", name, s.SLI.GoodEvents, threshold)
		}
		base := sliHistogramBase(s)
		if !strings.Contains(s.SLI.ValidEvents, base+"_count") {
			t.Errorf("%s: valid_events must use %s_count, got %q", name, base, s.SLI.ValidEvents)
		}
		if name == "frontend_cls" {
			if strings.HasSuffix(base, "_seconds") {
				t.Errorf("frontend_cls must use a unitless histogram, got %q", base)
			}
			continue
		}
		if !strings.HasSuffix(base, "_seconds") {
			t.Errorf("%s: time-based SLO must target a _seconds histogram, got %q", name, base)
		}
	}
}

func TestFrontendDashboardHasReleaseAnnotationAndRUMPanels(t *testing.T) {
	t.Parallel()
	s := frontendSLO(t, "frontend_lcp")
	body, err := renderSLODashboard(s)
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	var d map[string]any
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	annotations, ok := d["annotations"].(map[string]any)
	if !ok {
		t.Fatal("dashboard has no annotations block")
	}
	list, ok := annotations["list"].([]any)
	if !ok || len(list) == 0 {
		t.Fatal("frontend dashboard must carry a release annotation")
	}
	first := list[0].(map[string]any)
	if first["expr"] != releaseAnnotationExpr {
		t.Errorf("annotation expr = %v, want %v", first["expr"], releaseAnnotationExpr)
	}
	if first["tagKeys"] != "release" {
		t.Errorf("annotation tagKeys = %v, want release", first["tagKeys"])
	}

	if !strings.Contains(body, "teslasync_frontend_web_vitals_lcp_seconds_bucket") {
		t.Error("frontend dashboard must chart its own RUM histogram, not the HTTP RED histogram")
	}
	if strings.Contains(body, "teslasync_red_http_request_duration_seconds_bucket") {
		t.Error("frontend dashboard must not fall back to the generic HTTP latency panel")
	}
	if !strings.Contains(body, "{{route}}") {
		t.Error("frontend dashboard must break the histogram down by route template")
	}
}

// TestNonFrontendDashboardsUnchanged proves the specialisation is opt-in: a
// backend SLO keeps the generic panel set and an empty annotation list, so
// regenerating the catalogue never churns unrelated dashboards.
func TestNonFrontendDashboardsUnchanged(t *testing.T) {
	t.Parallel()
	s := frontendSLO(t, "api_availability")
	body, err := renderSLODashboard(s)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(body, "teslasync_red_http_request_duration_seconds_bucket") {
		t.Error("non-frontend dashboard lost its generic latency panel")
	}
	if strings.Contains(body, releaseAnnotationExpr) {
		t.Error("non-frontend dashboard must not gain the frontend release annotation")
	}
}

func TestSLIHistogramBase(t *testing.T) {
	t.Parallel()
	tests := []struct {
		expr string
		want string
	}{
		{`sum(rate(teslasync_frontend_web_vitals_lcp_seconds_bucket{le="2.5"}[5m]))`, "teslasync_frontend_web_vitals_lcp_seconds"},
		{`sum(rate(teslasync_frontend_web_vitals_cls_ratio_bucket{le="0.1"}[5m]))`, "teslasync_frontend_web_vitals_cls_ratio"},
		{`sum(rate(teslasync_red_http_requests_total[5m]))`, ""},
	}
	for _, tt := range tests {
		got := sliHistogramBase(SLO{SLI: SLI{GoodEvents: tt.expr}})
		if got != tt.want {
			t.Errorf("sliHistogramBase(%q) = %q, want %q", tt.expr, got, tt.want)
		}
	}
}

func TestFrontendPanelUnit(t *testing.T) {
	t.Parallel()
	if got := frontendPanelUnit("teslasync_frontend_web_vitals_cls_ratio"); got != "none" {
		t.Errorf("CLS unit = %q, want none", got)
	}
	if got := frontendPanelUnit("teslasync_frontend_web_vitals_lcp_seconds"); got != "s" {
		t.Errorf("LCP unit = %q, want s", got)
	}
}

// TestReleaseAnnotationCarriesNoCredentials guards requirement: dashboards are
// checked into git and rendered into a ConfigMap; they must never embed a
// token, password or external URL with auth material.
func TestReleaseAnnotationCarriesNoCredentials(t *testing.T) {
	t.Parallel()
	blob, err := json.Marshal(releaseAnnotations())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	lowered := strings.ToLower(string(blob))
	for _, forbidden := range []string{"password", "token", "apikey", "api_key", "secret", "basicauth", "bearer", "://"} {
		if strings.Contains(lowered, forbidden) {
			t.Errorf("release annotation contains forbidden material %q: %s", forbidden, blob)
		}
	}
}
