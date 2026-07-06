package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---- helpers ---------------------------------------------------------------

// middlewareSrc builds a synthetic middleware source that "declares" each of
// the supplied metric names (checkMetrics only does a substring search, so a
// comment carrying the literal is enough).
func middlewareSrc(metrics ...string) string {
	var b strings.Builder
	b.WriteString("package middleware\n")
	for _, m := range metrics {
		fmt.Fprintf(&b, "\tprometheus.CounterOpts{Name: %q}\n", m)
	}
	return b.String()
}

// routerSrc builds a synthetic chi router source. When useMw is true a
// `r.Use(MetricsMiddleware)` line is emitted either before (mwFirst) or after
// the route declarations. nRoutes `r.Get(...)` lines are emitted.
func routerSrc(useMw, mwFirst bool, nRoutes int) string {
	var b strings.Builder
	b.WriteString("package api\n\nfunc setup() {\n")
	if useMw && mwFirst {
		b.WriteString("\tr.Use(MetricsMiddleware)\n")
	}
	for i := 0; i < nRoutes; i++ {
		fmt.Fprintf(&b, "\tr.Get(\"/route%d\", h)\n", i)
	}
	if useMw && !mwFirst {
		b.WriteString("\tr.Use(MetricsMiddleware)\n")
	}
	b.WriteString("}\n")
	return b.String()
}

func hasFinding(findings []string, substr string) bool {
	for _, f := range findings {
		if strings.Contains(f, substr) {
			return true
		}
	}
	return false
}

// ---- checkMetrics ----------------------------------------------------------

func TestCheckMetrics(t *testing.T) {
	tests := []struct {
		name        string
		present     []string
		wantMissing []string
	}{
		{
			name:        "all present",
			present:     requiredMetrics,
			wantMissing: nil,
		},
		{
			name:        "requests_total missing",
			present:     []string{requiredMetrics[1], requiredMetrics[2]},
			wantMissing: []string{requiredMetrics[0]},
		},
		{
			name:        "errors_total missing",
			present:     []string{requiredMetrics[0], requiredMetrics[2]},
			wantMissing: []string{requiredMetrics[1]},
		},
		{
			name:        "duration_seconds missing",
			present:     []string{requiredMetrics[0], requiredMetrics[1]},
			wantMissing: []string{requiredMetrics[2]},
		},
		{
			name:        "all missing",
			present:     nil,
			wantMissing: requiredMetrics,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			statuses, findings := checkMetrics(middlewareSrc(tt.present...), "mw.go")

			// Every required metric must have a status entry.
			for _, m := range requiredMetrics {
				if _, ok := statuses[m]; !ok {
					t.Errorf("status for %q not set", m)
				}
			}
			// Missing metrics report MISSING + a finding; others OK.
			for _, m := range tt.wantMissing {
				if statuses[m] != "MISSING" {
					t.Errorf("status[%q]=%q want MISSING", m, statuses[m])
				}
				if !hasFinding(findings, m+" not declared") {
					t.Errorf("missing finding for %q: %v", m, findings)
				}
			}
			if len(findings) != len(tt.wantMissing) {
				t.Errorf("finding count=%d want %d: %v", len(findings), len(tt.wantMissing), findings)
			}
			for _, m := range tt.present {
				if statuses[m] != "OK" {
					t.Errorf("status[%q]=%q want OK", m, statuses[m])
				}
			}
		})
	}
}

// ---- checkRouter -----------------------------------------------------------

func TestCheckRouter(t *testing.T) {
	tests := []struct {
		name          string
		src           string
		wantRoutes    int
		wantFindings  []string // substrings that MUST be present
		bannedFinding []string // substrings that must NOT be present
	}{
		{
			name:         "middleware before routes, above threshold",
			src:          routerSrc(true, true, 120),
			wantRoutes:   120,
			wantFindings: nil,
			bannedFinding: []string{
				"not registered", "appears AFTER", "zero routes", "only",
			},
		},
		{
			name:         "middleware after first route",
			src:          routerSrc(true, false, 120),
			wantRoutes:   120,
			wantFindings: []string{"appears AFTER the first route"},
		},
		{
			name:         "middleware not registered",
			src:          routerSrc(false, false, 120),
			wantRoutes:   120,
			wantFindings: []string{"r.Use(MetricsMiddleware) not registered"},
		},
		{
			name:          "zero routes",
			src:           "package api\n\nfunc setup() {\n\tr.Use(MetricsMiddleware)\n}\n",
			wantRoutes:    0,
			wantFindings:  []string{"zero routes detected", "only 0 routes detected"},
			bannedFinding: []string{"appears AFTER"},
		},
		{
			name:         "below minimum route threshold",
			src:          routerSrc(true, true, 50),
			wantRoutes:   50,
			wantFindings: []string{"only 50 routes detected"},
			bannedFinding: []string{
				"not registered", "appears AFTER", "zero routes",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			routeCount, findings := checkRouter(tt.src, "router.go")
			if routeCount != tt.wantRoutes {
				t.Errorf("routeCount=%d want %d", routeCount, tt.wantRoutes)
			}
			for _, want := range tt.wantFindings {
				if !hasFinding(findings, want) {
					t.Errorf("missing finding %q in %v", want, findings)
				}
			}
			for _, banned := range tt.bannedFinding {
				if hasFinding(findings, banned) {
					t.Errorf("unexpected finding %q in %v", banned, findings)
				}
			}
		})
	}
}

