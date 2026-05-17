package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/features"
)

// TestRunW1Checks_Clean asserts the live tree passes W1-A + W1-B.
// Adding a new feature without wiring its component should be caught
// by this gate before merge.
func TestRunW1Checks_Clean(t *testing.T) {
	// Resolve repo root so the file scans hit the real tree no
	// matter where `go test ./tools/aivet/...` is invoked from.
	if err := os.Chdir(repoRoot(t)); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	w1a, w1b := runW1Checks()
	if len(w1a) > 0 {
		t.Errorf("W1-A violations:\n  - %s", joinFails(w1a))
	}
	if len(w1b) > 0 {
		t.Errorf("W1-B violations:\n  - %s", joinFails(w1b))
	}
}

// TestW1APlaceholderRegex documents which substrings trigger W1-A.
// Capture order is preserved for future contributors looking up the
// rule's reach.
func TestW1APlaceholderRegex(t *testing.T) {
	hits := []string{
		"this work lands in a future slice",
		"// Coming Soon — replace before merge",
		"the wiring lands when 0065 ships",
		"// would call POST /api/v1/ai/foo",
	}
	for _, line := range hits {
		if !w1APlaceholderRE.MatchString(line) {
			t.Errorf("expected W1-A to match %q", line)
		}
	}
	misses := []string{
		"// uses useAiStream to call POST /api/v1/ai/foo", // intentionally not a placeholder
		"the future of this component is to stream",       // "future" alone is fine
		"const slice = arr.slice()",                       // bare word "slice" is fine
	}
	for _, line := range misses {
		if w1APlaceholderRE.MatchString(line) {
			t.Errorf("expected W1-A to NOT match %q", line)
		}
	}
}

// TestW1ALiteralDisabledRegex documents which JSX patterns trigger
// the literal-disabled half of W1-A.
func TestW1ALiteralDisabledRegex(t *testing.T) {
	bad := []string{
		`<Button disabled>Click</Button>`,
		`<Button disabled />`,
		`<Button disabled={true}>Save</Button>`,
		`<Button variant="primary" disabled>Save</Button>`,
	}
	for _, line := range bad {
		if !w1ALiteralDisabledRE.MatchString(line) {
			t.Errorf("expected W1-A literal-disabled to match %q", line)
		}
	}
	good := []string{
		`<Button disabled={!canStart || stream.state === 'streaming'}>Generate</Button>`,
		`<Button disabled={isStreaming}>Stop</Button>`,
		`<Button>Save</Button>`,
		`<Button onClick={onClick}>Save</Button>`,
	}
	for _, line := range good {
		if w1ALiteralDisabledRE.MatchString(line) {
			t.Errorf("expected W1-A literal-disabled to NOT match %q", line)
		}
	}
}

// TestImportsUseAiStream covers the line-based detector used by
// W1-B.
func TestImportsUseAiStream(t *testing.T) {
	good := []string{
		`import { useAiStream } from '@/hooks/useAiStream'`,
		`import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream';`,
	}
	for _, src := range good {
		if !importsUseAiStream(src) {
			t.Errorf("expected importsUseAiStream to accept %q", src)
		}
	}
	bad := []string{
		`import useAiStream from 'somewhere-else'`,
		`// useAiStream is the canonical hook`,
		`import { useChat } from '@/hooks/useChat'`,
	}
	for _, src := range bad {
		if importsUseAiStream(src) {
			t.Errorf("expected importsUseAiStream to reject %q", src)
		}
	}
}

// TestJSIdentifierOf documents the kebab→camelCase fallback.
func TestJSIdentifierOf(t *testing.T) {
	cases := map[string]string{
		"chatbot-llm":                "chatbotLlm",
		"nl-alert-builder":           "nlAlertBuilder",
		"trip-planner-llm-agent":     "tripPlannerLlmAgent",
		"foo":                        "foo",
		"x":                          "x",
	}
	for in, want := range cases {
		if got := jsIdentifierOf(in); got != want {
			t.Errorf("jsIdentifierOf(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestExtractLine documents the failure-snippet helper.
func TestExtractLine(t *testing.T) {
	src := "alpha\nbeta gamma delta\nepsilon\n"
	idx := 8 // inside "beta"
	got := extractLine(src, idx)
	if got != "beta gamma delta" {
		t.Errorf("extractLine: got %q", got)
	}
}

// TestSPAWiringTableMatchesRepo is a guard that any new SPA wiring
// entry's Component file actually exists. The features-package side
// of this check runs in TestSPAWiringComponentsExist; running it
// here too keeps aivet's CI run self-contained even if the features
// tests are skipped.
func TestSPAWiringTableMatchesRepo(t *testing.T) {
	root := repoRoot(t)
	for _, w := range features.SPAWiringTable {
		full := filepath.Join(root, "web", "src", filepath.FromSlash(w.Component))
		if _, err := os.Stat(full); err != nil {
			t.Errorf("SPAWiringTable[%s]: component does not exist at %s: %v",
				w.FeatureID, full, err)
		}
	}
}

// repoRoot walks up from CWD until a go.mod file is found.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("repoRoot: walked past filesystem root without finding go.mod")
		}
		dir = parent
	}
}

func joinFails(s []string) string {
	out := ""
	for i, v := range s {
		if i > 0 {
			out += "\n  - "
		}
		out += v
	}
	return out
}
