package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// A minimal Go source body that contains a span-start token matched by spanRE.
const spanSrc = "package x\n\nfunc f(ctx any) { _, span := tracer.Start(ctx, \"op\"); _ = span }\n"

// A Go source body with no instrumentation token.
const noSpanSrc = "package x\n\nfunc f() { _ = 1 }\n"

// newTree materialises the given repo-relative files (slash-separated) under a
// fresh temp dir and returns the root. Parent directories are created as needed.
func newTree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatalf("mkdir for %s: %v", rel, err)
		}
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}
	return root
}

func sortedSlash(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = filepath.ToSlash(s)
	}
	sort.Strings(out)
	return out
}

func eqStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// spanRE
// ---------------------------------------------------------------------------

func TestSpanRE(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"tracer.Start", "\t_, span := tracer.Start(ctx, \"op\")", true},
		{"otel.Tracer", "var tr = otel.Tracer(\"pkg\")", true},
		{"otelhttp.NewHandler", "h := otelhttp.NewHandler(next, \"x\")", true},
		{"otelpgx.NewTracer", "cfg.Tracer = otelpgx.NewTracer()", true},
		{"newCompositeTracer", "tr := newCompositeTracer(a, b)", true},
		{"StartSpan exported", "ctx, span := StartSpan(ctx)", true},
		{"startSpan unexported", "ctx, span := startSpan(ctx)", true},
		{"startProcessSpan", "ctx, span := startProcessSpan(ctx)", true},
		{"startChildSpan", "ctx, span := startChildSpan(ctx)", true},
		{"startWriterSpan", "ctx, span := startWriterSpan(ctx)", true},
		{"otelhttp.NewTransport", "rt := otelhttp.NewTransport(base)", true},
		{"tracing.StartSpan", "ctx, span := tracing.StartSpan(ctx)", true},
		{"GetTextMapPropagator", "p := otel.GetTextMapPropagator()", true},
		{"token mid-line", "before; tracer.Start( ; after", true},

		{"plain package decl", "package main", false},
		{"unrelated call", "result := foo.Bar()", false},
		{"tracer without dot", "tracerStart(ctx)", false},
		{"otel.Tracer without dot", "otelTracer(ctx)", false},
		{"StartSpan substring only", "func myStartSpanHelper() {}", false},
		{"empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := spanRE.Match([]byte(tt.in)); got != tt.want {
				t.Errorf("spanRE.Match(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// expandGlob
// ---------------------------------------------------------------------------

func TestExpandGlob(t *testing.T) {
	t.Parallel()
	files := map[string]string{
		"internal/api/middleware.go": spanSrc,
		"internal/api/router.go":     spanSrc,
		"internal/db/database.go":    spanSrc,
		"internal/a/b/deep.go":       spanSrc,
	}
	root := newTree(t, files)

	tests := []struct {
		name    string
		pattern string
		want    []string
	}{
		{"literal match", "internal/api/middleware.go", []string{"internal/api/middleware.go"}},
		{"single star", "internal/api/*.go", []string{"internal/api/middleware.go", "internal/api/router.go"}},
		{"no match", "internal/does-not-exist.go", []string{}},
		{"recursive named file", "internal/**/deep.go", []string{"internal/a/b/deep.go"}},
		{
			"recursive all go",
			"internal/**/*.go",
			[]string{
				"internal/a/b/deep.go",
				"internal/api/middleware.go",
				"internal/api/router.go",
				"internal/db/database.go",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := expandGlob(root, tt.pattern)
			if err != nil {
				t.Fatalf("expandGlob(%q) unexpected error: %v", tt.pattern, err)
			}
			gotN := sortedSlash(got)
			wantN := sortedSlash(tt.want)
			if !eqStrings(gotN, wantN) {
				t.Errorf("expandGlob(%q) = %v, want %v", tt.pattern, gotN, wantN)
			}
		})
	}
}

func TestExpandGlob_BadPattern(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	_, err := expandGlob(root, "internal/[")
	if err == nil {
		t.Fatal("expected error for malformed glob pattern")
	}
	if !errors.Is(err, filepath.ErrBadPattern) {
		t.Errorf("expected ErrBadPattern, got %v", err)
	}
}

func TestExpandGlob_MissingRecursiveBase(t *testing.T) {
	t.Parallel()
	// Walking a non-existent base must degrade gracefully to no matches, no error.
	root := t.TempDir()
	got, err := expandGlob(root, "nope/**/*.go")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected no matches, got %v", got)
	}
}

// ---------------------------------------------------------------------------
// auditFlow
// ---------------------------------------------------------------------------

func TestAuditFlow(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		files       map[string]string
		flow        flow
		wantStatus  string
		wantMatched int
		wantMissing []string
	}{
		{
			name:  "all ok",
			files: map[string]string{"a.go": spanSrc, "b.go": spanSrc, "c.go": spanSrc},
			flow: flow{
				GlobPatterns:  []string{"a.go", "b.go", "c.go"},
				MinSpanFiles:  2,
				RequiredFiles: []string{"a.go", "b.go"},
			},
			wantStatus:  "OK",
			wantMatched: 3,
			wantMissing: nil,
		},
		{
			name:  "missing flow no spans present",
			files: map[string]string{"a.go": noSpanSrc, "b.go": noSpanSrc},
			flow: flow{
				GlobPatterns:  []string{"a.go", "b.go"},
				MinSpanFiles:  1,
				RequiredFiles: []string{"a.go"},
			},
			wantStatus:  "MISSING_FLOW",
			wantMatched: 0,
			wantMissing: []string{"a.go"},
		},
		{
			name:  "missing flow files absent",
			files: map[string]string{},
			flow: flow{
				GlobPatterns:  []string{"x.go"},
				MinSpanFiles:  1,
				RequiredFiles: []string{"x.go"},
			},
			wantStatus:  "MISSING_FLOW",
			wantMatched: 0,
			wantMissing: []string{"x.go"},
		},
		{
			name:  "insufficient below threshold",
			files: map[string]string{"a.go": spanSrc, "b.go": spanSrc, "c.go": noSpanSrc},
			flow: flow{
				GlobPatterns:  []string{"a.go", "b.go", "c.go"},
				MinSpanFiles:  3,
				RequiredFiles: []string{"a.go"},
			},
			wantStatus:  "INSUFFICIENT_SPANS",
			wantMatched: 2,
			wantMissing: nil,
		},
		{
			name:  "insufficient required missing",
			files: map[string]string{"a.go": spanSrc, "b.go": spanSrc, "c.go": spanSrc, "d.go": noSpanSrc},
			flow: flow{
				GlobPatterns:  []string{"a.go", "b.go", "c.go"},
				MinSpanFiles:  2,
				RequiredFiles: []string{"a.go", "d.go"},
			},
			wantStatus:  "INSUFFICIENT_SPANS",
			wantMatched: 3,
			wantMissing: []string{"d.go"},
		},
		{
			name:  "dedup overlapping patterns",
			files: map[string]string{"a.go": spanSrc},
			flow: flow{
				GlobPatterns:  []string{"a.go", "*.go"},
				MinSpanFiles:  1,
				RequiredFiles: nil,
			},
			wantStatus:  "OK",
			wantMatched: 1,
			wantMissing: nil,
		},
		{
			name:  "required file outside glob still satisfied",
			files: map[string]string{"a.go": spanSrc, "b.go": spanSrc},
			flow: flow{
				GlobPatterns:  []string{"a.go"},
				MinSpanFiles:  1,
				RequiredFiles: []string{"a.go", "b.go"},
			},
			wantStatus:  "OK",
			wantMatched: 1,
			wantMissing: nil,
		},
		{
			name:  "star pattern selects only span files",
			files: map[string]string{"sub/a.go": spanSrc, "sub/b.go": noSpanSrc},
			flow: flow{
				GlobPatterns:  []string{"sub/*.go"},
				MinSpanFiles:  1,
				RequiredFiles: []string{"sub/a.go"},
			},
			wantStatus:  "OK",
			wantMatched: 1,
			wantMissing: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			root := newTree(t, tt.files)
			got := auditFlow(root, tt.flow)
			if got.Status != tt.wantStatus {
				t.Errorf("Status = %q, want %q (matched=%v missing=%v)",
					got.Status, tt.wantStatus, got.MatchedFiles, got.MissingReqs)
			}
			if len(got.MatchedFiles) != tt.wantMatched {
				t.Errorf("matched count = %d, want %d (%v)",
					len(got.MatchedFiles), tt.wantMatched, got.MatchedFiles)
			}
			if !eqStrings(sortedSlash(got.MissingReqs), sortedSlash(tt.wantMissing)) {
				t.Errorf("missing = %v, want %v", got.MissingReqs, tt.wantMissing)
			}
		})
	}
}

