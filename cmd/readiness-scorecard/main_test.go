package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func at() time.Time { return time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC) }

func noCommit(string) string { return "" }

func TestRun_GeneratesAgainstTheRepository(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../.."}, &stdout, &stderr, noCommit, at)
	if code != 0 {
		t.Fatalf("exit = %d: %s", code, stderr.String())
	}
	doc := stdout.String()

	for _, want := range []string{
		"# Production readiness scorecard",
		"GENERATED FILE",
		"## Availability",
		"## Latency & performance",
		"## Security & supply chain",
		"## Accessibility",
		"## Recovery & resilience",
		"## Cost & resource control",
		"## Open gaps",
		"## Not machine-verifiable",
	} {
		if !strings.Contains(doc, want) {
			t.Errorf("generated scorecard missing %q", want)
		}
	}
}

// TestRun_UnverifiableCriteriaAreNeverCountedAsMet is the honesty
// guarantee: anything needing a real environment is listed separately
// and excluded from the score.
func TestRun_UnverifiableCriteriaAreNeverCountedAsMet(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", "../.."}, &stdout, &stderr, noCommit, at); code != 0 {
		t.Fatalf("exit = %d: %s", code, stderr.String())
	}
	doc := stdout.String()

	if !strings.Contains(doc, "`unverifiable`") {
		t.Fatal("no unverifiable criterion in the output; the drill-dependent criteria should be listed as such")
	}
	// The capacity-executed and restore-drill-executed criteria are the
	// two that genuinely need infrastructure. They must never be `met`
	// from a static run.
	for _, id := range []string{"lat-capacity-executed", "rec-restore-drill-executed"} {
		idx := strings.Index(doc, id)
		if idx < 0 {
			t.Fatalf("criterion %q missing from the scorecard", id)
		}
		row := doc[idx:]
		if end := strings.Index(row, "\n"); end > 0 {
			row = row[:end]
		}
		if !strings.Contains(row, "`unverifiable`") {
			t.Errorf("criterion %q is not marked unverifiable: %s", id, row)
		}
	}
}

func TestRun_WriteThenCheckIsClean(t *testing.T) {
	dir := t.TempDir()
	// Copy the definition and the evidence-bearing paths is impractical;
	// instead write into a temp output path inside the real repo tree.
	out := filepath.Join("..", "..", "docs", "operations", "scorecard-test-artifact.md")
	defer os.Remove(filepath.Join("..", "..", "docs", "operations", "scorecard-test-artifact.md"))
	_ = dir

	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", "../..", "-out", "docs/operations/scorecard-test-artifact.md", "-write"}, &stdout, &stderr, noCommit, at); code != 0 {
		t.Fatalf("write exit = %d: %s", code, stderr.String())
	}
	if _, err := os.Stat(out); err != nil {
		t.Fatalf("document not written: %v", err)
	}

	stdout.Reset()
	stderr.Reset()
	// A later timestamp must NOT make the check fail — only content changes should.
	later := func() time.Time { return at().Add(48 * time.Hour) }
	if code := run([]string{"-root", "../..", "-out", "docs/operations/scorecard-test-artifact.md", "-check"}, &stdout, &stderr, noCommit, later); code != 0 {
		t.Fatalf("check exit = %d (a clock change must not be treated as staleness): %s", code, stderr.String())
	}
}

func TestRun_CheckDetectsStaleDocument(t *testing.T) {
	path := filepath.Join("..", "..", "docs", "operations", "scorecard-stale-artifact.md")
	if err := os.WriteFile(path, []byte("# not the generated scorecard\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	defer os.Remove(path)

	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../..", "-out", "docs/operations/scorecard-stale-artifact.md", "-check"}, &stdout, &stderr, noCommit, at)
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "stale") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_RejectsAnInvalidDefinition(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "ops", "scorecard"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	body := "version: 1\nstatus_values: [met, gap, unverifiable]\ndimensions:\n  - id: availability\n    title: A\n    question: q\n    criteria:\n      - id: c1\n        statement: s\n        evidence: [x]\n        verification: v\n        gate: not-a-gate\n"
	if err := os.WriteFile(filepath.Join(dir, "ops", "scorecard", "dimensions.yaml"), []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", dir}, &stdout, &stderr, noCommit, at)
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "invalid definition") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_AppendsSummary(t *testing.T) {
	summary := filepath.Join(t.TempDir(), "summary.md")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", "../..", "-summary", summary}, &stdout, &stderr, noCommit, at); code != 0 {
		t.Fatalf("exit = %d: %s", code, stderr.String())
	}
	body, err := os.ReadFile(summary)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	if !strings.Contains(string(body), "Production readiness scorecard") {
		t.Fatalf("summary = %s", body)
	}
}

func TestNormaliseStripsVolatileHeaderAndCRLF(t *testing.T) {
	a := "# doc\r\nGenerated: 2026-01-01T00:00:00Z\r\nCommit: `aaa`\r\nbody\r\n"
	b := "# doc\nGenerated: 2030-12-31T23:59:59Z\nCommit: `bbb`\nbody\n"
	if normalise(a) != normalise(b) {
		t.Fatalf("normalise did not equalise:\n%q\n%q", normalise(a), normalise(b))
	}
	if normalise(a) == normalise("# doc\nbody changed\n") {
		t.Fatal("normalise must still detect real content drift")
	}
}

// TestRun_CheckToleratesANewCommit: the committed scorecard must not go
// stale merely because HEAD moved.
func TestRun_CheckToleratesANewCommit(t *testing.T) {
	var stdout, stderr bytes.Buffer
	commit := func(string) string { return "0000000000000000000000000000000000000000" }
	if code := run([]string{"-root", "../..", "-check"}, &stdout, &stderr, commit, at); code != 0 {
		t.Fatalf("exit = %d (a different commit SHA must not be treated as staleness): %s", code, stderr.String())
	}
}