// TestCheckRouter_RouteCounting exercises the regex across every supported chi
// verb, the `router.` alias prefix, whitespace tolerance, and lines that must
// NOT be counted.
func TestCheckRouter_RouteCounting(t *testing.T) {
	lines := []struct {
		src     string
		counted bool
	}{
		{"\tr.Get(\"/a\", h)", true},
		{"\tr.Post(\"/b\", h)", true},
		{"\tr.Put(\"/c\", h)", true},
		{"\tr.Patch(\"/d\", h)", true},
		{"\tr.Delete(\"/e\", h)", true},
		{"\tr.Head(\"/f\", h)", true},
		{"\tr.Options(\"/g\", h)", true},
		{"\tr.Method(\"GET\", \"/h\", h)", true},
		{"\tr.Mount(\"/i\", sub)", true},
		{"\tr.Handle(\"/j\", h)", true},
		{"\tr.HandleFunc(\"/k\", h)", true},
		{"\trouter.Get(\"/l\", h)", true},   // router. alias
		{"    r.Patch (\"/m\", h)", true},   // spaces + space before paren
		{"\tr.Use(mw)", false},              // middleware, not a route
		{"\tr.Group(func(r) {})", false},    // grouping, not a route
		{"\tfoo.Get(\"/x\", h)", false},     // wrong receiver
		{"\t// r.Get(\"/y\", h)", false},    // commented out (not at line start)
		{"\tmyrouter.Get(\"/z\", h)", false},// receiver not r/router
	}

	var b strings.Builder
	want := 0
	for _, l := range lines {
		b.WriteString(l.src)
		b.WriteByte('\n')
		if l.counted {
			want++
		}
	}
	got, _ := checkRouter(b.String(), "router.go")
	if got != want {
		t.Errorf("route count=%d want %d\nsource:\n%s", got, want, b.String())
	}
}

// ---- renderReport ----------------------------------------------------------

func TestRenderReport(t *testing.T) {
	t.Run("no findings", func(t *testing.T) {
		statuses, _ := checkMetrics(middlewareSrc(requiredMetrics...), "mw.go")
		out := renderReport(150, statuses, nil)
		if !strings.Contains(out, "No gaps found") {
			t.Errorf("expected clean report to state no gaps:\n%s", out)
		}
		if !strings.Contains(out, "Routes detected in router.go: **150**") {
			t.Errorf("route count not rendered:\n%s", out)
		}
		for _, m := range requiredMetrics {
			if !strings.Contains(out, "`"+m+"` — OK") {
				t.Errorf("metric %q not rendered OK:\n%s", m, out)
			}
		}
	})

	t.Run("with findings", func(t *testing.T) {
		findings := []string{"MISSING_METRIC: foo", "MISSING_METRIC: bar"}
		out := renderReport(0, map[string]string{}, findings)
		if strings.Contains(out, "No gaps found") {
			t.Errorf("clean banner must not appear when findings exist:\n%s", out)
		}
		for _, f := range findings {
			if !strings.Contains(out, "- "+f) {
				t.Errorf("finding %q not rendered:\n%s", f, out)
			}
		}
	})

	t.Run("empty statuses render UNCHECKED", func(t *testing.T) {
		out := renderReport(0, map[string]string{}, nil)
		for _, m := range requiredMetrics {
			if !strings.Contains(out, "`"+m+"` — UNCHECKED") {
				t.Errorf("metric %q not rendered UNCHECKED:\n%s", m, out)
			}
		}
	})
}

// ---- parseArgs -------------------------------------------------------------

func TestParseArgs_Defaults(t *testing.T) {
	cfg, err := parseArgs(nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("parseArgs(nil) error: %v", err)
	}
	if cfg.reportPath != defaultReport {
		t.Errorf("reportPath=%q want %q", cfg.reportPath, defaultReport)
	}
	if cfg.middlewarePath != middlewarePath {
		t.Errorf("middlewarePath=%q want %q", cfg.middlewarePath, middlewarePath)
	}
	if cfg.routerPath != routerPath {
		t.Errorf("routerPath=%q want %q", cfg.routerPath, routerPath)
	}
}