// TestAuditFlow_MatchedPathsAreRepoRelative locks in that matched files are
// reported as forward-slash, root-relative paths (the report contract).
func TestAuditFlow_MatchedPathsAreRepoRelative(t *testing.T) {
	t.Parallel()
	root := newTree(t, map[string]string{
		"internal/api/middleware.go": spanSrc,
		"internal/db/database.go":    spanSrc,
	})
	f := flow{
		GlobPatterns: []string{"internal/api/middleware.go", "internal/db/database.go"},
		MinSpanFiles: 2,
	}
	got := auditFlow(root, f)
	want := []string{"internal/api/middleware.go", "internal/db/database.go"}
	if !eqStrings(got.MatchedFiles, want) {
		t.Errorf("MatchedFiles = %v, want %v", got.MatchedFiles, want)
	}
	// The flow itself is preserved verbatim in the result.
	if !eqStrings(got.Flow.GlobPatterns, f.GlobPatterns) {
		t.Errorf("result flow mismatch: %v", got.Flow.GlobPatterns)
	}
}

// ---------------------------------------------------------------------------
// renderReport
// ---------------------------------------------------------------------------

func TestRenderReport(t *testing.T) {
	t.Parallel()
	results := []flowResult{
		{
			Flow:         flow{Name: "flow_one", Description: "Desc One", MinSpanFiles: 2},
			MatchedFiles: []string{"internal/api/middleware.go", "internal/db/database.go"},
			MissingReqs:  nil,
			Status:       "OK",
		},
		{
			Flow:         flow{Name: "flow_two", Description: "Desc Two", MinSpanFiles: 4},
			MatchedFiles: []string{"x.go"},
			MissingReqs:  []string{"y.go"},
			Status:       "INSUFFICIENT_SPANS",
		},
	}
	out := renderReport(results)

	wantSubstrings := []string{
		"# Phase 44 — Trace coverage audit",
		"Desc One", "`flow_one`",
		"Desc Two", "`flow_two`",
		"Status: **OK**",
		"Status: **INSUFFICIENT_SPANS**",
		"Instrumented files matched: 2 (threshold ≥ 2)",
		"Instrumented files matched: 1 (threshold ≥ 4)",
		"Missing required-files",
		"`y.go`",
		"Matched files:",
		"`internal/api/middleware.go`",
	}
	for _, s := range wantSubstrings {
		if !strings.Contains(out, s) {
			t.Errorf("report missing substring %q\n---\n%s", s, out)
		}
	}
	if strings.HasSuffix(out, "\n\n") {
		t.Fatal("report must end with exactly one newline")
	}
	// An OK flow with no missing requirements must not emit the missing header.
	okSection := out[strings.Index(out, "`flow_one`"):strings.Index(out, "`flow_two`")]
	if strings.Contains(okSection, "Missing required-files") {
		t.Errorf("OK flow section should not contain missing-required header:\n%s", okSection)
	}
}

