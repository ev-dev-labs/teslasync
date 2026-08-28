package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

func fixedNow() time.Time { return time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC) }

func env(vals map[string]string) func(string) string {
	return func(k string) string { return vals[k] }
}

// writeSnapshot builds a snapshot file with sane defaults, then applies
// the caller's overrides. Every signal the policy marks `required` is
// present by default, so a test only has to describe the thing it is
// actually testing.
func writeSnapshot(t *testing.T, overrides map[string]ops.MetricSample, bake time.Duration) string {
	t.Helper()
	healthy := map[string]float64{
		"api_error_rate":      0.0001,
		"api_latency_p99":     0.12,
		"frontend_error_rate": 0.001,
		"frontend_lcp_p75":    1.4,
		"frontend_inp_p75":    0.08,
		"migration_failures":  0,
	}
	snap := ops.ReleaseSnapshot{
		Environment: "staging",
		Version:     "1.2.3",
		Commit:      "deadbeef",
		ObservedAt:  fixedNow(),
		BakeElapsed: bake,
	}
	for id, v := range healthy {
		if o, ok := overrides[id]; ok {
			o.SignalID = id
			if o.ObservedAt.IsZero() {
				o.ObservedAt = fixedNow()
			}
			if o.Samples == 0 {
				o.Samples = 10
			}
			snap.Samples = append(snap.Samples, o)
			continue
		}
		snap.Samples = append(snap.Samples, ops.MetricSample{
			SignalID: id, Value: v, ObservedAt: fixedNow(), Samples: 10,
		})
	}
	for id, o := range overrides {
		if _, known := healthy[id]; known {
			continue
		}
		o.SignalID = id
		if o.ObservedAt.IsZero() {
			o.ObservedAt = fixedNow()
		}
		snap.Samples = append(snap.Samples, o)
	}

	path := filepath.Join(t.TempDir(), "release-health.json")
	body, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatalf("write snapshot: %v", err)
	}
	return path
}

func evaluate(t *testing.T, snapshot string, extraArgs ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	args := append([]string{"-root", "../..", "-environment", "staging", "-snapshot", snapshot}, extraArgs...)
	code := run(args, &stdout, &stderr, env(nil), fixedNow)
	return code, stdout.String(), stderr.String()
}

func TestRun_ProceedsOnHealthyRelease(t *testing.T) {
	code, stdout, stderr := evaluate(t, writeSnapshot(t, nil, 20*time.Minute))
	if code != exitProceed {
		t.Fatalf("exit = %d, want %d\n%s\n%s", code, exitProceed, stdout, stderr)
	}
	if !strings.Contains(stdout, "verdict: proceed") {
		t.Fatalf("stdout = %s", stdout)
	}
}

// TestRun_HoldsBeforeBakeWindow: a healthy-but-young release must not be
// promoted. `proceed` before the bake window has elapsed is a claim the
// data cannot support.
func TestRun_HoldsBeforeBakeWindow(t *testing.T) {
	code, stdout, _ := evaluate(t, writeSnapshot(t, nil, time.Minute))
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "bake window not satisfied") {
		t.Fatalf("stdout = %s", stdout)
	}
}

func TestRun_RollsBackOnSustainedErrorRate(t *testing.T) {
	snapshot := writeSnapshot(t, map[string]ops.MetricSample{
		"api_error_rate": {Value: 0.09, BreachStreak: 3, Samples: 10},
	}, 20*time.Minute)

	code, stdout, _ := evaluate(t, snapshot)
	if code != exitRollback {
		t.Fatalf("exit = %d, want %d\n%s", code, exitRollback, stdout)
	}
	if !strings.Contains(stdout, "remediation plan") {
		t.Fatalf("a rollback verdict must print the plan:\n%s", stdout)
	}
}