func TestParseArgs_Overrides(t *testing.T) {
	cfg, err := parseArgs([]string{
		"-report", "out.md",
		"-middleware", "mw.go",
		"-router", "rt.go",
	}, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("parseArgs error: %v", err)
	}
	if cfg.reportPath != "out.md" || cfg.middlewarePath != "mw.go" || cfg.routerPath != "rt.go" {
		t.Errorf("flags not bound: %+v", cfg)
	}
}

func TestParseArgs_BadFlag(t *testing.T) {
	_, err := parseArgs([]string{"--bogus"}, &bytes.Buffer{})
	if err == nil {
		t.Fatal("parseArgs --bogus did not return error")
	}
	if errors.Is(err, flag.ErrHelp) {
		t.Errorf("bad flag should not be ErrHelp: %v", err)
	}
}

func TestParseArgs_Help(t *testing.T) {
	_, err := parseArgs([]string{"-h"}, &bytes.Buffer{})
	if !errors.Is(err, flag.ErrHelp) {
		t.Errorf("-h err=%v want flag.ErrHelp", err)
	}
}

// ---- audit -----------------------------------------------------------------

func TestAudit_HappyPath(t *testing.T) {
	dir := t.TempDir()
	mwPath := filepath.Join(dir, "mw.go")
	rtPath := filepath.Join(dir, "rt.go")
	mustWrite(t, mwPath, middlewareSrc(requiredMetrics...))
	mustWrite(t, rtPath, routerSrc(true, true, 120))

	statuses, routeCount, findings := audit(auditConfig{middlewarePath: mwPath, routerPath: rtPath})
	if len(findings) != 0 {
		t.Errorf("expected no findings, got %v", findings)
	}
	if routeCount != 120 {
		t.Errorf("routeCount=%d want 120", routeCount)
	}
	for _, m := range requiredMetrics {
		if statuses[m] != "OK" {
			t.Errorf("status[%q]=%q want OK", m, statuses[m])
		}
	}
}

func TestAudit_MiddlewareUnreadable(t *testing.T) {
	dir := t.TempDir()
	rtPath := filepath.Join(dir, "rt.go")
	mustWrite(t, rtPath, routerSrc(true, true, 120))

	statuses, _, findings := audit(auditConfig{
		middlewarePath: filepath.Join(dir, "nope.go"),
		routerPath:     rtPath,
	})
	if !hasFinding(findings, "cannot read") {
		t.Errorf("expected read-error finding, got %v", findings)
	}
	// Statuses stay empty so the report renders UNCHECKED rather than MISSING.
	if len(statuses) != 0 {
		t.Errorf("statuses=%v want empty on middleware read error", statuses)
	}
}

// TestAudit_RouterUnreadable_NoCascade locks the bug fix: a router read error
// must produce exactly the read-error finding, NOT the misleading
// "zero routes / regex broken / not registered" cascade the old code emitted.
func TestAudit_RouterUnreadable_NoCascade(t *testing.T) {
	dir := t.TempDir()
	mwPath := filepath.Join(dir, "mw.go")
	mustWrite(t, mwPath, middlewareSrc(requiredMetrics...))

	_, routeCount, findings := audit(auditConfig{
		middlewarePath: mwPath,
		routerPath:     filepath.Join(dir, "nope.go"),
	})
	if routeCount != 0 {
		t.Errorf("routeCount=%d want 0 when router unreadable", routeCount)
	}
	if !hasFinding(findings, "cannot read") {
		t.Errorf("expected read-error finding, got %v", findings)
	}
	for _, banned := range []string{"zero routes", "regex broken", "not registered", "only 0 routes", "appears AFTER"} {
		if hasFinding(findings, banned) {
			t.Errorf("cascade finding %q leaked on router read error: %v", banned, findings)
		}
	}
	if len(findings) != 1 {
		t.Errorf("want exactly 1 finding on router read error, got %d: %v", len(findings), findings)
	}
}

// ---- run (end-to-end, injected writers, temp report) -----------------------

func goodRun(t *testing.T) (mwPath, rtPath, reportPath string) {
	t.Helper()
	dir := t.TempDir()
	mwPath = filepath.Join(dir, "mw.go")
	rtPath = filepath.Join(dir, "rt.go")
	reportPath = filepath.Join(dir, "sub", "report.md") // sub dir must be created
	mustWrite(t, mwPath, middlewareSrc(requiredMetrics...))
	mustWrite(t, rtPath, routerSrc(true, true, 120))
	return mwPath, rtPath, reportPath
}

