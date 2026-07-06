// Command ai-eval is the CLI entry point for the F6 eval harness.
//
// Usage:
//
//	ai-eval                                   # all features, fast mode
//	ai-eval --feature chatbot-llm             # one feature
//	ai-eval --all                             # all features (default)
//	ai-eval --judge                           # judged mode (needs JUDGE_PROVIDER + JUDGE_API_KEY env)
//	ai-eval --output junit.xml                # JUnit XML output
//	ai-eval --root internal/ai/strategies     # override goldens root
//
// Exit codes:
//
//	0 — every golden passed
//	1 — at least one golden failed
//	2 — CLI / I/O error before any golden ran
//
// ADR-015: this CLI never reaches a real provider unless --judge is
// passed AND a JUDGE_PROVIDER env var names a configured adapter.
// Default invocations are 100% offline (canned-only).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/ev-dev-labs/teslasync/internal/ai/eval"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		var asExit *exitErr
		if errors.As(err, &asExit) {
			os.Exit(asExit.code)
		}
		fmt.Fprintf(os.Stderr, "ai-eval: %v\n", err)
		os.Exit(2)
	}
}

type exitErr struct {
	code int
	msg  string
}

func (e *exitErr) Error() string { return e.msg }

func run(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("ai-eval", flag.ContinueOnError)
	fs.SetOutput(stderr)

	var (
		feature    = fs.String("feature", "", "single feature ID to run (default: all)")
		runAll     = fs.Bool("all", false, "run every feature under --root (default if --feature unset)")
		root       = fs.String("root", "internal/ai/strategies", "root directory to scan for goldens.yaml files")
		judge      = fs.Bool("judge", false, "enable LLM-as-judge step (requires real provider)")
		judgeModel = fs.String("judge-model", "gpt-4o", "model name for the judge call")
		output     = fs.String("output", "", "write JUnit XML report to this path")
		recordMode = fs.Bool("record", false, "record canned replies (NOT IMPLEMENTED in F6)")
	)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *runAll && *feature != "" {
		return errors.New("--all and --feature are mutually exclusive")
	}

	mode := eval.ModeFast
	if *judge {
		mode = eval.ModeJudged
	}
	if *recordMode {
		mode = eval.ModeRecord
	}

	sets, err := eval.LoadAllGoldens(*root)
	if err != nil {
		return fmt.Errorf("load goldens: %w", err)
	}
	if len(sets) == 0 {
		return fmt.Errorf("no goldens.yaml files found under %s", *root)
	}

	selected := map[string]*eval.GoldenSet{}
	if *feature != "" {
		s, ok := sets[*feature]
		if !ok {
			return fmt.Errorf("feature %q not found under %s", *feature, *root)
		}
		selected[*feature] = s
	} else {
		selected = sets
	}

	runner := &eval.Runner{Mode: mode, JudgeModel: *judgeModel}
	if mode == eval.ModeJudged {
		jp, err := buildJudgeProvider()
		if err != nil {
			return fmt.Errorf("judge provider: %w", err)
		}
		runner.JudgeProvider = jp
	}

	var allResults []eval.Result
	ctx := context.Background()
	for _, id := range sortedKeys(selected) {
		set := selected[id]
		results, err := runner.RunSet(ctx, set)
		if err != nil {
			return fmt.Errorf("run feature %s: %w", id, err)
		}
		allResults = append(allResults, results...)
	}

	if err := eval.WriteTextReport(stdout, allResults); err != nil {
		return fmt.Errorf("write text report: %w", err)
	}
	if *output != "" {
		if err := writeJUnitFile(*output, allResults); err != nil {
			return err
		}
	}

	sum := eval.SummarizeResults(allResults)
	if sum.Fail > 0 {
		return &exitErr{code: 1, msg: fmt.Sprintf("%d/%d goldens failed", sum.Fail, sum.Total)}
	}
	return nil
}

// writeJUnitFile writes the JUnit XML report for results to path. It
// surfaces both the write error and the close error (via a named
// return) so a truncated report — e.g. a short write on a full disk —
// is never silently reported as success. CI consumes this file to
// decide the eval gate's pass/fail, so partial output must fail loudly.
func writeJUnitFile(path string, results []eval.Result) (err error) {
	f, cerr := os.Create(path)
	if cerr != nil {
		return fmt.Errorf("create %s: %w", path, cerr)
	}
	defer func() {
		if closeErr := f.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close %s: %w", path, closeErr)
		}
	}()
	if werr := eval.WriteJUnitReport(f, results); werr != nil {
		return fmt.Errorf("write junit %s: %w", path, werr)
	}
	return nil
}

// sortedKeys returns map keys in deterministic order.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sortStrings(out)
	return out
}

// sortStrings is a tiny in-place sort to avoid importing "sort" here
// (keeps the CLI binary's import set minimal).
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}

// buildJudgeProvider constructs the judge provider from environment
// variables. F6 wires this minimally — the production wiring (using
// the F1 provider registry) lands when judged mode is actually used
// in CI nightly. For F6 we accept the env knob but error out if not
// configured rather than hide a hard failure.
func buildJudgeProvider() (provider.Provider, error) {
	return nil, errors.New("judge provider not yet wired; set JUDGE_PROVIDER + JUDGE_API_KEY (deferred to nightly CI integration)")
}
