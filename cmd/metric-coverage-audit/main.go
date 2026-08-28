// Metric coverage audit.
//
// Static audit that the RED middleware is wired in front of every route
// declared in internal/api/router.go and that the three metric series
// (requests_total / errors_total / duration_seconds) are actually defined.
//
// Why static: spinning up the entire teslasync HTTP server in CI just to
// scrape /metrics would require Postgres + Redis + Mosquitto + a real Tesla
// API mock — overkill for a coverage check. Instead we walk router.go and
// count chi route declarations, then verify middleware.Metrics is registered
// before the first route subtree.
//
// Failure modes (any of these adds MISSING_METRIC to the report so the
// prompt gate blocks):
//   - middleware/observability.go missing one of the three metric names
//   - router.go does not call r.Use(apimw.Metrics) before route mounts
//   - any router.Mount() call appears before the middleware
//   - zero routes detected (means the regex broke and we silently passed)
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	routerPath     = "internal/api/router.go"
	middlewarePath = "internal/api/middleware/observability.go"
	defaultReport  = "docs/runbooks/phase-44-metric-coverage-audit.md"
	minRoutes      = 100
)

var requiredMetrics = []string{
	"red_http_requests_total",
	"red_http_request_errors_total",
	"red_http_request_duration_seconds",
}

// chi route registration verbs. Includes Mount because subrouters DO inherit
// parent middleware in chi, but we still count their declaration for a
// coverage signal.
var routeRE = regexp.MustCompile(`(?m)^\s*r(?:outer)?\.(?:Get|Post|Put|Patch|Delete|Head|Options|Method|Mount|Handle|HandleFunc)\s*\(`)
var metricsUseRE = regexp.MustCompile(`(?m)^\s*r(?:outer)?\.Use\s*\(\s*(?:[A-Za-z_]\w*\.)?Metrics\s*\)`)
var newRouterRE = regexp.MustCompile(`\bfunc\s+NewRouter\s*\(`)

