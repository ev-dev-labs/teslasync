// Command trace-coverage-audit statically checks tracing coverage.
//
// Static analyzer that walks the Go source tree and counts trace
// instrumentation sites along every critical request flow.
//
// Flows (kept in sync with .github/instructions/observability.instructions.md):
//
//	API hot paths:
//	  1. GET /vehicles/{id}/state           → http handler → service → repo → cache
//	  2. POST /commands/{vehicleId}/wake    → http handler → service → tesla client
//	  3. MQTT consume → normalize → store   → mqtt subscriber → pipeline → routers
//
//	Async and background paths:
//	  4. notification_dispatch     → API publish → MQTT envelope → consume → send
//	  5. export_job                → API publish → MQTT envelope → consume → process → SSE
//	  6. automation_evaluate       → engine.Evaluate span + actions
//	  7. sse_broadcast             → BroadcastWithContext + Redis fanout
//	  8. resubscribe_push          → cmd/resubscribe per-vehicle Tesla MQTT push
//	  9. fsm_transitions           → fsm.Engine.Fire span via tracing.NewFSMTracer adapter
//	 10. in_api_workers            → per-iteration spans for the in-API background tickers
//	 11. ai_inference              → AI dispatcher / strategy spans (existing)
//	 12. data_repair_scan           → scheduled tick → locked scanner → DB materialization
//
// For each flow we look for at least 4 distinct files containing
// `tracer.Start(`, `otel.Tracer(`, `otelhttp.NewHandler(`, or
// `otelpgx.NewTracer(`. Anything below threshold is reported as
// INSUFFICIENT_SPANS so the gate blocks the prompt.
//
// This is a static audit, not a runtime one. The gate only requires that
// the generated report does NOT contain INSUFFICIENT_SPANS or MISSING_FLOW
// substrings. Runtime
// regression coverage lives in the unit tests under each instrumented
// package (e.g. internal/mqtt/propagation_test.go, internal/tracing/
// fsmtracer_test.go) — those exercise the Init+SpanRecorder pattern and
// would fail compilation if a span was deleted.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// defaultReportPath is where the generated audit report is written unless
// overridden with -report.
const defaultReportPath = "docs/runbooks/phase-44-trace-coverage-audit.md"

type flow struct {
	Name          string
	Description   string
	GlobPatterns  []string
	MinSpanFiles  int
	RequiredFiles []string
}

