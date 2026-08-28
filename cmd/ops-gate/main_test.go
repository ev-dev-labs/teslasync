package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

func TestRun_ListPrintsEveryCheck(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-list"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d, want 0 (stderr: %s)", code, stderr.String())
	}
	for _, name := range ops.CheckNames() {
		if !strings.Contains(stdout.String(), name) {
			t.Errorf("-list omitted %q", name)
		}
	}
}

func TestRun_RejectsUnknownCheck(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", "../..", "-check", "nope"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if !strings.Contains(stdout.String(), "unknown check") {
		t.Fatalf("expected an unknown-check error, got: %s", stdout.String())
	}
}

// TestRun_AgainstRepositoryPasses is the end-to-end assertion: the real
// tree must satisfy every gate.
func TestRun_AgainstRepositoryPasses(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../.."}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("ops-gate failed (exit %d):\n%s\n%s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "ops gates passed") {
		t.Fatalf("unexpected report: %s", stdout.String())
	}
}

func TestRun_WritesJSONAndSummary(t *testing.T) {
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "findings.json")
	summaryPath := filepath.Join(dir, "summary.md")

	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../..", "-check", "smoke", "-json", jsonPath, "-summary", summaryPath, "-quiet"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit = %d: %s", code, stdout.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("-quiet still printed: %s", stdout.String())
	}

	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatalf("read json: %v", err)
	}
	var res ops.Result
	if err := json.Unmarshal(raw, &res); err != nil {
		t.Fatalf("json is not decodable: %v", err)
	}

	summary, err := os.ReadFile(summaryPath)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	if !strings.Contains(string(summary), "## Ops gates") {
		t.Fatalf("summary missing heading: %s", summary)
	}
}

// TestRun_SummaryAppends guards the GITHUB_STEP_SUMMARY contract: two
// invocations in one job must accumulate rather than clobber.
func TestRun_SummaryAppends(t *testing.T) {
	summaryPath := filepath.Join(t.TempDir(), "summary.md")
	var stdout, stderr bytes.Buffer
	for i := 0; i < 2; i++ {
		if code := run([]string{"-root", "../..", "-check", "smoke", "-summary", summaryPath, "-quiet"}, &stdout, &stderr); code != 0 {
			t.Fatalf("exit = %d", code)
		}
	}
	body, err := os.ReadFile(summaryPath)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	if got := strings.Count(string(body), "## Ops gates"); got != 2 {
		t.Fatalf("summary blocks = %d, want 2 (the writer clobbered instead of appending)", got)
	}
}

func TestRun_PrintCriticalTables(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", "../..", "-print-critical-tables"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d: %s", code, stderr.String())
	}
	lines := strings.Fields(stdout.String())
	if len(lines) == 0 {
		t.Fatal("no critical tables printed; the restore drill workflow depends on this output")
	}
	for _, want := range []string{"vehicles", "drives", "charging_sessions"} {
		found := false
		for _, l := range lines {
			if l == want {
				found = true
			}
		}
		if !found {
			t.Errorf("critical table %q missing from output %v", want, lines)
		}
	}
}

func TestSplitChecks(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"smoke", 1},
		{"smoke,rollback", 2},
		{" smoke , rollback , ", 2},
	}
	for _, tt := range tests {
		if got := len(splitChecks(tt.in)); got != tt.want {
			t.Errorf("splitChecks(%q) = %d entries, want %d", tt.in, got, tt.want)
		}
	}
}

func TestEscapeCell(t *testing.T) {
	if got := escapeCell("a|b\nc"); got != "a\\|b c" {
		t.Fatalf("escapeCell = %q", got)
	}
}