func TestRenderReport_Empty(t *testing.T) {
	t.Parallel()
	out := renderReport(nil)
	if !strings.Contains(out, "# Phase 44 — Trace coverage audit") {
		t.Errorf("empty report missing header: %q", out)
	}
	if strings.Contains(out, "Status:") {
		t.Errorf("empty report should have no flow sections: %q", out)
	}
}

// ---------------------------------------------------------------------------
// writeReport
// ---------------------------------------------------------------------------

func TestWriteReport_CreatesNestedDirs(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "docs", "runbooks", "report.md")
	body := "# hello\n\nbody\n"
	if err := writeReport(path, body); err != nil {
		t.Fatalf("writeReport error: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != body {
		t.Errorf("content = %q, want %q", string(got), body)
	}
}

func TestWriteReport_MkdirFailsWhenParentIsFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, []byte("i am a file"), 0o600); err != nil {
		t.Fatalf("seed blocker: %v", err)
	}
	// blocker is a file; asking to create a dir under it must fail.
	path := filepath.Join(blocker, "report.md")
	err := writeReport(path, "x")
	if err == nil {
		t.Fatal("expected error when a path component is a file")
	}
	if !strings.Contains(err.Error(), "create report dir") {
		t.Errorf("error not wrapped with context: %v", err)
	}
}

// ---------------------------------------------------------------------------
// run (exit-code + IO orchestration)
// ---------------------------------------------------------------------------

func okFlows() []flow {
	return []flow{{
		Name:          "sample",
		Description:   "Sample flow",
		GlobPatterns:  []string{"a.go", "b.go"},
		MinSpanFiles:  2,
		RequiredFiles: []string{"a.go"},
	}}
}

func TestRun_AllOK(t *testing.T) {
	t.Parallel()
	root := newTree(t, map[string]string{"a.go": spanSrc, "b.go": spanSrc})
	reportPath := filepath.Join(t.TempDir(), "out", "report.md")

	var stdout, stderr bytes.Buffer
	code := run(&stdout, &stderr, root, reportPath, okFlows())
	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stderr=%s)", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "# Phase 44 — Trace coverage audit") {
		t.Errorf("stdout missing report header: %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "ALL FLOWS OK") {
		t.Errorf("stderr missing OK message: %q", stderr.String())
	}
	if _, err := os.Stat(reportPath); err != nil {
		t.Errorf("report not written: %v", err)
	}
}

