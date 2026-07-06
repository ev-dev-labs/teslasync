package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// writeFile drops content into a fresh temp dir and returns the absolute path.
func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
	return p
}

// ── isExempt ──────────────────────────────────────────────────────────────────

func TestIsExempt(t *testing.T) {
	tests := []struct {
		name  string
		route string
		want  bool
	}{
		{"healthz probe", "/healthz", true},
		{"readyz probe", "/readyz", true},
		{"metrics endpoint", "/metrics", true},
		{"debug prefix", "/debug/pprof/", true},
		{"internal prefix", "/internal/flush", true},
		{"healthz is prefix match", "/healthz/extra", true},
		{"empty path", "", true},
		{"chi catch-all", "/*", true},
		{"root slash", "/", true},
		{"user-facing vehicles", "/api/v1/vehicles", false},
		{"user-facing fragment", "/state", false},
		{"health without z is not exempt", "/health", false},
		{"api route not exempt", "/api/v1/drives/{driveID}", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isExempt(tt.route); got != tt.want {
				t.Errorf("isExempt(%q) = %v, want %v", tt.route, got, tt.want)
			}
		})
	}
}

// ── loadRoutes ────────────────────────────────────────────────────────────────

func TestLoadRoutes(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want []string
	}{
		{
			name: "basic get and post",
			src: `func routes(r chi.Router) {
	r.Get("/a", handler)
	r.Post("/b", handler)
}`,
			want: []string{"/a", "/b"},
		},
		{
			name: "deduplicates repeated path",
			src: `r.Get("/dup", h)
r.Post("/dup", h)
r.Get("/other", h)`,
			want: []string{"/dup", "/other"},
		},
		{
			name: "method form skips verb literal captures path",
			src:  `r.Method("GET", "/m", handler)`,
			want: []string{"/m"},
		},
		{
			name: "mount handle and handlefunc",
			src: `r.Mount("/mnt", sub)
r.Handle("/h", x)
r.HandleFunc("/hf", x)`,
			want: []string{"/mnt", "/h", "/hf"},
		},
		{
			name: "router prefixed receiver",
			src:  `router.Get("/router-form", handler)`,
			want: []string{"/router-form"},
		},
		{
			name: "ignores non-route lines and comments",
			src: `// r.Get should still match inside strings? no — this is a comment mentioning nothing callable
var x = "/not-a-route"
foo.Bar("/also-not")
r.Delete("/real", h)`,
			want: []string{"/real"},
		},
		{
			name: "preserves first-seen order",
			src: `r.Get("/z", h)
r.Get("/a", h)
r.Get("/m", h)`,
			want: []string{"/z", "/a", "/m"},
		},
		{
			name: "no matches yields empty slice",
			src:  `package main // nothing routable here`,
			want: []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := writeFile(t, "router.go", tt.src)
			got, err := loadRoutes(p)
			if err != nil {
				t.Fatalf("loadRoutes returned error: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("loadRoutes() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestLoadRoutes_MissingFile(t *testing.T) {
	_, err := loadRoutes(filepath.Join(t.TempDir(), "does-not-exist.go"))
	if err == nil {
		t.Fatal("expected error for missing router file, got nil")
	}
	if !strings.Contains(err.Error(), "read router file") {
		t.Errorf("error not wrapped with context: %v", err)
	}
}

// ── loadCatalogCoverage ─────────────────────────────────────────────────────────

// transitiveCatalog references the global availability counter with no route
// filter, so it grants transitive coverage to every user-facing route.
const transitiveCatalog = `version: 1
slos:
  - name: api_availability
    sli:
      good_events: "sum(rate(teslasync_red_http_requests_total{status_class!=\"5xx\"}[5m]))"
      valid_events: "sum(rate(teslasync_red_http_requests_total[5m]))"
`

// perRouteCatalog has NO transitive counter but names two routes via route=
// labels on a latency histogram metric.
const perRouteCatalog = `version: 1
slos:
  - name: foo_latency
    sli:
      good_events: "sum(rate(teslasync_red_http_request_duration_seconds_bucket{route=\"/api/v1/foo\",le=\"0.5\"}[5m]))"
  - name: bar_latency
    sli:
      good_events: "sum(rate(teslasync_red_http_request_duration_seconds_bucket{route=\"/api/v1/bar\",le=\"0.5\"}[5m]))"
`

func TestLoadCatalogCoverage(t *testing.T) {
	tests := []struct {
		name           string
		src            string
		wantTransitive bool
		wantRoutes     []string
	}{
		{
			name:           "transitive availability counter",
			src:            transitiveCatalog,
			wantTransitive: true,
			wantRoutes:     nil,
		},
		{
			name:           "per-route labels only, no transitive",
			src:            perRouteCatalog,
			wantTransitive: false,
			wantRoutes:     []string{"/api/v1/foo", "/api/v1/bar"},
		},
		{
			name: "latency histogram is not the availability counter",
			src: `version: 1
slos:
  - name: only_latency
    sli:
      good_events: "sum(rate(teslasync_red_http_request_duration_seconds_bucket{route=\"/api/v1/x\"}[5m]))"
`,
			wantTransitive: false,
			wantRoutes:     []string{"/api/v1/x"},
		},
		{
			name:           "empty catalog",
			src:            "",
			wantTransitive: false,
			wantRoutes:     nil,
		},
		{
			name:           "both transitive and per-route",
			src:            transitiveCatalog + perRouteCatalog,
			wantTransitive: true,
			wantRoutes:     []string{"/api/v1/foo", "/api/v1/bar"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := writeFile(t, "catalog.yaml", tt.src)
			transitive, perRoute, err := loadCatalogCoverage(p)
			if err != nil {
				t.Fatalf("loadCatalogCoverage returned error: %v", err)
			}
			if transitive != tt.wantTransitive {
				t.Errorf("transitive = %v, want %v", transitive, tt.wantTransitive)
			}
			if len(perRoute) != len(tt.wantRoutes) {
				t.Errorf("perRoute size = %d, want %d (%v)", len(perRoute), len(tt.wantRoutes), perRoute)
			}
			for _, r := range tt.wantRoutes {
				if _, ok := perRoute[r]; !ok {
					t.Errorf("perRoute missing %q; got %v", r, perRoute)
				}
			}
		})
	}
}

func TestLoadCatalogCoverage_MissingFile(t *testing.T) {
	_, _, err := loadCatalogCoverage(filepath.Join(t.TempDir(), "nope.yaml"))
	if err == nil {
		t.Fatal("expected error for missing catalog, got nil")
	}
	if !strings.Contains(err.Error(), "read catalog") {
		t.Errorf("error not wrapped with context: %v", err)
	}
}

// ── renderReport ────────────────────────────────────────────────────────────────

func TestRenderReport_AllCovered(t *testing.T) {
	rows := []rowResult{
		{Route: "/api/v1/a", Covered: true, Source: "transitive (api_availability)"},
		{Route: "/api/v1/b", Covered: true, Source: "transitive (api_availability)"},
	}
	out := renderReport(rows, nil, true, map[string]struct{}{})

	for _, want := range []string{
		"# Phase 44 — SLO coverage audit",
		"Transitive coverage from `api_availability`: **true**",
		"No per-route SLOs registered (transitive coverage only).",
		"All 2 user-facing routes are covered.",
		"| `/api/v1/a` | transitive (api_availability) |",
		"| `/api/v1/b` | transitive (api_availability) |",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("report missing %q\n---\n%s", want, out)
		}
	}
	if strings.Contains(out, "MISSING_SLO") {
		t.Errorf("all-covered report should not mention MISSING_SLO:\n%s", out)
	}
}

func TestRenderReport_MissingRoutes(t *testing.T) {
	rows := []rowResult{{Route: "/api/v1/orphan", Covered: false, Source: "MISSING_SLO"}}
	out := renderReport(rows, []string{"/api/v1/orphan"}, false, map[string]struct{}{})

	for _, want := range []string{
		"Transitive coverage from `api_availability`: **false**",
		"1 uncovered route(s):",
		"- `/api/v1/orphan` — MISSING_SLO",
		"| `/api/v1/orphan` | MISSING_SLO |",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("report missing %q\n---\n%s", want, out)
		}
	}
}

func TestRenderReport_PerRouteSortedListing(t *testing.T) {
	perRoute := map[string]struct{}{"/api/v1/zeta": {}, "/api/v1/alpha": {}}
	rows := []rowResult{{Route: "/api/v1/alpha", Covered: true, Source: "per-route SLO"}}
	out := renderReport(rows, nil, false, perRoute)

	if !strings.Contains(out, "Per-route SLOs registered for:") {
		t.Fatalf("expected per-route listing header:\n%s", out)
	}
	alpha := strings.Index(out, "`/api/v1/alpha`")
	zeta := strings.Index(out, "`/api/v1/zeta`")
	if alpha < 0 || zeta < 0 {
		t.Fatalf("both per-route entries should be listed:\n%s", out)
	}
	if alpha > zeta {
		t.Errorf("per-route keys must be sorted (alpha before zeta): alpha=%d zeta=%d", alpha, zeta)
	}
}

// ── run (end-to-end) ────────────────────────────────────────────────────────────

// writeInDir writes name/content into dir and returns the path.
func writeInDir(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
	return p
}

func TestRun_TransitiveCoverage(t *testing.T) {
	dir := t.TempDir()
	router := writeInDir(t, dir, "router.go", `r.Get("/api/v1/vehicles", h)
r.Get("/healthz", h)
r.Post("/api/v1/drives", h)`)
	catalog := writeInDir(t, dir, "catalog.yaml", transitiveCatalog)
	report := filepath.Join(dir, "sub", "report.md")

	var stdout, stderr bytes.Buffer
	code := run(router, catalog, report, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("run() = %d, want 0; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "OK (2 user-facing routes covered)") {
		t.Errorf("stderr missing OK summary: %s", stderr.String())
	}
	// /healthz must be filtered out of the coverage table.
	if strings.Contains(stdout.String(), "/healthz") {
		t.Errorf("exempt route leaked into report:\n%s", stdout.String())
	}
	body, err := os.ReadFile(report)
	if err != nil {
		t.Fatalf("report not written: %v", err)
	}
	if got := string(body); got != stdout.String() {
		t.Errorf("stdout and report file diverge")
	}
	if !strings.Contains(string(body), "All 2 user-facing routes are covered.") {
		t.Errorf("report body unexpected:\n%s", body)
	}
}

func TestRun_MissingSLOExitsTwo(t *testing.T) {
	dir := t.TempDir()
	router := writeInDir(t, dir, "router.go", `r.Get("/api/v1/orphan", h)`)
	catalog := writeInDir(t, dir, "catalog.yaml", `version: 1
slos:
  - name: telemetry_freshness
    sli:
      good_events: "sum(teslasync_telemetry_lag_seconds <= 60)"
`)
	report := filepath.Join(dir, "report.md")

	var stdout, stderr bytes.Buffer
	code := run(router, catalog, report, &stdout, &stderr)

	if code != 2 {
		t.Fatalf("run() = %d, want 2; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "1 uncovered route(s)") {
		t.Errorf("stderr missing uncovered summary: %s", stderr.String())
	}
	body, err := os.ReadFile(report)
	if err != nil {
		t.Fatalf("report should still be written on failure: %v", err)
	}
	if !strings.Contains(string(body), "MISSING_SLO") {
		t.Errorf("report should flag MISSING_SLO:\n%s", body)
	}
}

func TestRun_PerRouteCoverageExitsZero(t *testing.T) {
	dir := t.TempDir()
	router := writeInDir(t, dir, "router.go", `r.Get("/api/v1/foo", h)
r.Get("/api/v1/bar", h)`)
	catalog := writeInDir(t, dir, "catalog.yaml", perRouteCatalog)
	report := filepath.Join(dir, "report.md")

	var stdout, stderr bytes.Buffer
	code := run(router, catalog, report, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("run() = %d, want 0; stderr=%s", code, stderr.String())
	}
	if strings.Contains(stdout.String(), "MISSING_SLO") {
		t.Errorf("per-route coverage should leave no gaps:\n%s", stdout.String())
	}
	if !strings.Contains(stdout.String(), "per-route SLO") {
		t.Errorf("expected per-route source in table:\n%s", stdout.String())
	}
}

func TestRun_LoadRoutesError(t *testing.T) {
	dir := t.TempDir()
	catalog := writeInDir(t, dir, "catalog.yaml", transitiveCatalog)
	var stdout, stderr bytes.Buffer
	code := run(filepath.Join(dir, "absent.go"), catalog, filepath.Join(dir, "r.md"), &stdout, &stderr)

	if code != 1 {
		t.Fatalf("run() = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "load routes failed") {
		t.Errorf("stderr missing load routes error: %s", stderr.String())
	}
}

func TestRun_LoadCatalogError(t *testing.T) {
	dir := t.TempDir()
	router := writeInDir(t, dir, "router.go", `r.Get("/api/v1/foo", h)`)
	var stdout, stderr bytes.Buffer
	code := run(router, filepath.Join(dir, "absent.yaml"), filepath.Join(dir, "r.md"), &stdout, &stderr)

	if code != 1 {
		t.Fatalf("run() = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "load catalog failed") {
		t.Errorf("stderr missing load catalog error: %s", stderr.String())
	}
}

func TestRun_ReportMkdirError(t *testing.T) {
	dir := t.TempDir()
	router := writeInDir(t, dir, "router.go", `r.Get("/api/v1/foo", h)`)
	catalog := writeInDir(t, dir, "catalog.yaml", transitiveCatalog)
	// Create a regular file, then demand the report live UNDER it. MkdirAll
	// cannot create a directory beneath a file, forcing the mkdir branch.
	blocker := writeInDir(t, dir, "blocker", "x")
	report := filepath.Join(blocker, "sub", "report.md")

	var stdout, stderr bytes.Buffer
	code := run(router, catalog, report, &stdout, &stderr)

	if code != 1 {
		t.Fatalf("run() = %d, want 1; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "mkdir failed") {
		t.Errorf("stderr missing mkdir error: %s", stderr.String())
	}
}

// ── integration against the real committed router + catalog ─────────────────────

// TestLoadRoutes_RealRouter proves the route regex still extracts declarations
// from the actual router. A silent regex breakage would zero this out.
func TestLoadRoutes_RealRouter(t *testing.T) {
	const p = "../../internal/api/router.go"
	if _, err := os.Stat(p); err != nil {
		t.Skipf("real router not present: %v", err)
	}
	routes, err := loadRoutes(p)
	if err != nil {
		t.Fatalf("loadRoutes(real) error: %v", err)
	}
	if len(routes) == 0 {
		t.Fatal("expected non-zero routes from real router.go — regex likely broken")
	}
}

// TestLoadCatalogCoverage_RealCatalog proves the route-label + transitive
// regexes match the real catalog's escaped-quote YAML encoding.
func TestLoadCatalogCoverage_RealCatalog(t *testing.T) {
	const p = "../../slo/catalog.yaml"
	if _, err := os.Stat(p); err != nil {
		t.Skipf("real catalog not present: %v", err)
	}
	transitive, perRoute, err := loadCatalogCoverage(p)
	if err != nil {
		t.Fatalf("loadCatalogCoverage(real) error: %v", err)
	}
	if !transitive {
		t.Error("expected transitive coverage from api_availability in real catalog")
	}
	const want = "/api/v1/vehicles/{vehicleID}/state"
	if _, ok := perRoute[want]; !ok {
		t.Errorf("expected per-route SLO %q in real catalog; got %v", want, perRoute)
	}
}
