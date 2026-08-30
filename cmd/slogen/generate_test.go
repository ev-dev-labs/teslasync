package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderRecordingRules_Idempotent(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	a := renderRecordingRules(cat)
	b := renderRecordingRules(cat)
	if a != b {
		t.Fatalf("renderRecordingRules not deterministic")
	}
}

func TestRenderRecordingRules_AllSLOsAndWindows(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	out := renderRecordingRules(cat)
	for _, s := range cat.SLOs {
		for _, w := range recordingWindows {
			rec := "slo:" + s.Name + ":" + w.suffix
			if !strings.Contains(out, rec) {
				t.Errorf("missing recording rule %s", rec)
			}
		}
	}
}

func TestRewriteWindow_RewritesRangeAndSubquery(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, win, want string
	}{
		{"sum(rate(x[5m]))", "1h", "sum(rate(x[1h]))"},
		{"sum_over_time((y == 0)[5m:30s])", "30d", "sum_over_time((y == 0)[30d:30s])"},
		{"sum(rate(x[5m])) + sum_over_time(z[5m:30s])", "6h", "sum(rate(x[6h])) + sum_over_time(z[6h:30s])"},
	}
	for _, tc := range cases {
		if got := rewriteWindow(tc.in, tc.win); got != tc.want {
			t.Errorf("rewriteWindow(%q, %q) = %q, want %q", tc.in, tc.win, got, tc.want)
		}
	}
}

func TestRatioExprPreservesLowTrafficAndTreatsNoTrafficAsHealthy(t *testing.T) {
	t.Parallel()
	s := SLO{
		Name: "low_traffic",
		SLI: SLI{
			GoodEvents:  "sum(rate(good[5m]))",
			ValidEvents: "sum(rate(valid[5m]))",
		},
	}

	got := ratioExpr(s, "1h")
	if strings.Contains(got, "clamp_min") {
		t.Fatalf("ratio still contains a traffic-rate floor: %s", got)
	}
	for _, want := range []string{
		"sum(rate(good[1h]))",
		"sum(rate(valid[1h]))",
		"and on()",
		"or on() vector(1)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("ratio %q missing %q", got, want)
		}
	}
}

func TestRunGenerateRecording_IdempotentOnDisk(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	out := filepath.Join(dir, "recording-rules.yaml")
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	catalog := filepath.Join(cwd, "..", "..", "slo", "catalog.yaml")

	if err := runGenerateRecording([]string{"--catalog", catalog, "--out", out}); err != nil {
		t.Fatalf("first run: %v", err)
	}
	first, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read first: %v", err)
	}
	if err := runGenerateRecording([]string{"--catalog", catalog, "--out", out}); err != nil {
		t.Fatalf("second run: %v", err)
	}
	second, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read second: %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("codegen not byte-stable across runs")
	}
}

func TestQuoteScalar_EscapesQuotesAndBackslashes(t *testing.T) {
	t.Parallel()
	got := quoteScalar(`a"b\c`)
	want := `"a\"b\\c"`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func loadRealCatalogT(t *testing.T) *Catalog {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	cat, err := loadCatalog(filepath.Join(cwd, "..", "..", "slo", "catalog.yaml"))
	if err != nil {
		t.Fatalf("loadCatalog: %v", err)
	}
	return cat
}
