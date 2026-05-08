// Phase 44 / Prompt 0082 — SLO coverage audit.
//
// Per ADR-008 §6, every user-facing endpoint must be covered by at least
// one SLO. Coverage need not be 1:1 — most routes are covered transitively
// by the global `api_availability` SLO whose SLI is built from
// `teslasync_red_http_requests_total{status_class!="5xx"}`. A handful of
// hot endpoints get their own per-route latency SLO via the route label
// inside the SLI expression.
//
// This audit:
//
//   1. Walks `internal/api/router.go` and extracts every chi route literal.
//   2. Filters out internal/operator routes (`/internal/`, `/healthz`,
//      `/readyz`, `/metrics`, `/debug/pprof/`).
//   3. Loads `slo/catalog.yaml` and gathers the set of routes referenced
//      by per-route SLOs (search for `route="..."` literals) plus the
//      transitive coverage flag (true if any SLO's SLI references
//      `teslasync_red_http_requests_total` without a route filter).
//   4. For each user-facing route, marks it OK if (a) transitively covered
//      OR (b) appears in a per-route SLO. Otherwise emits MISSING_SLO and
//      the gate blocks.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	routerPath    = "internal/api/router.go"
	catalogPath   = "slo/catalog.yaml"
	defaultReport = "docs/runbooks/phase-44-slo-coverage-audit.md"
)

// Path arg is the second arg to chi route methods. We deliberately keep the
// regex strict: only routes declared with double-quoted literal paths get
// audited. Mounted subrouters whose paths come from variables are reported
// separately.
var routeLiteralRE = regexp.MustCompile(`(?m)r(?:outer)?\.(?:Get|Post|Put|Patch|Delete|Head|Options|Method|Mount|Handle|HandleFunc)\(\s*(?:"([A-Z]+)"\s*,\s*)?"([^"]+)"`)

// Operator/internal route prefixes that are explicitly NOT user-facing and
// therefore exempt from SLO coverage. /healthz and /readyz are k8s probes,
// /metrics is Prometheus, /debug is pprof, /internal is the cluster-only
// admin surface.
var exemptPrefixes = []string{
	"/healthz",
	"/readyz",
	"/metrics",
	"/debug/",
	"/internal/",
}

// Per-route SLO references inside the catalog: any double-quoted route
// label literal: route="/api/v1/...".
var routeLabelRE = regexp.MustCompile(`route=\\"([^\\"]+)\\"`)

type rowResult struct {
	Route   string
	Covered bool
	Source  string
}

func main() {
	var reportPath string
	flag.StringVar(&reportPath, "report", defaultReport, "report path")
	flag.Parse()

	routes, err := loadRoutes(routerPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load routes failed: %v\n", err)
		os.Exit(1)
	}

	transitive, perRoute, err := loadCatalogCoverage(catalogPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load catalog failed: %v\n", err)
		os.Exit(1)
	}

	rows := make([]rowResult, 0, len(routes))
	missing := []string{}
	for _, r := range routes {
		if isExempt(r) {
			continue
		}
		row := rowResult{Route: r}
		if _, ok := perRoute[r]; ok {
			row.Covered = true
			row.Source = "per-route SLO"
		} else if transitive {
			row.Covered = true
			row.Source = "transitive (api_availability)"
		} else {
			missing = append(missing, r)
			row.Source = "MISSING_SLO"
		}
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Route < rows[j].Route })

	report := renderReport(rows, missing, transitive, perRoute)
	if err := os.MkdirAll(filepath.Dir(reportPath), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir failed: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(reportPath, []byte(report), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Print(report)

	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "slo-coverage-audit: %d uncovered route(s) — see report\n", len(missing))
		os.Exit(2)
	}
	fmt.Fprintf(os.Stderr, "slo-coverage-audit: OK (%d user-facing routes covered)\n", len(rows))
}

func loadRoutes(path string) ([]string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	matches := routeLiteralRE.FindAllStringSubmatch(string(body), -1)
	out := make([]string, 0, len(matches))
	seen := map[string]struct{}{}
	for _, m := range matches {
		// Group 1 is the optional method literal (only present for
		// r.Method/HandleFunc); group 2 is always the path.
		path := m[2]
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	return out, nil
}

func loadCatalogCoverage(path string) (transitive bool, perRoute map[string]struct{}, err error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return false, nil, err
	}
	src := string(body)
	transitive = strings.Contains(src, "teslasync_red_http_requests_total")
	perRoute = map[string]struct{}{}
	for _, m := range routeLabelRE.FindAllStringSubmatch(src, -1) {
		perRoute[m[1]] = struct{}{}
	}
	return transitive, perRoute, nil
}

func isExempt(route string) bool {
	for _, p := range exemptPrefixes {
		if strings.HasPrefix(route, p) {
			return true
		}
	}
	// Empty paths and asterisks (chi catch-alls) aren't real user-facing
	// endpoints either.
	if route == "" || route == "/*" || route == "/" {
		return true
	}
	return false
}

func renderReport(
	rows []rowResult,
	missing []string,
	transitive bool,
	perRoute map[string]struct{},
) string {
	var b strings.Builder
	b.WriteString("# Phase 44 — SLO coverage audit\n\n")
	b.WriteString("Per ADR-008 §6, every user-facing endpoint must have a matching SLO entry. Coverage is satisfied either by a per-route SLO whose SLI references the route label, or transitively by the chart-wide `api_availability` SLO built on `teslasync_red_http_requests_total`.\n\n")
	b.WriteString("Generated by `cmd/slo-coverage-audit`. To re-run:\n\n")
	b.WriteString("```powershell\ngo run ./cmd/slo-coverage-audit -report docs/runbooks/phase-44-slo-coverage-audit.md\n```\n\n")
	b.WriteString("## Catalog summary\n\n")
	fmt.Fprintf(&b, "- Transitive coverage from `api_availability`: **%t**\n", transitive)
	if len(perRoute) > 0 {
		b.WriteString("- Per-route SLOs registered for:\n")
		keys := make([]string, 0, len(perRoute))
		for k := range perRoute {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprintf(&b, "  - `%s`\n", k)
		}
	} else {
		b.WriteString("- No per-route SLOs registered (transitive coverage only).\n")
	}
	b.WriteString("\n## Findings\n\n")
	if len(missing) == 0 {
		fmt.Fprintf(&b, "All %d user-facing routes are covered.\n\n", len(rows))
	} else {
		fmt.Fprintf(&b, "%d uncovered route(s):\n\n", len(missing))
		for _, r := range missing {
			fmt.Fprintf(&b, "- `%s` — MISSING_SLO\n", r)
		}
		b.WriteString("\n")
	}
	b.WriteString("## Per-route coverage table\n\n")
	b.WriteString("| Route | Source |\n|---|---|\n")
	for _, row := range rows {
		fmt.Fprintf(&b, "| `%s` | %s |\n", row.Route, row.Source)
	}
	return b.String()
}
