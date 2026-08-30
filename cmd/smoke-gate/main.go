// cmd/smoke-gate runs the OPS-01 authenticated post-deploy smoke gate.
//
//	go run ./cmd/smoke-gate \
//	  -manifest ops/smoke/checks.yaml \
//	  -base-url https://teslasync.example.com \
//	  -json smoke-report.json
//
// Exit codes: 0 = every critical check passed, 1 = a critical check
// failed, 2 = setup failure (bad manifest, missing credential).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, os.Getenv))
}

type options struct {
	manifest    string
	root        string
	baseURL     string
	webURL      string
	jsonPath    string
	summaryPath string
	timeout     time.Duration
}

func parseFlags(args []string, stderr io.Writer) (*options, error) {
	opt := &options{}
	fs := flag.NewFlagSet("smoke-gate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opt.manifest, "manifest", ops.SmokeManifestPath, "smoke manifest path (relative to -root)")
	fs.StringVar(&opt.root, "root", ".", "repository root")
	fs.StringVar(&opt.baseURL, "base-url", "", "API base URL of the deployment under test (required)")
	fs.StringVar(&opt.webURL, "web-url", "", "web base URL (defaults to -base-url)")
	fs.StringVar(&opt.jsonPath, "json", "", "write the report as JSON to this path")
	fs.StringVar(&opt.summaryPath, "summary", "", "append a markdown summary to this path")
	fs.DurationVar(&opt.timeout, "timeout", 5*time.Minute, "overall wall-clock budget for the whole run")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return opt, nil
}

func run(args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	opt, err := parseFlags(args, stderr)
	if err != nil {
		return 2
	}
	if strings.TrimSpace(opt.baseURL) == "" {
		fmt.Fprintln(stderr, "smoke-gate: -base-url is required")
		return 2
	}

	fsys := os.DirFS(opt.root)
	manifest, err := ops.LoadSmokeManifest(fsys, opt.manifest)
	if err != nil {
		fmt.Fprintf(stderr, "smoke-gate: %v\n", err)
		return 2
	}
	// Validate before dialling anything, so a broken manifest reads as a
	// configuration error rather than a mysterious failure against a
	// live deployment.
	if findings := ops.ValidateSmoke(manifest); len(findings) > 0 {
		for _, f := range findings {
			fmt.Fprintf(stderr, "smoke-gate: invalid manifest: %s: %s\n", f.Subject, f.Message)
		}
		return 2
	}

	runner := &ops.SmokeRunner{
		Manifest: manifest,
		Targets:  ops.SmokeTargets{API: opt.baseURL, Web: opt.webURL},
		Client: &http.Client{
			// Redirects are followed by default; an SPA deep link that
			// 302s to /login is a legitimate pass for the deployment
			// shell, and the per-check expectations decide.
			Timeout: 0, // per-request deadlines come from the manifest
		},
		Getenv: getenv,
	}

	ctx, cancel := context.WithTimeout(context.Background(), opt.timeout)
	defer cancel()

	report, err := runner.Run(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "smoke-gate: %v\n", err)
		if errors.Is(err, ops.ErrMissingSmokeCredential) {
			fmt.Fprintln(stderr, "smoke-gate: refusing to report a green gate from an unauthenticated run")
		}
		return 2
	}

	writeReport(stdout, report)
	if opt.jsonPath != "" {
		if err := writeJSONFile(opt.jsonPath, report); err != nil {
			fmt.Fprintf(stderr, "smoke-gate: write json: %v\n", err)
			return 2
		}
	}
	if opt.summaryPath != "" {
		if err := appendSummary(opt.summaryPath, report); err != nil {
			fmt.Fprintf(stderr, "smoke-gate: write summary: %v\n", err)
			return 2
		}
	}
	if !report.Passed {
		return 1
	}
	return 0
}

func writeReport(w io.Writer, report *ops.SmokeReport) {
	failed := 0
	for _, o := range report.Outcomes {
		status := "PASS"
		if !o.Passed {
			status = "FAIL"
			if o.Critical {
				failed++
			} else {
				status = "WARN"
			}
		}
		fmt.Fprintf(w, "%-4s %-22s %-6s %3d %8s  %s\n", status, o.ID, o.Method, o.Status, o.Latency.Round(time.Millisecond), o.URL)
		for _, f := range o.Failures {
			fmt.Fprintf(w, "       ↳ %s\n", f)
		}
	}
	fmt.Fprintf(w, "\n%d check(s), %d critical failure(s), %s elapsed\n", len(report.Outcomes), failed, report.Duration.Round(time.Millisecond))
	if report.Passed {
		fmt.Fprintln(w, "post-deploy smoke gate passed")
	}
}

func writeJSONFile(path string, report *ops.SmokeReport) error {
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

func appendSummary(path string, report *ops.SmokeReport) error {
	var b strings.Builder
	b.WriteString("## Post-deploy smoke gate\n\n")
	if report.Passed {
		b.WriteString("✅ **passed**\n\n")
	} else {
		b.WriteString("❌ **failed** — at least one critical check did not pass\n\n")
	}
	fmt.Fprintf(&b, "Target: `%s`\n\n", report.BaseURL)
	b.WriteString("| Check | Result | Status | Latency | Detail |\n|---|---|---:|---:|---|\n")
	for _, o := range report.Outcomes {
		result := "✅"
		if !o.Passed {
			result = "⚠️"
			if o.Critical {
				result = "❌"
			}
		}
		detail := strings.Join(o.Failures, "; ")
		if detail == "" {
			detail = "—"
		}
		fmt.Fprintf(&b, "| `%s` | %s | %d | %s | %s |\n",
			o.ID, result, o.Status, o.Latency.Round(time.Millisecond), strings.ReplaceAll(detail, "|", "\\|"))
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