func TestRun_HappyPath(t *testing.T) {
	mwPath, rtPath, reportPath := goodRun(t)
	var stdout, stderr bytes.Buffer
	code := run([]string{"-report", reportPath, "-middleware", mwPath, "-router", rtPath}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit=%d want 0; stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "# Phase 44 — Metric coverage audit") {
		t.Errorf("stdout missing report header:\n%s", stdout.String())
	}
	if !strings.Contains(stdout.String(), "No gaps found") {
		t.Errorf("stdout should report a clean audit:\n%s", stdout.String())
	}
	if !strings.Contains(stderr.String(), "metric-coverage-audit: OK") {
		t.Errorf("stderr missing OK line: %q", stderr.String())
	}
	// Report file was created (including its parent dir) and matches stdout.
	got, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("report not written: %v", err)
	}
	if string(got) != stdout.String() {
		t.Errorf("report file != stdout report")
	}
}

func TestRun_Gaps_ExitCode2(t *testing.T) {
	dir := t.TempDir()
	// Middleware missing one metric -> a gap.
	mwPath := filepath.Join(dir, "mw.go")
	rtPath := filepath.Join(dir, "rt.go")
	reportPath := filepath.Join(dir, "report.md")
	mustWrite(t, mwPath, middlewareSrc(requiredMetrics[0], requiredMetrics[1]))
	mustWrite(t, rtPath, routerSrc(true, true, 120))

	var stdout, stderr bytes.Buffer
	code := run([]string{"-report", reportPath, "-middleware", mwPath, "-router", rtPath}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit=%d want 2; stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "gap(s) — see report") {
		t.Errorf("stderr missing gap summary: %q", stderr.String())
	}
	if !strings.Contains(stdout.String(), requiredMetrics[2]+" not declared") {
		t.Errorf("report missing the expected gap:\n%s", stdout.String())
	}
}

func TestRun_MiddlewareMissing_ReportsReadError(t *testing.T) {
	dir := t.TempDir()
	rtPath := filepath.Join(dir, "rt.go")
	reportPath := filepath.Join(dir, "report.md")
	mustWrite(t, rtPath, routerSrc(true, true, 120))

	var stdout, stderr bytes.Buffer
	code := run([]string{
		"-report", reportPath,
		"-middleware", filepath.Join(dir, "nope.go"),
		"-router", rtPath,
	}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit=%d want 2; stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "cannot read") {
		t.Errorf("report missing read-error finding:\n%s", stdout.String())
	}
}

func TestRun_ReportWriteFailure_ExitCode1(t *testing.T) {
	dir := t.TempDir()
	mwPath := filepath.Join(dir, "mw.go")
	rtPath := filepath.Join(dir, "rt.go")
	mustWrite(t, mwPath, middlewareSrc(requiredMetrics...))
	mustWrite(t, rtPath, routerSrc(true, true, 120))

	// Make the report's parent a regular file so MkdirAll fails.
	blocker := filepath.Join(dir, "blocker")
	mustWrite(t, blocker, "x")
	reportPath := filepath.Join(blocker, "report.md")

	var stdout, stderr bytes.Buffer
	code := run([]string{"-report", reportPath, "-middleware", mwPath, "-router", rtPath}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("exit=%d want 1; stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "create report dir") && !strings.Contains(stderr.String(), "write report") {
		t.Errorf("stderr missing wrapped IO error: %q", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Errorf("no report should be printed on write failure, got: %q", stdout.String())
	}
}

func TestRun_BadFlag_ExitCode2(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--bogus"}, &stdout, &stderr); code != 2 {
		t.Errorf("--bogus exit=%d want 2", code)
	}
}

func TestRun_Help_ExitCode0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-h"}, &stdout, &stderr); code != 0 {
		t.Errorf("-h exit=%d want 0", code)
	}
}

// ---- writeReport -----------------------------------------------------------

func TestWriteReport_CreatesParentDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a", "b", "report.md")
	if err := writeReport(path, "hello"); err != nil {
		t.Fatalf("writeReport: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != "hello" {
		t.Errorf("content=%q want hello", string(got))
	}
}

func TestWriteReport_WrapsMkdirError(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "file")
	mustWrite(t, blocker, "x")
	err := writeReport(filepath.Join(blocker, "report.md"), "data")
	if err == nil {
		t.Fatal("expected error when parent is a file")
	}
	if !strings.Contains(err.Error(), "create report dir") {
		t.Errorf("error not wrapped with context: %v", err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
