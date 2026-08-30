// cmd/ops-gate runs the static release/operations gates.
//
//	go run ./cmd/ops-gate                     # every check
//	go run ./cmd/ops-gate -check migrations   # one check
//	go run ./cmd/ops-gate -list               # what is available
//	go run ./cmd/ops-gate -json findings.json # machine-readable output
//
// Exit codes: 0 = no blocking findings, 1 = at least one error.
// Advisories never change the exit code; they exist so pre-existing debt
// stays visible without blocking unrelated work.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// options are the parsed CLI flags. Carved out so tests can drive the
// core without touching os.Args.
type options struct {
	root                string
	checks              string
	list                bool
	jsonPath            string
	summaryPath         string
	writeBaseline       bool
	printCriticalTables bool
	printFixtures       bool
	verifyRender        string
	expectCanary        bool
	minGrace            int
	drainPort           int
	quiet               bool
}

func parseFlags(args []string, stderr io.Writer) (*options, error) {
	opt := &options{}
	fs := flag.NewFlagSet("ops-gate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opt.root, "root", ".", "repository root to inspect")
	fs.StringVar(&opt.checks, "check", "", "comma-separated checks to run (default: all)")
	fs.BoolVar(&opt.list, "list", false, "list the available checks and exit")
	fs.StringVar(&opt.jsonPath, "json", "", "write findings as JSON to this path")
	fs.StringVar(&opt.summaryPath, "summary", "", "append a markdown summary to this path (e.g. $GITHUB_STEP_SUMMARY)")
	fs.BoolVar(&opt.writeBaseline, "write-baseline", false, "config-parity: rewrite the drift baseline from the current tree")
	fs.BoolVar(&opt.printCriticalTables, "print-critical-tables", false, "restore: print ops/restore/drill.yaml critical_tables, one per line")
	fs.BoolVar(&opt.printFixtures, "print-fixtures", false, "fixtures: print the registered fixture paths, one per line")
	fs.StringVar(&opt.verifyRender, "verify-helm-render", "", "verify a `helm template` output file for selector overlap and drain exposure ('-' reads stdin)")
	fs.BoolVar(&opt.expectCanary, "expect-canary", false, "with -verify-helm-render: require a canary workload to be present")
	fs.IntVar(&opt.minGrace, "min-grace-seconds", 80, "with -verify-helm-render: minimum terminationGracePeriodSeconds for api pods")
	fs.IntVar(&opt.drainPort, "drain-port", 8090, "with -verify-helm-render: the isolated drain port that no Service may publish")
	fs.BoolVar(&opt.quiet, "quiet", false, "suppress the human-readable report")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return opt, nil
}

func run(args []string, stdout, stderr io.Writer) int {
	opt, err := parseFlags(args, stderr)
	if err != nil {
		return 2
	}
	fsys := os.DirFS(opt.root)

	if opt.list {
		for _, c := range ops.Checks() {
			fmt.Fprintf(stdout, "%-14s %s\n", c.Name, c.Description)
		}
		return 0
	}

	if opt.printCriticalTables {
		return printCriticalTables(fsys, stdout, stderr)
	}
	if opt.printFixtures {
		return printFixtures(fsys, stdout, stderr)
	}
	if opt.verifyRender != "" {
		return verifyHelmRender(opt, stdout, stderr)
	}
	if opt.writeBaseline {
		return writeParityBaseline(fsys, opt.root, stdout, stderr)
	}

	res := ops.RunChecks(fsys, splitChecks(opt.checks))
	if !opt.quiet {
		writeReport(stdout, res)
	}
	if opt.jsonPath != "" {
		if err := writeJSONFile(opt.jsonPath, res); err != nil {
			fmt.Fprintf(stderr, "write json: %v\n", err)
			return 2
		}
	}
	if opt.summaryPath != "" {
		if err := appendSummary(opt.summaryPath, res); err != nil {
			fmt.Fprintf(stderr, "write summary: %v\n", err)
			return 2
		}
	}
	if !res.OK() {
		return 1
	}
	return 0
}

func splitChecks(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func writeReport(w io.Writer, res *ops.Result) {
	errors := res.Errors()
	advisories := res.Advisories()

	for _, f := range advisories {
		fmt.Fprintf(w, "ADVISORY %-14s %-40s %s\n", f.Check, f.Subject, f.Message)
	}
	for _, f := range errors {
		fmt.Fprintf(w, "ERROR    %-14s %-40s %s\n", f.Check, f.Subject, f.Message)
	}
	fmt.Fprintf(w, "\n%d error(s), %d advisory(ies)\n", len(errors), len(advisories))
	if len(errors) == 0 {
		fmt.Fprintln(w, "ops gates passed")
	}
}

func writeJSONFile(path string, res *ops.Result) error {
	body, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

// appendSummary writes a GitHub-flavoured markdown block. It appends so
// several gate invocations in one job accumulate rather than clobber.
func appendSummary(path string, res *ops.Result) error {
	var b strings.Builder
	errors := res.Errors()
	advisories := res.Advisories()

	b.WriteString("## Ops gates\n\n")
	if len(errors) == 0 {
		fmt.Fprintf(&b, "✅ **passed** — 0 errors, %d advisories\n\n", len(advisories))
	} else {
		fmt.Fprintf(&b, "❌ **failed** — %d errors, %d advisories\n\n", len(errors), len(advisories))
	}
	if len(errors) > 0 {
		b.WriteString("| Check | Subject | Problem |\n|---|---|---|\n")
		for _, f := range errors {
			fmt.Fprintf(&b, "| `%s` | `%s` | %s |\n", f.Check, f.Subject, escapeCell(f.Message))
		}
		b.WriteString("\n")
	}
	if len(advisories) > 0 {
		fmt.Fprintf(&b, "<details><summary>%d advisories (known debt, non-blocking)</summary>\n\n", len(advisories))
		b.WriteString("| Check | Subject | Note |\n|---|---|---|\n")
		for _, f := range advisories {
			fmt.Fprintf(&b, "| `%s` | `%s` | %s |\n", f.Check, f.Subject, escapeCell(f.Message))
		}
		b.WriteString("\n</details>\n\n")
	}

	fh, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer fh.Close()
	_, err = fh.WriteString(b.String())
	return err
}

func escapeCell(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "|", "\\|"), "\n", " ")
}

// verifyHelmRender applies the post-template invariants (selector
// disjointness, drain exposure, grace period) to a `helm template`
// stream. These cannot be checked statically from values.yaml alone —
// the overlap only becomes visible once labels and selectors are
// rendered side by side.
func verifyHelmRender(opt *options, stdout, stderr io.Writer) int {
	var src io.Reader
	if opt.verifyRender == "-" {
		src = os.Stdin
	} else {
		fh, err := os.Open(opt.verifyRender)
		if err != nil {
			fmt.Fprintf(stderr, "ops-gate: %v\n", err)
			return 2
		}
		defer fh.Close()
		src = fh
	}
	// Buffered once: both checks need the whole stream, and stdin can
	// only be consumed a single time.
	render, err := io.ReadAll(src)
	if err != nil {
		fmt.Fprintf(stderr, "ops-gate: read render: %v\n", err)
		return 2
	}

	exp := ops.DefaultRenderExpectations()
	exp.DrainPort = opt.drainPort
	exp.MinGracePeriodSeconds = opt.minGrace
	exp.ExpectCanary = opt.expectCanary

	res := &ops.Result{}
	res.Add(ops.VerifyHelmRender(bytes.NewReader(render), exp)...)
	res.Add(ops.VerifyMigrationGate(string(render))...)
	res.Sort()
	if !opt.quiet {
		writeReport(stdout, res)
	}
	if !res.OK() {
		return 1
	}
	return 0
}

// printFixtures lists the registered SQL fixtures so the CI job that
// EXECUTES them stays driven by the registry rather than a hardcoded
// list that can silently fall out of sync.
func printFixtures(fsys fs.FS, stdout, stderr io.Writer) int {
	paths, err := ops.FixturePaths(fsys)
	if err != nil {
		fmt.Fprintf(stderr, "%v\n", err)
		return 2
	}
	for _, p := range paths {
		fmt.Fprintln(stdout, p)
	}
	return 0
}

func printCriticalTables(fsys fs.FS, stdout, stderr io.Writer) int {
	drill, err := ops.LoadRestoreDrill(fsys, ops.RestoreDrillPath)
	if err != nil {
		fmt.Fprintf(stderr, "%v\n", err)
		return 2
	}
	for _, t := range drill.CriticalTables {
		fmt.Fprintln(stdout, t)
	}
	return 0
}

// writeParityBaseline regenerates the OPS-06 ratchet from the current
// tree. It is deliberately a separate, explicit flag: silently
// re-baselining on every run would turn the ratchet into a rubber stamp.
func writeParityBaseline(fsys fs.FS, root string, stdout, stderr io.Writer) int {
	m, err := ops.LoadParityManifest(fsys, ops.ParityManifestPath)
	if err != nil {
		fmt.Fprintf(stderr, "%v\n", err)
		return 2
	}
	snap, err := m.Snapshot(fsys)
	if err != nil {
		fmt.Fprintf(stderr, "%v\n", err)
		return 2
	}
	drift := m.ComputeParityDrift(snap)

	path := root + "/" + ops.ParityManifestPath
	existing, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(stderr, "read %s: %v\n", path, err)
		return 2
	}
	idx := strings.Index(string(existing), "\nbaseline:")
	if idx < 0 {
		fmt.Fprintf(stderr, "%s has no baseline: section\n", path)
		return 2
	}

	var b strings.Builder
	b.WriteString(string(existing)[:idx+1])
	b.WriteString("baseline:\n")
	emit := func(name string, values []string) {
		if len(values) == 0 {
			fmt.Fprintf(&b, "  %s: []\n", name)
			return
		}
		fmt.Fprintf(&b, "  %s:\n", name)
		for _, v := range values {
			fmt.Fprintf(&b, "    - %s\n", v)
		}
	}
	emit("missing_in_compose", drift.MissingInCompose)
	emit("missing_in_helm", drift.MissingInHelm)
	emit("unknown_in_compose", drift.UnknownInCompose)
	emit("unknown_in_helm", drift.UnknownInHelm)

	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		fmt.Fprintf(stderr, "write %s: %v\n", path, err)
		return 2
	}
	fmt.Fprintf(stdout, "rewrote the config-parity baseline in %s\n", ops.ParityManifestPath)
	fmt.Fprintf(stdout, "  missing_in_compose: %d\n  missing_in_helm:    %d\n  unknown_in_compose: %d\n  unknown_in_helm:    %d\n",
		len(drift.MissingInCompose), len(drift.MissingInHelm), len(drift.UnknownInCompose), len(drift.UnknownInHelm))
	return 0
}
