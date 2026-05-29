// Command aistream-contract enforces the SSE event-schema contract
// between the Go backend writer (internal/ai/stream/writer.go) and the
// TypeScript hook (web/src/hooks/useAiStream.ts).
//
// Why this exists
// ---------------
// SSE has no built-in schema. The backend emits `event: <type>` lines
// with JSON `data:` payloads; the frontend dumb-parses both. A typo
// on either side ("toolcall" instead of "tool_call", "continuationId"
// instead of "continuation_id") corrupts the entire stream silently —
// the SPA simply drops events it does not recognise. This static
// guard keeps the shared streaming primitive consistent across both
// sides.
//
// What it checks
// --------------
//
//  1. Every event-type literal listed in EXPECTED_EVENTS appears in
//     BOTH writer.go (as a Go const value) AND useAiStream.ts (as a
//     TS union discriminator literal).
//
//  2. Every JSON field listed for each event in EXPECTED_FIELDS
//     appears in writer.go (typically as a `json:"…"` tag) AND in
//     useAiStream.ts (typically in the AiStreamEvent union or the
//     toTypedEvent narrower).
//
// What it deliberately does NOT do
// --------------------------------
//
//   - Parse the Go AST or TS AST. The point is to be a fast,
//     self-evident text-level guard. A full AST walker would add
//     maintenance cost without catching anything the literal scan
//     misses (the Go side is
//     typed; the TS side is typed; this tool catches divergence
//     BETWEEN them).
//
//   - Validate runtime payloads. That's the job of the per-package
//     unit tests (writer_test.go + useAiStream.test.ts).
//
// Usage
// -----
//
//	go run ./tools/aistream-contract     # exit 0 on match, 1 on drift
//
// CI runs this in the same lane as aivet + aigen --check.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	goWriterPath = "internal/ai/stream/writer.go"
	tsHookPath   = "web/src/hooks/useAiStream.ts"
)

// EXPECTED_EVENTS is the canonical event-type list. Adding a new event
// type means ALSO adding its EXPECTED_FIELDS entry below — the check
// fails closed if the field map is missing the type.
var expectedEvents = []string{
	"delta",
	"tool_call",
	"tool_result",
	"confirm_request",
	"done",
	"error",
}

// expectedFields maps event type → required JSON field names that
// MUST appear in both the Go writer (as `json:"<field>"` tags) and
// the TS hook (as identifiers in the typed union or narrower).
var expectedFields = map[string][]string{
	"delta":           {"text"},
	"tool_call":       {"id", "name", "arguments"},
	"tool_result":     {"id", "name", "ok", "data", "error"},
	"confirm_request": {"continuation_id", "tool", "args", "summary"},
	"done":            {"finish_reason", "usage", "in", "out"},
	"error":           {"message"},
}

func main() {
	repoRoot, err := findRepoRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "aistream-contract: %v\n", err)
		os.Exit(1)
	}

	goSrc, err := readFile(filepath.Join(repoRoot, goWriterPath))
	if err != nil {
		fmt.Fprintf(os.Stderr, "aistream-contract: %v\n", err)
		os.Exit(1)
	}
	tsSrc, err := readFile(filepath.Join(repoRoot, tsHookPath))
	if err != nil {
		fmt.Fprintf(os.Stderr, "aistream-contract: %v\n", err)
		os.Exit(1)
	}

	failures := []string{}

	// Coverage check: every expected event must have an EXPECTED_FIELDS
	// entry. Cheap defence against a typo at the top of this file.
	for _, ev := range expectedEvents {
		if _, ok := expectedFields[ev]; !ok {
			failures = append(failures, fmt.Sprintf(
				"internal: expectedEvents lists %q but expectedFields has no entry for it",
				ev))
		}
	}

	// 1. Event-type literal coverage.
	for _, ev := range expectedEvents {
		// Go side: writer.go declares each event as a constant value.
		// We check for the literal string AS QUOTED so accidental
		// substring matches (e.g. "delta" inside a comment word
		// "deltas") don't false-pass.
		quoted := fmt.Sprintf("%q", ev)
		if !strings.Contains(goSrc, quoted) {
			failures = append(failures, fmt.Sprintf(
				"%s: missing event literal %s — backend cannot emit this event type",
				goWriterPath, quoted))
		}
		if !strings.Contains(tsSrc, fmt.Sprintf("'%s'", ev)) &&
			!strings.Contains(tsSrc, fmt.Sprintf("\"%s\"", ev)) {
			failures = append(failures, fmt.Sprintf(
				"%s: missing event literal %q — frontend cannot parse this event type",
				tsHookPath, ev))
		}
	}

	// 2. Per-event field coverage.
	for _, ev := range expectedEvents {
		fields := expectedFields[ev]
		for _, field := range fields {
			// Go side: every field appears as a JSON tag literal in
			// the typed payload struct.
			goTag := fmt.Sprintf(`json:"%s`, field)
			if !strings.Contains(goSrc, goTag) {
				// Allow JSON tags with options (e.g. `json:"data,omitempty"`):
				// the prefix match above already accepts those.
				failures = append(failures, fmt.Sprintf(
					"%s: event %q missing JSON field %q (looked for %s)",
					goWriterPath, ev, field, goTag))
			}
			// TS side: each field name appears as either a property
			// access (d.<field>) or a key literal in the typed union.
			// We accept either spelling so refactors that reach for
			// destructuring later don't break the check.
			if !tsHasFieldRef(tsSrc, field) {
				failures = append(failures, fmt.Sprintf(
					"%s: event %q missing field reference for %q",
					tsHookPath, ev, field))
			}
		}
	}

	if len(failures) > 0 {
		sort.Strings(failures)
		fmt.Fprintln(os.Stderr, "aistream-contract: SSE event schema drift detected")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Backend writer (internal/ai/stream/writer.go) and frontend hook")
		fmt.Fprintln(os.Stderr, "(web/src/hooks/useAiStream.ts) declare different events or fields.")
		fmt.Fprintln(os.Stderr, "Pattern P3 forbids divergence — fix the side that's missing the literal,")
		fmt.Fprintln(os.Stderr, "or update tools/aistream-contract/main.go's expectedFields map if a new")
		fmt.Fprintln(os.Stderr, "event/field is being introduced intentionally.")
		fmt.Fprintln(os.Stderr, "")
		for _, f := range failures {
			fmt.Fprintf(os.Stderr, "  - %s\n", f)
		}
		os.Exit(1)
	}

	fmt.Printf("aistream-contract: %d events × %d fields total — backend and frontend in sync\n",
		len(expectedEvents), totalFields(expectedFields))
}

// tsHasFieldRef returns true if `field` appears in the TS source as
// EITHER a property access (`.field`) OR a quoted key in a type
// definition (`field:` / `'field':` / `"field":`). The double check
// is forgiving across the two TS styling conventions used in this
// codebase (object-literal access vs. discriminated-union typing).
func tsHasFieldRef(src, field string) bool {
	candidates := []string{
		"." + field,
		field + ":",
		"'" + field + "'",
		"\"" + field + "\"",
	}
	for _, c := range candidates {
		if strings.Contains(src, c) {
			return true
		}
	}
	return false
}

// findRepoRoot walks up from $PWD looking for a directory that
// contains both `go.mod` and `web/`. The tool may be invoked from
// any subdirectory (CI in particular); finding the repo root makes
// the file paths above stable.
func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "web")); err == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not locate repo root (no parent has go.mod + web/)")
		}
		dir = parent
	}
}

func readFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	return string(b), nil
}

func totalFields(m map[string][]string) int {
	n := 0
	for _, f := range m {
		n += len(f)
	}
	return n
}