func TestRun_GapsFound(t *testing.T) {
	t.Parallel()
	root := newTree(t, map[string]string{"a.go": noSpanSrc})
	reportPath := filepath.Join(t.TempDir(), "report.md")

	fs := []flow{{
		Name:          "sample",
		Description:   "Sample flow",
		GlobPatterns:  []string{"a.go"},
		MinSpanFiles:  1,
		RequiredFiles: []string{"a.go"},
	}}

	var stdout, stderr bytes.Buffer
	code := run(&stdout, &stderr, root, reportPath, fs)
	if code != 2 {
		t.Fatalf("exit code = %d, want 2 (stderr=%s)", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "GAPS FOUND") {
		t.Errorf("stderr missing gap message: %q", stderr.String())
	}
	// Report is still emitted to stdout on a gap.
	if !strings.Contains(stdout.String(), "MISSING_FLOW") {
		t.Errorf("stdout should report the gap status: %q", stdout.String())
	}
}

func TestRun_WriteFailureReturnsOne(t *testing.T) {
	t.Parallel()
	root := newTree(t, map[string]string{"a.go": spanSrc, "b.go": spanSrc})
	// Make the report's parent directory un-creatable by planting a file there.
	blocker := filepath.Join(root, "blk")
	if err := os.WriteFile(blocker, []byte("file"), 0o600); err != nil {
		t.Fatalf("seed blocker: %v", err)
	}
	reportPath := filepath.Join(blocker, "report.md")

	var stdout, stderr bytes.Buffer
	code := run(&stdout, &stderr, root, reportPath, okFlows())
	if code != 1 {
		t.Fatalf("exit code = %d, want 1 (stderr=%s)", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "report write failed") {
		t.Errorf("stderr missing write-failure message: %q", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout should be empty on write failure, got: %q", stdout.String())
	}
}

// ---------------------------------------------------------------------------
// Integration: real repository flows resolve against real files.
// ---------------------------------------------------------------------------

func findRepoRoot() (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

func TestAuditFlow_RealRepo(t *testing.T) {
	t.Parallel()
	root, ok := findRepoRoot()
	if !ok {
		t.Skip("repo root (go.mod) not found; skipping real-repo integration test")
	}

	valid := map[string]bool{"OK": true, "INSUFFICIENT_SPANS": true, "MISSING_FLOW": true}
	results := make([]flowResult, 0, len(flows))
	totalMatched := 0
	for _, f := range flows {
		r := auditFlow(root, f)
		results = append(results, r)

		if !valid[r.Status] {
			t.Errorf("flow %q: unexpected status %q", f.Name, r.Status)
		}
		// Every matched path the auditor reports must resolve to a real file
		// under the repo root — proves relative-path resolution end to end.
		for _, m := range r.MatchedFiles {
			abs := filepath.Join(root, filepath.FromSlash(m))
			if _, err := os.Stat(abs); err != nil {
				t.Errorf("flow %q matched path %q does not resolve: %v", f.Name, m, err)
			}
		}
		totalMatched += len(r.MatchedFiles)
	}

	// The audit must discover real instrumentation somewhere in the tree; a
	// zero total would mean the walking/reading path is broken.
	if totalMatched == 0 {
		t.Error("real-repo audit matched zero instrumented files across all flows")
	}

	report := renderReport(results)
	for _, f := range flows {
		if !strings.Contains(report, "`"+f.Name+"`") {
			t.Errorf("report missing flow section for %q", f.Name)
		}
	}
}

// TestSSEBroadcastFlowPathIsCurrent guards the stale-path fix: the SSE handler
// moved from internal/api/sse_handler.go into the internal/api/sse subpackage,
// so the flow must reference the current file and audit as OK. A regression
// here means the auditor is emitting a false MISSING_FLOW for SSE tracing.
func TestSSEBroadcastFlowPathIsCurrent(t *testing.T) {
	t.Parallel()
	root, ok := findRepoRoot()
	if !ok {
		t.Skip("repo root (go.mod) not found; skipping real-repo integration test")
	}

	var f flow
	found := false
	for _, x := range flows {
		if x.Name == "sse_broadcast" {
			f, found = x, true
			break
		}
	}
	if !found {
		t.Fatal("sse_broadcast flow not present in flows")
	}

	paths := append(append([]string{}, f.GlobPatterns...), f.RequiredFiles...)
	for _, p := range paths {
		abs := filepath.Join(root, filepath.FromSlash(p))
		if _, err := os.Stat(abs); err != nil {
			t.Errorf("sse_broadcast references stale path %q: %v", p, err)
		}
	}

	if r := auditFlow(root, f); r.Status != "OK" {
		t.Errorf("sse_broadcast status = %q, want OK (matched=%v missing=%v)",
			r.Status, r.MatchedFiles, r.MissingReqs)
	}
}
