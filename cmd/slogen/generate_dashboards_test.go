package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderSLODashboard_ValidJSONAndKeyFields(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	for _, s := range cat.SLOs {
		body, err := renderSLODashboard(s)
		if err != nil {
			t.Fatalf("render %s: %v", s.Name, err)
		}
		var d map[string]any
		if err := json.Unmarshal([]byte(body), &d); err != nil {
			t.Errorf("%s: invalid JSON: %v", s.Name, err)
			continue
		}
		if d["uid"].(string) != "slo-"+s.Name {
			t.Errorf("%s: uid mismatch: %v", s.Name, d["uid"])
		}
		if !strings.Contains(body, "exemplar") {
			t.Errorf("%s: dashboard missing exemplar reference", s.Name)
		}
		if !strings.Contains(body, "slo:"+s.Name+":ratio_rate5m") {
			t.Errorf("%s: dashboard missing recording-rule reference", s.Name)
		}
	}
}

func TestRenderOverviewDashboard_OnePanelPerSLO(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	body, err := renderOverviewDashboard(cat)
	if err != nil {
		t.Fatalf("render overview: %v", err)
	}
	for _, s := range cat.SLOs {
		if !strings.Contains(body, `"`+s.Name+`"`) {
			t.Errorf("overview missing panel for %s", s.Name)
		}
	}
}

func TestLatencyPanelExpression_InheritsMethodAndRouteScope(t *testing.T) {
	t.Parallel()
	s := SLO{
		SLI: SLI{
			ValidEvents: `sum(rate(teslasync_red_http_requests_total{method="GET",route=~"/api/v1/(analytics/fsd|fleet/\{id\})",status_class!="5xx"}[5m]))`,
		},
	}

	got := latencyPanelExpression(s)
	want := `teslasync_red_http_request_duration_seconds_bucket{method="GET",route=~"/api/v1/(analytics/fsd|fleet/\{id\})"}[5m]`
	if !strings.Contains(got, want) {
		t.Fatalf("latency expression = %q, want scoped selector %q", got, want)
	}
	if strings.Contains(got, "status_class") {
		t.Errorf("latency expression must not inherit result labels: %q", got)
	}
}

func TestLatencyPanelExpression_UsesRouteScopeFromDurationDenominator(t *testing.T) {
	t.Parallel()
	s := SLO{
		SLI: SLI{
			ValidEvents: `sum(rate(teslasync_red_http_request_duration_seconds_count{route="/api/v1/analytics/fsd",method="GET"}[5m]))`,
		},
	}

	got := latencyPanelExpression(s)
	want := `teslasync_red_http_request_duration_seconds_bucket{route="/api/v1/analytics/fsd",method="GET"}[5m]`
	if !strings.Contains(got, want) {
		t.Fatalf("latency expression = %q, want %q", got, want)
	}
}

func TestLatencyPanelExpression_KeepsGlobalFallbackWithoutHTTPScope(t *testing.T) {
	t.Parallel()
	s := SLO{SLI: SLI{ValidEvents: `sum(rate(teslasync_red_http_requests_total[5m]))`}}

	got := latencyPanelExpression(s)
	want := "teslasync_red_http_request_duration_seconds_bucket[5m]"
	if !strings.Contains(got, want) {
		t.Fatalf("latency expression = %q, want global fallback %q", got, want)
	}
}

func TestRunGenerateDashboards_Idempotent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	cwd, _ := os.Getwd()
	catalog := filepath.Join(cwd, "..", "..", "slo", "catalog.yaml")

	if err := runGenerateDashboards([]string{"--catalog", catalog, "--out-dir", dir}); err != nil {
		t.Fatalf("first: %v", err)
	}
	first := snapshotDir(t, dir)
	if err := runGenerateDashboards([]string{"--catalog", catalog, "--out-dir", dir}); err != nil {
		t.Fatalf("second: %v", err)
	}
	second := snapshotDir(t, dir)
	if len(first) != len(second) {
		t.Fatalf("file count drift: %d -> %d", len(first), len(second))
	}
	for k, v := range first {
		if second[k] != v {
			t.Errorf("file %s drifted between runs", k)
		}
	}
}

func snapshotDir(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		out[e.Name()] = string(body)
	}
	return out
}