// TestRun_HoldsOnASingleSpike encodes ADR-008: a single breaching scrape
// must never trigger a rollback.
func TestRun_HoldsOnASingleSpike(t *testing.T) {
	snapshot := writeSnapshot(t, map[string]ops.MetricSample{
		"api_error_rate": {Value: 0.09, BreachStreak: 1, Samples: 10},
	}, 20*time.Minute)

	code, stdout, _ := evaluate(t, snapshot)
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "streak is 1/3") {
		t.Fatalf("stdout = %s", stdout)
	}
}

// TestRun_RollsBackImmediatelyOnMigrationFailure: a failed migration is
// a blocking signal and does not get three chances.
func TestRun_RollsBackImmediatelyOnMigrationFailure(t *testing.T) {
	snapshot := writeSnapshot(t, map[string]ops.MetricSample{
		"migration_failures": {Value: 1, BreachStreak: 1, Samples: 1},
	}, 20*time.Minute)

	code, stdout, _ := evaluate(t, snapshot)
	if code != exitRollback {
		t.Fatalf("exit = %d, want %d\n%s", code, exitRollback, stdout)
	}
	if !strings.Contains(stdout, "assess-schema") {
		t.Fatalf("the plan must tell the operator to consult the migration manifest:\n%s", stdout)
	}
}

func TestRun_HoldsOnWebVitalRegression(t *testing.T) {
	for _, tc := range []struct {
		name   string
		signal string
		value  float64
	}{
		{"LCP in warn band", "frontend_lcp_p75", 3.0},
		{"INP in warn band", "frontend_inp_p75", 0.3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			snapshot := writeSnapshot(t, map[string]ops.MetricSample{
				tc.signal: {Value: tc.value, BreachStreak: 1, Samples: 10},
			}, 20*time.Minute)
			code, stdout, _ := evaluate(t, snapshot)
			if code != exitHold {
				t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
			}
		})
	}
}

func TestRun_RollsBackOnPoorWebVitals(t *testing.T) {
	snapshot := writeSnapshot(t, map[string]ops.MetricSample{
		"frontend_lcp_p75": {Value: 5.5, BreachStreak: 4, Samples: 10},
	}, 20*time.Minute)
	code, stdout, _ := evaluate(t, snapshot)
	if code != exitRollback {
		t.Fatalf("exit = %d, want %d\n%s", code, exitRollback, stdout)
	}
}

// TestRun_HoldsWhenARequiredSignalIsMissing is the honesty rule: absent
// telemetry is never read as health.
func TestRun_HoldsWhenARequiredSignalIsMissing(t *testing.T) {
	snap := ops.ReleaseSnapshot{
		Environment: "staging",
		ObservedAt:  fixedNow(),
		BakeElapsed: 20 * time.Minute,
		Samples: []ops.MetricSample{
			{SignalID: "api_error_rate", Value: 0.0001, ObservedAt: fixedNow(), Samples: 10},
		},
	}
	path := filepath.Join(t.TempDir(), "sparse.json")
	body, _ := json.MarshalIndent(snap, "", "  ")
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	code, stdout, _ := evaluate(t, path)
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "no sample reported for a required signal") {
		t.Fatalf("stdout = %s", stdout)
	}
}

func TestRun_HoldsOnStaleSamples(t *testing.T) {
	snapshot := writeSnapshot(t, map[string]ops.MetricSample{
		"api_error_rate": {Value: 0.0001, ObservedAt: fixedNow().Add(-time.Hour), Samples: 10},
	}, 20*time.Minute)
	code, stdout, _ := evaluate(t, snapshot)
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "max_sample_age") {
		t.Fatalf("stdout = %s", stdout)
	}
}

// TestRun_ProductionRollbackIsAdvisoryOnly: the policy puts production
// in `advise` mode, so even a rollback verdict must not authorise
// automation to act.
func TestRun_ProductionRollbackIsAdvisoryOnly(t *testing.T) {
	snapshot := writeSnapshot(t, map[string]ops.MetricSample{
		"api_error_rate": {Value: 0.09, BreachStreak: 5, Samples: 10},
	}, 20*time.Minute)

	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../..", "-environment", "production", "-snapshot", snapshot}, &stdout, &stderr, env(nil), fixedNow)
	if code != exitRollback {
		t.Fatalf("exit = %d, want %d", code, exitRollback)
	}
	if !strings.Contains(stdout.String(), "ADVISORY") {
		t.Fatalf("production rollback must be advisory:\n%s", stdout.String())
	}
}

