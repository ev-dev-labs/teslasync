// cmd/readiness-scorecard generates the OPS-13 production readiness
// scorecard.
//
//	go run ./cmd/readiness-scorecard            # print to stdout
//	go run ./cmd/readiness-scorecard -write     # write the doc
//	go run ./cmd/readiness-scorecard -check     # fail if the doc is stale
//
// Exit codes: 0 success, 1 stale/failed check, 2 setup error.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, resolveCommit, time.Now))
}

type options struct {
	root        string
	definition  string
	out         string
	write       bool
	check       bool
	summaryPath string
	commit      string
}

func parseFlags(args []string, stderr io.Writer) (*options, error) {
	opt := &options{}
	fs := flag.NewFlagSet("readiness-scorecard", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opt.root, "root", ".", "repository root")
	fs.StringVar(&opt.definition, "definition", ops.ScorecardDefinitionPath, "scorecard definition path")
	fs.StringVar(&opt.out, "out", ops.ScorecardOutputPath, "output document path (relative to -root)")
	fs.BoolVar(&opt.write, "write", false, "write the document instead of printing it")
	fs.BoolVar(&opt.check, "check", false, "exit non-zero if the committed document is stale")
	fs.StringVar(&opt.summaryPath, "summary", "", "append a markdown summary to this path")
	fs.StringVar(&opt.commit, "commit", "", "commit SHA to record (default: git rev-parse HEAD)")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return opt, nil
}

func run(args []string, stdout, stderr io.Writer, commitFn func(root string) string, now func() time.Time) int {
	opt, err := parseFlags(args, stderr)
	if err != nil {
		return 2
	}

	fsys := os.DirFS(opt.root)
	def, err := ops.LoadScorecardDefinition(fsys, opt.definition)
	if err != nil {
		fmt.Fprintf(stderr, "readiness-scorecard: %v\n", err)
		return 2
	}
	if findings := ops.ValidateScorecard(fsys, def); len(findings) > 0 {
		for _, f := range findings {
			fmt.Fprintf(stderr, "readiness-scorecard: invalid definition: %s: %s\n", f.Subject, f.Message)
		}
		return 2
	}

	commit := opt.commit
	if commit == "" && commitFn != nil {
		commit = commitFn(opt.root)
	}

	card := ops.GenerateScorecard(fsys, def, commit, now())
	rendered := ops.RenderScorecard(card)
	outPath := filepath.Join(opt.root, filepath.FromSlash(opt.out))

	switch {
	case opt.check:
		existing, readErr := os.ReadFile(outPath)
		if readErr != nil {
			fmt.Fprintf(stderr, "readiness-scorecard: %v\n", readErr)
			return 1
		}
		if normalise(string(existing)) != normalise(rendered) {
			fmt.Fprintf(stderr, "readiness-scorecard: %s is stale; run `go run ./cmd/readiness-scorecard -write`\n", opt.out)
			return 1
		}
		fmt.Fprintf(stdout, "%s is up to date\n", opt.out)
	case opt.write:
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			fmt.Fprintf(stderr, "readiness-scorecard: %v\n", err)
			return 2
		}
		if err := os.WriteFile(outPath, []byte(rendered), 0o644); err != nil {
			fmt.Fprintf(stderr, "readiness-scorecard: %v\n", err)
			return 2
		}
		fmt.Fprintf(stdout, "wrote %s — %.0f%% (%d met, %d gap, %d unverifiable)\n",
			opt.out, card.Score(), card.Met, card.Gap, card.Unverifiable)
	default:
		fmt.Fprint(stdout, rendered)
	}

	if opt.summaryPath != "" {
		if err := appendSummary(opt.summaryPath, card); err != nil {
			fmt.Fprintf(stderr, "readiness-scorecard: %v\n", err)
			return 2
		}
	}
	return 0
}

// normalise strips the volatile header lines (generation timestamp and
// commit SHA) and CRLF, so a staleness check fails on real content
// drift rather than on the clock or on an unrelated new commit.
func normalise(doc string) string {
	doc = strings.ReplaceAll(doc, "\r\n", "\n")
	lines := strings.Split(doc, "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if strings.HasPrefix(l, "Generated: ") || strings.HasPrefix(l, "Commit: ") {
			continue
		}
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}

func appendSummary(path string, card *ops.Scorecard) error {
	var b strings.Builder
	b.WriteString("## Production readiness scorecard\n\n")
	fmt.Fprintf(&b, "Overall **%.0f%%** — %d met, %d gap, %d unverifiable (excluded from the score).\n\n",
		card.Score(), card.Met, card.Gap, card.Unverifiable)
	b.WriteString("| Dimension | Score | Met | Gap | Unverifiable |\n|---|---:|---:|---:|---:|\n")
	for _, d := range card.Dimensions {
		fmt.Fprintf(&b, "| %s | %.0f%% | %d | %d | %d |\n", d.Title, d.Score(), d.Met, d.Gap, d.Unverifiable)
	}
	b.WriteString("\n")

	fh, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer fh.Close()
	_, err = fh.WriteString(b.String())
	return err
}

// resolveCommit best-effort reads HEAD. A missing git binary or a
// tarball checkout simply yields an empty commit rather than an error —
// the scorecard is still valid without it.
func resolveCommit(root string) string {
	cmd := exec.Command("git", "-C", root, "rev-parse", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