// auditConfig captures the resolved input/output paths for a single audit
// run. The source paths default to the repository-relative constants above
// but are overridable via flags so the audit can be pointed at fixtures
// (and unit-tested) without touching the real tree.
type auditConfig struct {
	middlewarePath string
	routerPath     string
	reportPath     string
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is the test-friendly entry point. argv is the program args (NOT
// including os.Args[0]); stdout / stderr are injected so tests can assert
// on output without swapping the os.Std* globals. It returns the process
// exit code:
//
//	0  no coverage gaps
//	1  the report could not be written (IO error)
//	2  at least one coverage gap, or a flag-parse error
func run(argv []string, stdout, stderr io.Writer) int {
	cfg, err := parseArgs(argv, stderr)
	if err != nil {
		// flag already printed usage/context to stderr. -h/-help is not
		// a failure; a genuine bad flag maps to the same non-zero code
		// the stdlib flag package uses (2).
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	statuses, routeCount, findings := audit(cfg)

	report := renderReport(routeCount, statuses, findings)
	if err := writeReport(cfg.reportPath, report); err != nil {
		fmt.Fprintf(stderr, "metric-coverage-audit: %v\n", err)
		return 1
	}
	fmt.Fprint(stdout, report)

	if len(findings) > 0 {
		fmt.Fprintf(stderr, "metric-coverage-audit: %d gap(s) — see report\n", len(findings))
		return 2
	}
	fmt.Fprintln(stderr, "metric-coverage-audit: OK")
	return 0
}

// parseArgs is broken out so tests can exercise flag handling without
// invoking the rest of run().
func parseArgs(argv []string, stderr io.Writer) (auditConfig, error) {
	fs := flag.NewFlagSet("metric-coverage-audit", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cfg := auditConfig{}
	fs.StringVar(&cfg.reportPath, "report", defaultReport, "report output path")
	fs.StringVar(&cfg.middlewarePath, "middleware", middlewarePath, "path to the middleware source declaring the RED metric series")
	fs.StringVar(&cfg.routerPath, "router", routerPath, "path to the chi router source registering the metrics middleware")
	if err := fs.Parse(argv); err != nil {
		return auditConfig{}, err
	}
	return cfg, nil
}

// audit performs the static analysis and returns per-metric statuses, the
// route count, and any findings. It owns the file IO so the pure checks
// (checkMetrics / checkRouter) stay testable in isolation.
func audit(cfg auditConfig) (statuses map[string]string, routeCount int, findings []string) {
	statuses = map[string]string{}

	// 1. Verify metric definitions in the middleware source.
	if mw, err := os.ReadFile(cfg.middlewarePath); err != nil {
		findings = append(findings, fmt.Sprintf("MISSING_METRIC: cannot read %s: %v", cfg.middlewarePath, err))
	} else {
		var mf []string
		statuses, mf = checkMetrics(string(mw), cfg.middlewarePath)
		findings = append(findings, mf...)
	}

	// 2. Verify the metrics middleware is registered before the first
	//    route, and count routes for an honest coverage figure. On a read
	//    error we stop here: running the position/count heuristics against
	//    an unread file would emit misleading "regex broken or file empty"
	//    findings for what is really an IO failure.
	if rt, err := os.ReadFile(cfg.routerPath); err != nil {
		findings = append(findings, fmt.Sprintf("MISSING_METRIC: cannot read %s: %v", cfg.routerPath, err))
	} else {
		var rf []string
		routeCount, rf = checkRouter(string(rt), cfg.routerPath)
		findings = append(findings, rf...)
	}

	return statuses, routeCount, findings
}

// checkMetrics confirms every required RED metric series literal appears in
// the middleware source. It returns a per-metric status map (OK / MISSING)
// and a finding for each missing series.
func checkMetrics(src, path string) (map[string]string, []string) {
	statuses := map[string]string{}
	var findings []string
	for _, m := range requiredMetrics {
		if strings.Contains(src, m) {
			statuses[m] = "OK"
		} else {
			statuses[m] = "MISSING"
			findings = append(findings, fmt.Sprintf("MISSING_METRIC: %s not declared in %s", m, path))
		}
	}
	return statuses, findings
}

// checkRouter confirms the metrics middleware is registered before the first
// route declaration and counts route declarations. It returns the route
// count and any findings.
func checkRouter(src, path string) (int, []string) {
	var findings []string
	newRouter := newRouterRE.FindStringIndex(src)
	var metricsUse, firstRoute []int
	if newRouter == nil {
		findings = append(findings, fmt.Sprintf("MISSING_METRIC: func NewRouter not found in %s", path))
	} else {
		compositionRoot := src[newRouter[0]:]
		metricsUse = metricsUseRE.FindStringIndex(compositionRoot)
		firstRoute = routeRE.FindStringIndex(compositionRoot)
	}
	if metricsUse == nil {
		findings = append(findings, fmt.Sprintf("MISSING_METRIC: RED metrics middleware is not registered with r.Use(...Metrics) in %s", path))
	}
	if firstRoute == nil {
		findings = append(findings, fmt.Sprintf("MISSING_METRIC: zero routes detected in %s — regex broken or file empty", path))
	} else if metricsUse != nil && metricsUse[0] > firstRoute[0] {
		findings = append(findings, "MISSING_METRIC: RED metrics middleware appears AFTER the first route declaration — earlier routes will skip RED metrics")
	}

	routeCount := len(routeRE.FindAllStringIndex(src, -1))
	if routeCount < minRoutes {
		findings = append(findings, fmt.Sprintf("MISSING_METRIC: only %d routes detected in %s (expected ≥%d) — middleware coverage may be incomplete", routeCount, path, minRoutes))
	}
	return routeCount, findings
}

// writeReport creates the report's parent directory (if any) and writes the
// rendered report, wrapping IO errors with context for the caller to log.
func writeReport(path, report string) error {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create report dir %s: %w", dir, err)
		}
	}
	if err := os.WriteFile(path, []byte(report), 0o644); err != nil {
		return fmt.Errorf("write report %s: %w", path, err)
	}
	return nil
}

func renderReport(routeCount int, statuses map[string]string, findings []string) string {
	var b strings.Builder
	b.WriteString("# Phase 44 — Metric coverage audit\n\n")
	b.WriteString("Static audit of `internal/api/router.go` and `internal/api/middleware/observability.go` to confirm every route is covered by the RED middleware.\n\n")
	b.WriteString("Generated by `cmd/metric-coverage-audit`. To re-run:\n\n")
	b.WriteString("```powershell\ngo run ./cmd/metric-coverage-audit -report docs/runbooks/phase-44-metric-coverage-audit.md\n```\n\n")
	b.WriteString("## Required metric series\n\n")
	for _, m := range requiredMetrics {
		s := statuses[m]
		if s == "" {
			s = "UNCHECKED"
		}
		fmt.Fprintf(&b, "- `%s` — %s\n", m, s)
	}
	b.WriteString("\n## Route coverage\n\n")
	fmt.Fprintf(&b, "- Routes detected in router.go: **%d** (threshold ≥ %d)\n", routeCount, minRoutes)
	b.WriteString("- Coverage strategy: chi `r.Use(apimw.Metrics)` is registered at the root router so every subsequently-declared route inherits the RED middleware.\n\n")
	b.WriteString("## Findings\n\n")
	if len(findings) == 0 {
		b.WriteString("No gaps found. All routes inherit the RED middleware.\n")
	} else {
		for _, f := range findings {
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	return b.String()
}