var flows = []flow{
	{
		Name:        "vehicle_state_read",
		Description: "GET /vehicles/{id}/state",
		GlobPatterns: []string{
			"internal/api/middleware/observability.go",
			"internal/database/database.go",
			"internal/platform/httputil/timeout.go",
			"internal/platform/httputil/client.go",
			"internal/platform/telemetry/tracer.go",
			"internal/tracing/span.go",
		},
		MinSpanFiles: 4,
		RequiredFiles: []string{
			"internal/api/middleware/observability.go",
			"internal/database/database.go",
		},
	},
	{
		Name:        "wake_command",
		Description: "POST /commands/{vehicleId}/wake",
		GlobPatterns: []string{
			"internal/api/middleware/observability.go",
			"internal/tesla/client.go",
			"internal/tesla/client_commands.go",
			"internal/tesla/client_auth.go",
			"internal/tesla/tracing.go",
			"internal/adapter/tesla/client.go",
			"internal/platform/httputil/client.go",
		},
		MinSpanFiles: 4,
		RequiredFiles: []string{
			"internal/api/middleware/observability.go",
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

	{
		Name:        "notification_dispatch",
		Description: "Notification publish → MQTT envelope → consume → send",
		GlobPatterns: []string{
			"internal/notification/worker.go",
			"internal/mqtt/propagation.go",
			"cmd/notification-worker/main.go",
		},
		MinSpanFiles: 3,
		RequiredFiles: []string{
			"internal/notification/worker.go",
			"internal/mqtt/propagation.go",
		},
	},
	{
		Name:        "export_job",
		Description: "Export publish → MQTT envelope → process → SSE status",
		GlobPatterns: []string{
			"internal/export/worker.go",
			"internal/mqtt/propagation.go",
			"cmd/export-worker/main.go",
		},
		MinSpanFiles: 3,
		RequiredFiles: []string{
			"internal/export/worker.go",
		},
	},
	{
		Name:        "automation_evaluate",
		Description: "Automation engine Evaluate span + action dispatch",
		GlobPatterns: []string{
			"internal/automation/engine.go",
			"cmd/automation-worker/main.go",
		},
		MinSpanFiles: 2,
		RequiredFiles: []string{
			"internal/automation/engine.go",
		},
	},
	{
		Name:        "sse_broadcast",
		Description: "SSE BroadcastWithContext + Redis fanout per-payload span",
		GlobPatterns: []string{
			"internal/api/sse/handler.go",
		},
		MinSpanFiles: 1,
		RequiredFiles: []string{
			"internal/api/sse/handler.go",
		},
	},
	{
		Name:        "resubscribe_push",
		Description: "cmd/resubscribe per-vehicle Tesla MQTT push",
		GlobPatterns: []string{
			"cmd/resubscribe/main.go",
		},
		MinSpanFiles: 1,
		RequiredFiles: []string{
			"cmd/resubscribe/main.go",
		},
	},
	{
		Name:        "fsm_transitions",
		Description: "fsm.Engine.Fire span via tracing.NewFSMTracer adapter",
		GlobPatterns: []string{
			"internal/tracing/fsmtracer.go",
		},
		MinSpanFiles: 1,
		RequiredFiles: []string{
			"internal/tracing/fsmtracer.go",
		},
	},
	{
		Name:        "in_api_workers",
		Description: "Spans for in-API background workers",
		GlobPatterns: []string{
			"internal/worker/gas_price_worker.go",
			"internal/worker/maintenance_worker.go",
			"internal/worker/unit_drift_validator.go",
			"internal/app/new.go",
			"internal/api/telemetry/telemetry_sessions_charge_geofence_pricing.go",
		},
		MinSpanFiles: 5,
		RequiredFiles: []string{
			"internal/worker/gas_price_worker.go",
			"internal/worker/maintenance_worker.go",
			"internal/worker/unit_drift_validator.go",
			"internal/app/new.go",
			"internal/api/telemetry/telemetry_sessions_charge_geofence_pricing.go",
		},
	},
	{
		Name:        "ai_inference",
		Description: "AI provider call → traced provider decorator → strategy",
		GlobPatterns: []string{
			"internal/ai/provider/trace.go",
			"internal/ai/dispatch/dispatch.go",
		},
		MinSpanFiles: 1,
		RequiredFiles: []string{
			"internal/ai/provider/trace.go",
		},
	},
	{
		Name:        "data_repair_scan",
		Description: "Scheduled data-repair tick → advisory-locked scan → durable case materialization",
		GlobPatterns: []string{
			"internal/app/new.go",
			"internal/api/datarepair/scanner.go",
		},
		MinSpanFiles: 2,
		RequiredFiles: []string{
			"internal/app/new.go",
			"internal/api/datarepair/scanner.go",
		},
	},

	// Tesla signal-ingestion pipeline tracing.
	// From MQTT receive → VIN resolve → codec decode → normalize.process_atomics
	// → router.route → writers DB save → side-effects (live store + L1/L2 +
	// FSM + sessions + alerts + SSE Redis Pub/Sub publish) + Setting*Unit
	// short-circuit → unit_history.record + signal_log reads.
	{
		Name:        "tesla_signal_ingest_to_db",
		Description: "Tesla per-field MQTT signal → VIN resolve → codec decode → router → writers → DB save → side-effects",
		GlobPatterns: []string{
			"internal/mqtt/mqtt.go",
			"internal/mqtt/vin_cache.go",
			"internal/tesla/codec/decode_json.go",
			"internal/tesla/router/router.go",
			"internal/tesla/router/writers/tracing.go",
			"internal/tesla/router/writers/snapshot_base.go",
			"internal/tesla/router/writers/signal_log_writer.go",
			"internal/tesla/router/writers/positions_writer.go",
			"internal/tesla/router/writers/security_event_writer.go",
			"internal/tesla/router/writers/tire_pressure_writer.go",
			"internal/tesla/normalize/setting_unit_observer.go",
			"internal/tesla/unit_history/repo.go",
			"internal/tesla_pipeline/side_effects_observer.go",
			"internal/signal/redis_cache.go",
			"internal/signal/state_reader_log.go",
			"internal/api/telemetry/telemetry_handler_ingest.go",
		},
		MinSpanFiles: 14,
		RequiredFiles: []string{
			"internal/mqtt/vin_cache.go",
			"internal/tesla/codec/decode_json.go",
			"internal/tesla/router/router.go",
			"internal/tesla/router/writers/tracing.go",
			"internal/tesla/router/writers/snapshot_base.go",
			"internal/tesla/router/writers/signal_log_writer.go",
			"internal/tesla/router/writers/positions_writer.go",
			"internal/tesla/router/writers/security_event_writer.go",
			"internal/tesla/router/writers/tire_pressure_writer.go",
			"internal/tesla/normalize/setting_unit_observer.go",
			"internal/tesla/unit_history/repo.go",
			"internal/tesla_pipeline/side_effects_observer.go",
			"internal/signal/redis_cache.go",
			"internal/signal/state_reader_log.go",
			"internal/api/telemetry/telemetry_handler_ingest.go",
		},
	},
}

var spanRE = regexp.MustCompile(`tracer\.Start\(|otel\.Tracer\(|otelhttp\.NewHandler\(|otelpgx\.NewTracer\(|newCompositeTracer\(|StartSpan\(|startSpan\(|startProcessSpan\(|startChildSpan\(|startWriterSpan\(|otelhttp\.NewTransport\(|tracing\.StartSpan\(|GetTextMapPropagator\(`)

func main() {
	var reportPath string
	var root string
	flag.StringVar(&reportPath, "report", defaultReportPath, "report path")
	flag.StringVar(&root, "root", ".", "repository root to audit paths against")
	flag.Parse()

	os.Exit(run(os.Stdout, os.Stderr, root, reportPath, flows))
}

// run performs the audit for every flow in fs against files rooted at root,
// writes the rendered report to reportPath, echoes it to stdout, and returns
// the process exit code: 0 when every flow is OK, 2 when any flow has a gap,
// and 1 when the report could not be written. Keeping this separate from main
// isolates the os.Exit boundary so the audit is unit-testable.
func run(stdout, stderr io.Writer, root, reportPath string, fs []flow) int {
	results := make([]flowResult, 0, len(fs))
	hasGap := false
	for _, f := range fs {
		r := auditFlow(root, f)
		results = append(results, r)
		if r.Status != "OK" {
			hasGap = true
		}
	}

	report := renderReport(results)
	if err := writeReport(reportPath, report); err != nil {
		fmt.Fprintf(stderr, "report write failed: %v\n", err)
		return 1
	}

	fmt.Fprint(stdout, report)
	if hasGap {
		fmt.Fprintln(stderr, "trace-coverage-audit: GAPS FOUND — see report")
		return 2
	}
	fmt.Fprintln(stderr, "trace-coverage-audit: ALL FLOWS OK")
	return 0
}

type flowResult struct {
	Flow         flow
	MatchedFiles []string
	MissingReqs  []string
	Status       string
}

func auditFlow(root string, f flow) flowResult {
	matched := map[string]struct{}{}
	for _, pattern := range f.GlobPatterns {
		paths, err := expandGlob(root, pattern)
		if err != nil {
			continue
		}
		for _, rel := range paths {
			body, err := os.ReadFile(filepath.Join(root, rel))
			if err != nil {
				continue
			}
			if spanRE.Match(body) {
				matched[filepath.ToSlash(rel)] = struct{}{}
			}
		}
	}

	missing := []string{}
	for _, req := range f.RequiredFiles {
		body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(req)))
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

func expandGlob(root, pattern string) ([]string, error) {
	pattern = filepath.FromSlash(pattern)
	if strings.Contains(pattern, "**") {
		// Manual recursive walk: split at "**".
		base := strings.Split(pattern, "**")[0]
		base = strings.TrimRight(base, string(os.PathSeparator))
		suffix := strings.TrimPrefix(pattern, base+string(os.PathSeparator)+"**")
		suffix = strings.TrimPrefix(suffix, string(os.PathSeparator))
		var out []string
		walkRoot := filepath.Join(root, base)
		err := filepath.Walk(walkRoot, func(p string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			ok, _ := filepath.Match(suffix, filepath.Base(p))
			if ok {
				out = append(out, relOrRaw(root, p))
			}
			return nil
		})
		if err != nil {
			return out, fmt.Errorf("walk %q: %w", walkRoot, err)
		}
		return out, nil
	}
	matches, err := filepath.Glob(filepath.Join(root, pattern))
	if err != nil {
		return nil, fmt.Errorf("glob %q: %w", pattern, err)
	}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		out = append(out, relOrRaw(root, m))
	}
	return out, nil
}

// relOrRaw returns p expressed relative to root. It falls back to p unchanged
// when a relative path cannot be computed (for example across Windows volumes),
// so a matched file is never silently dropped from the audit.
func relOrRaw(root, p string) string {
	if rel, err := filepath.Rel(root, p); err == nil {
		return rel
	}
	return p
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
	return strings.TrimRight(b.String(), "\n") + "\n"
}

func writeReport(path, body string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create report dir %q: %w", dir, err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return fmt.Errorf("write report %q: %w", path, err)
	}
	return nil
}
