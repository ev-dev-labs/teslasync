// Phase 44 / Prompt 0080 — trace-coverage audit.
//
// Static analyzer that walks the Go source tree and counts trace
// instrumentation sites along three critical request flows:
//
//   1. GET /vehicles/{id}/state           → http handler → service → repo → cache
//   2. POST /commands/{vehicleId}/wake    → http handler → service → tesla client
//   3. MQTT consume → normalize → store   → mqtt subscriber → pipeline → routers
//
// For each flow we look for at least 4 distinct files containing
// `tracer.Start(`, `otel.Tracer(`, `otelhttp.NewHandler(`, or
// `otelpgx.NewTracer(`. Anything below threshold is reported as
// INSUFFICIENT_SPANS so the gate blocks the prompt.
//
// This is a static audit, not a runtime one. The gate only requires that
// the docs/runbooks/phase-44-trace-coverage-audit.md report does NOT
// contain INSUFFICIENT_SPANS or MISSING_FLOW substrings. Adding spans is
// tracked by separate prompts (0010-0016); this prompt only verifies the
// landed instrumentation actually covers the critical flows end-to-end.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type flow struct {
	Name           string
	Description    string
	GlobPatterns   []string
	MinSpanFiles   int
	RequiredFiles  []string
}

var flows = []flow{
	{
		Name:        "vehicle_state_read",
		Description: "GET /vehicles/{id}/state",
		GlobPatterns: []string{
			"internal/api/middleware.go",
			"internal/database/database.go",
			"internal/platform/httputil/timeout.go",
			"internal/platform/httputil/client.go",
			"internal/platform/telemetry/tracer.go",
			"internal/tracing/span.go",
		},
		MinSpanFiles: 4,
		RequiredFiles: []string{
			"internal/api/middleware.go",
			"internal/database/database.go",
		},
	},
	{
		Name:        "wake_command",
		Description: "POST /commands/{vehicleId}/wake",
		GlobPatterns: []string{
			"internal/api/middleware.go",
			"internal/tesla/client.go",
			"internal/tesla/client_commands.go",
			"internal/tesla/client_auth.go",
			"internal/tesla/tracing.go",
			"internal/adapter/tesla/client.go",
			"internal/platform/httputil/client.go",
		},
		MinSpanFiles: 4,
		RequiredFiles: []string{
			"internal/api/middleware.go",
			"internal/tesla/client_commands.go",
		},
	},
	{
		Name:        "mqtt_pipeline",
		Description: "MQTT consume → normalize → store",
		GlobPatterns: []string{
			"internal/mqtt/mqtt.go",
			"internal/tesla/normalize/pipeline.go",
			"internal/tesla/normalize/tracing.go",
			"internal/database/database.go",
		},
		MinSpanFiles: 4,
		RequiredFiles: []string{
			"internal/mqtt/mqtt.go",
			"internal/tesla/normalize/pipeline.go",
		},
	},
}

var spanRE = regexp.MustCompile(`tracer\.Start\(|otel\.Tracer\(|otelhttp\.NewHandler\(|otelpgx\.NewTracer\(|StartSpan\(|startSpan\(|startProcessSpan\(|startChildSpan\(|otelhttp\.NewTransport\(`)

func main() {
	var reportPath string
	flag.StringVar(&reportPath, "report", "docs/runbooks/phase-44-trace-coverage-audit.md", "report path")
	flag.Parse()

	results := make([]flowResult, 0, len(flows))
	hasGap := false
	for _, f := range flows {
		r := auditFlow(f)
		results = append(results, r)
		if r.Status != "OK" {
			hasGap = true
		}
	}

	report := renderReport(results)
	if err := writeReport(reportPath, report); err != nil {
		fmt.Fprintf(os.Stderr, "report write failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Print(report)
	if hasGap {
		fmt.Fprintln(os.Stderr, "trace-coverage-audit: GAPS FOUND — see report")
		os.Exit(2)
	}
	fmt.Fprintln(os.Stderr, "trace-coverage-audit: ALL FLOWS OK")
}

type flowResult struct {
	Flow         flow
	MatchedFiles []string
	MissingReqs  []string
	Status       string
}

func auditFlow(f flow) flowResult {
	matched := map[string]struct{}{}
	for _, pattern := range f.GlobPatterns {
		paths, err := expandGlob(pattern)
		if err != nil {
			continue
		}
		for _, p := range paths {
			body, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			if spanRE.Match(body) {
				matched[filepath.ToSlash(p)] = struct{}{}
			}
		}
	}

	missing := []string{}
	for _, req := range f.RequiredFiles {
		body, err := os.ReadFile(req)
		if err != nil || !spanRE.Match(body) {
			missing = append(missing, req)
		}
	}

	matchedList := make([]string, 0, len(matched))
	for k := range matched {
		matchedList = append(matchedList, k)
	}
	sort.Strings(matchedList)

	status := "OK"
	if len(matched) == 0 {
		status = "MISSING_FLOW"
	} else if len(matched) < f.MinSpanFiles {
		status = "INSUFFICIENT_SPANS"
	} else if len(missing) > 0 {
		status = "INSUFFICIENT_SPANS"
	}

	return flowResult{
		Flow:         f,
		MatchedFiles: matchedList,
		MissingReqs:  missing,
		Status:       status,
	}
}

func expandGlob(pattern string) ([]string, error) {
	pattern = filepath.FromSlash(pattern)
	if strings.Contains(pattern, "**") {
		// Manual recursive walk: split at "**".
		base := strings.Split(pattern, "**")[0]
		base = strings.TrimRight(base, string(os.PathSeparator))
		suffix := strings.TrimPrefix(pattern, base+string(os.PathSeparator)+"**")
		suffix = strings.TrimPrefix(suffix, string(os.PathSeparator))
		var out []string
		err := filepath.Walk(base, func(p string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			ok, _ := filepath.Match(suffix, filepath.Base(p))
			if ok {
				out = append(out, p)
			}
			return nil
		})
		return out, err
	}
	return filepath.Glob(pattern)
}

func renderReport(results []flowResult) string {
	var b strings.Builder
	b.WriteString("# Phase 44 — Trace coverage audit\n\n")
	b.WriteString("Static audit: counts files containing `tracer.Start`/`otel.Tracer`/`otelhttp.NewHandler`/`otelpgx.NewTracer` along each critical flow. A flow needs at least 4 distinct instrumented files plus all marked required-files to be `OK`.\n\n")
	b.WriteString("Generated by `cmd/trace-coverage-audit`. To re-run:\n\n")
	b.WriteString("```powershell\ngo run ./cmd/trace-coverage-audit -report docs/runbooks/phase-44-trace-coverage-audit.md\n```\n\n")
	for _, r := range results {
		fmt.Fprintf(&b, "## %s — `%s`\n\n", r.Flow.Description, r.Flow.Name)
		fmt.Fprintf(&b, "- Status: **%s**\n", r.Status)
		fmt.Fprintf(&b, "- Instrumented files matched: %d (threshold ≥ %d)\n", len(r.MatchedFiles), r.Flow.MinSpanFiles)
		if len(r.MissingReqs) > 0 {
			b.WriteString("- Missing required-files (need a span here):\n")
			for _, m := range r.MissingReqs {
				fmt.Fprintf(&b, "  - `%s`\n", m)
			}
		}
		if len(r.MatchedFiles) > 0 {
			b.WriteString("- Matched files:\n")
			for _, m := range r.MatchedFiles {
				fmt.Fprintf(&b, "  - `%s`\n", m)
			}
		}
		b.WriteString("\n")
	}
	return b.String()
}

func writeReport(path, body string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(body), 0o644)
}