func TestRun_PrintPlan(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../..", "-print-plan"}, &stdout, &stderr, env(nil), fixedNow)
	if code != exitProceed {
		t.Fatalf("exit = %d", code)
	}
	for _, want := range []string{"revert-workloads", "assess-schema", "verify"} {
		if !strings.Contains(stdout.String(), want) {
			t.Errorf("plan missing step %q:\n%s", want, stdout.String())
		}
	}
}

func TestRun_WritesJSONAndSummary(t *testing.T) {
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "decision.json")
	summaryPath := filepath.Join(dir, "summary.md")

	code, _, _ := evaluate(t, writeSnapshot(t, nil, 20*time.Minute), "-json", jsonPath, "-summary", summaryPath)
	if code != exitProceed {
		t.Fatalf("exit = %d", code)
	}

	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatalf("read decision: %v", err)
	}
	var decision ops.RollbackDecision
	if err := json.Unmarshal(raw, &decision); err != nil {
		t.Fatalf("decode decision: %v", err)
	}
	if decision.Verdict != ops.VerdictProceed {
		t.Fatalf("verdict = %s", decision.Verdict)
	}

	summary, err := os.ReadFile(summaryPath)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	if !strings.Contains(string(summary), "Release health") {
		t.Fatalf("summary = %s", summary)
	}
}

// ── Prometheus range client ──────────────────────────────────────────

func TestPrometheusClient_ParsesRangeQuery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/query_range") {
			t.Errorf("path = %s, want /api/v1/query_range", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("missing bearer token, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[1700000000,"0.0421"],[1700000060,"0.0500"]]}]}}`))
	}))
	defer srv.Close()

	c := &prometheusClient{baseURL: srv.URL, token: "tok", http: srv.Client()}
	pts, err := c.rangeQuery(context.Background(), `sum(rate(x[5m]))`,
		time.Unix(1700000000, 0), time.Unix(1700000120, 0), time.Minute)
	if err != nil {
		t.Fatalf("rangeQuery: %v", err)
	}
	if len(pts) != 2 || pts[0].value != 0.0421 || pts[1].value != 0.05 {
		t.Fatalf("points = %+v", pts)
	}
}

func TestPrometheusClient_EmptyResultIsNotAValue(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[]}}`))
	}))
	defer srv.Close()

	c := &prometheusClient{baseURL: srv.URL, http: srv.Client()}
	pts, err := c.rangeQuery(context.Background(), "x", time.Unix(1700000000, 0), time.Unix(1700000120, 0), time.Minute)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(pts) != 0 {
		t.Fatal("an empty matrix must not be reported as observed values; that would let a broken query read as health")
	}
}

func TestPrometheusClient_ErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := &prometheusClient{baseURL: srv.URL, http: srv.Client()}
	if _, err := c.rangeQuery(context.Background(), "x", time.Unix(1700000000, 0), time.Unix(1700000120, 0), time.Minute); err == nil {
		t.Fatal("expected an error")
	}
}
func TestRun_LiveQueryFailureHoldsRatherThanProceeds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{
		"-root", "../..",
		"-environment", "staging",
		"-prometheus-url", srv.URL,
		"-bake-elapsed", "20m",
	}, &stdout, &stderr, env(nil), fixedNow)

	if code != exitHold {
		t.Fatalf("exit = %d, want %d (a dead Prometheus must never yield `proceed`)\n%s", code, exitHold, stdout.String())
	}
}

// writeFileHelper is a thin os.WriteFile wrapper so live_test.go does
// not need its own os import block.
func writeFileHelper(path string, body []byte) error {
	return os.WriteFile(path, body, 0o644)
}

// repoFSForEval roots an fs.FS at the repository root.
func repoFSForEval(t *testing.T) fs.FS {
	t.Helper()
	return os.DirFS("../..")
}
