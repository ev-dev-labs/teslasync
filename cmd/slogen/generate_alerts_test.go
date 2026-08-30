package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderAlerts_DeterministicAndContainsRequiredKeys(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	first := renderAlerts(cat)
	if first != renderAlerts(cat) {
		t.Fatal("renderAlerts is not deterministic")
	}
	for _, must := range []string{
		"FastBurn",
		"SlowBurn",
		"severity: page",
		"severity: ticket",
		"runbook_url",
	} {
		if !strings.Contains(first, must) {
			t.Errorf("rendered alerts missing %q", must)
		}
	}
}

func TestRenderAlerts_TwoAlertsPerSLO(t *testing.T) {
	t.Parallel()
	cat := loadRealCatalogT(t)
	out := renderAlerts(cat)
	for _, s := range cat.SLOs {
		fast := "alert: SLO" + camelCase(s.Name) + "FastBurn"
		slow := "alert: SLO" + camelCase(s.Name) + "SlowBurn"
		if !strings.Contains(out, fast) {
			t.Errorf("missing fast burn alert %q", fast)
		}
		if !strings.Contains(out, slow) {
			t.Errorf("missing slow burn alert %q", slow)
		}
	}
}

func TestRenderAlerts_FastBurnSeverityOverride(t *testing.T) {
	t.Parallel()
	cat := &Catalog{SLOs: []SLO{{
		Name:             "budget_continuity",
		Description:      "Budget continuity planning signal",
		SLI:              SLI{GoodEvents: "rate(g[5m])", ValidEvents: "rate(v[5m])"},
		Objective:        99,
		Window:           "7d",
		Owner:            "platform",
		FastBurnSeverity: "ticket",
	}}}

	out := renderAlerts(cat)
	if strings.Contains(out, "severity: page") {
		t.Fatalf("fast-burn severity override did not suppress page routing:\n%s", out)
	}
	if got := strings.Count(out, "severity: ticket"); got != 2 {
		t.Fatalf("ticket severities = %d, want both fast and slow alerts routed as tickets", got)
	}
}

func TestErrorBudgetBurnThreshold(t *testing.T) {
	t.Parallel()
	// 99.5% objective, 14.4 burn rate -> (1 - 0.995) * 14.4 = 0.072
	got := errorBudgetBurnThreshold(99.5, 14.4)
	if got != "0.072000" {
		t.Fatalf("99.5/14.4: got %q want 0.072000", got)
	}
	got = errorBudgetBurnThreshold(99, 6)
	if got != "0.060000" {
		t.Fatalf("99/6: got %q want 0.060000", got)
	}
}

func TestBurnRatioExpr_PrefersRecordingRule(t *testing.T) {
	t.Parallel()
	s := SLO{
		Name: "x",
		SLI:  SLI{GoodEvents: "rate(g[5m])", ValidEvents: "rate(v[5m])"},
	}
	if got := burnRatioExpr(s, "1h"); got != "slo:x:ratio_rate1h" {
		t.Errorf("recorded window: got %q", got)
	}
	got := burnRatioExpr(s, "30m")
	if !strings.Contains(got, "[30m]") || !strings.Contains(got, "rate(g[30m])") {
		t.Errorf("inline window: got %q", got)
	}
}

func TestCamelCase(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"api_availability":      "ApiAvailability",
		"api_latency_p99_500ms": "ApiLatencyP99500ms",
		"frontend_lcp":          "FrontendLcp",
	}
	for in, want := range cases {
		if got := camelCase(in); got != want {
			t.Errorf("camelCase(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRunGenerateAlerts_IdempotentOnDisk(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	out := filepath.Join(dir, "alerting-rules.yaml")
	cwd, _ := os.Getwd()
	catalog := filepath.Join(cwd, "..", "..", "slo", "catalog.yaml")

	if err := runGenerateAlerts([]string{"--catalog", catalog, "--out", out}); err != nil {
		t.Fatalf("first: %v", err)
	}
	first, _ := os.ReadFile(out)
	if err := runGenerateAlerts([]string{"--catalog", catalog, "--out", out}); err != nil {
		t.Fatalf("second: %v", err)
	}
	second, _ := os.ReadFile(out)
	if string(first) != string(second) {
		t.Fatal("alerts codegen not byte-stable")
	}
}
