package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

// ── Review finding 4 ─────────────────────────────────────────────────
//
// The first live mode issued a single INSTANT query, then fabricated
// `Samples: policy.Evaluation.MinSamples` and left BreachStreak at zero.
// That made `min_samples` unenforceable (one data point always "passed"
// a five-sample floor) and made a rollback verdict unreachable in live
// mode (a zero streak never meets breach_streak). These tests pin the
// range-query behaviour that replaced it.

// rangeServer serves a query_range response built from per-signal value
// series, so a test can describe a shape ("five healthy points", "three
// trailing breaches") rather than hand-rolling JSON.
type rangeServer struct {
	// series maps a substring of the promql query to its values.
	series map[string][]float64
	// raw overrides the whole response body for malformed-input tests.
	raw string
	// status overrides the HTTP status.
	status int
	// seen records the query parameters of every request.
	seen []url.Values
}

func (rs *rangeServer) start(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rs.seen = append(rs.seen, r.URL.Query())
		if rs.status != 0 {
			w.WriteHeader(rs.status)
			return
		}
		if rs.raw != "" {
			_, _ = w.Write([]byte(rs.raw))
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/query_range") {
			t.Errorf("expected a range query, got %s", r.URL.Path)
		}
		q := r.URL.Query().Get("query")
		var values []float64
		for fragment, v := range rs.series {
			if strings.Contains(q, fragment) {
				values = v
				break
			}
		}
		if values == nil {
			// No data for this signal — the evaluator must treat it as
			// missing, never as healthy.
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[]}}`))
			return
		}
		// Anchor the series so the NEWEST point lands at the evaluator's
		// observation time. A real range query ending at `now` behaves
		// this way; anchoring it in the past would trip the policy's
		// max_sample_age rule instead of the property under test.
		end := fixedNow().Unix()
		points := make([]string, 0, len(values))
		for i, v := range values {
			ts := end - int64((len(values)-1-i)*60)
			points = append(points, fmt.Sprintf(`[%d,"%s"]`, ts, strconv.FormatFloat(v, 'f', -1, 64)))
		}
		fmt.Fprintf(w, `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[%s]}]}}`,
			strings.Join(points, ","))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// healthySeries is a full set of in-band values for every required
// prometheus signal, long enough to satisfy min_samples.
func healthySeries() map[string][]float64 {
	rep := func(v float64, n int) []float64 {
		out := make([]float64, n)
		for i := range out {
			out[i] = v
		}
		return out
	}
	return map[string][]float64{
		"teslasync_red_http_requests_total":                  rep(0.0001, 12),
		"teslasync_red_http_request_duration_seconds_bucket": rep(0.12, 12),
		"teslasync_web_errors_total":                         rep(0.001, 12),
		"teslasync_frontend_web_vitals_lcp_seconds_bucket":   rep(1.4, 12),
		"teslasync_frontend_web_vitals_inp_seconds_bucket":   rep(0.08, 12),
		"teslasync_sse_connections_active":                   rep(42, 12),
	}
}

// deploySnapshot supplies the deploy-sourced signals that Prometheus
// cannot provide, so live-mode tests exercise only the scraped path.
func deploySnapshot(t *testing.T, migrationFailures float64) string {
	t.Helper()
	snap := ops.ReleaseSnapshot{
		Environment: "staging",
		ObservedAt:  fixedNow(),
		BakeElapsed: 20 * time.Minute,
		Samples: []ops.MetricSample{
			{SignalID: "migration_failures", Value: migrationFailures, ObservedAt: fixedNow(), Samples: 1},
		},
	}
	return writeSnapshotFile(t, snap)
}

func runLive(t *testing.T, rs *rangeServer, snapshotPath string, extra ...string) (int, string, string) {
	t.Helper()
	srv := rs.start(t)
	var stdout, stderr bytes.Buffer
	args := []string{
		"-root", "../..",
		"-environment", "staging",
		"-prometheus-url", srv.URL,
		"-bake-elapsed", "20m",
	}
	if snapshotPath != "" {
		args = append(args, "-snapshot", snapshotPath)
	}
	args = append(args, extra...)
	code := run(args, &stdout, &stderr, env(nil), fixedNow)
	return code, stdout.String(), stderr.String()
}

func TestLive_UsesRangeQueryNotInstantQuery(t *testing.T) {
	rs := &rangeServer{series: healthySeries()}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitProceed {
		t.Fatalf("exit = %d, want %d\n%s", code, exitProceed, stdout)
	}
	if len(rs.seen) == 0 {
		t.Fatal("no queries were issued")
	}
	for _, q := range rs.seen {
		for _, param := range []string{"query", "start", "end", "step"} {
			if q.Get(param) == "" {
				t.Fatalf("range query is missing %q: %v", param, q)
			}
		}
		if q.Get("step") != "60s" {
			t.Errorf("step = %q, want the policy sample_interval (60s)", q.Get("step"))
		}
	}
}

// TestLive_HoldsWhenBelowMinSamples is the regression for the fabricated
// sample count: a series with fewer points than min_samples must hold,
// not proceed.
func TestLive_HoldsWhenBelowMinSamples(t *testing.T) {
	series := healthySeries()
	series["teslasync_red_http_requests_total"] = []float64{0.0001, 0.0001} // 2 < min_samples(5)

	rs := &rangeServer{series: series}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitHold {
		t.Fatalf("exit = %d, want %d (a 2-point series must not satisfy a 5-sample floor)\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "only 2 samples, need 5") {
		t.Fatalf("the sample shortfall was not reported:\n%s", stdout)
	}
}

// TestLive_RollsBackOnTrailingBreachStreak is the other half: live mode
// must be able to reach a rollback verdict at all, which the fabricated
// zero streak made impossible.
func TestLive_RollsBackOnTrailingBreachStreak(t *testing.T) {
	series := healthySeries()
	// Healthy history, then four consecutive points above the 0.02
	// rollback threshold. breach_streak is 3.
	series["teslasync_red_http_requests_total"] = []float64{
		0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001,
		0.09, 0.09, 0.09, 0.09,
	}

	rs := &rangeServer{series: series}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitRollback {
		t.Fatalf("exit = %d, want %d\n%s", code, exitRollback, stdout)
	}
	if !strings.Contains(stdout, "for 4 consecutive samples") {
		t.Fatalf("the streak was not computed from the series:\n%s", stdout)
	}
}

// TestLive_HoldsOnRecoveredSpike proves the streak is TRAILING: an old
// breach that has since recovered must not trigger a rollback.
func TestLive_HoldsOnRecoveredSpike(t *testing.T) {
	series := healthySeries()
	series["teslasync_red_http_requests_total"] = []float64{
		0.09, 0.09, 0.09, 0.09, // spike…
		0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, // …recovered
	}

	rs := &rangeServer{series: series}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitProceed {
		t.Fatalf("exit = %d, want %d (a recovered spike must not roll back)\n%s", code, exitProceed, stdout)
	}
}

// TestLive_HoldsOnSingleTrailingBreach: one breaching point is a spike,
// not a trend (ADR-008).
func TestLive_HoldsOnSingleTrailingBreach(t *testing.T) {
	series := healthySeries()
	series["teslasync_red_http_requests_total"] = []float64{
		0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.09,
	}

	rs := &rangeServer{series: series}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "streak is 1/3") {
		t.Fatalf("expected a 1/3 streak report:\n%s", stdout)
	}
}

func TestLive_HoldsOnNoData(t *testing.T) {
	rs := &rangeServer{series: map[string][]float64{}} // every query returns an empty matrix
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitHold {
		t.Fatalf("exit = %d, want %d (no data must never read as health)\n%s", code, exitHold, stdout)
	}
	if !strings.Contains(stdout, "no sample reported for a required signal") {
		t.Fatalf("missing-signal reason absent:\n%s", stdout)
	}
}

func TestLive_HoldsOnMalformedResponse(t *testing.T) {
	for _, tc := range []struct {
		name string
		rs   *rangeServer
	}{
		{"not json", &rangeServer{raw: "this is not json"}},
		{"error status", &rangeServer{raw: `{"status":"error","errorType":"bad_data"}`}},
		{"http 502", &rangeServer{status: http.StatusBadGateway}},
		{"garbage values", &rangeServer{raw: `{"status":"success","data":{"resultType":"matrix","result":[{"values":[["x","y"]]}]}}`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, stdout, _ := runLive(t, tc.rs, deploySnapshot(t, 0))
			if code != exitHold {
				t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
			}
		})
	}
}

// TestLive_RejectsMultiSeriesResult: an unaggregated query makes "the"
// value ambiguous and the streak meaningless, so it must not silently
// pick one.
func TestLive_RejectsMultiSeriesResult(t *testing.T) {
	rs := &rangeServer{raw: `{"status":"success","data":{"resultType":"matrix","result":[
      {"metric":{"a":"1"},"values":[[1700000000,"0.001"]]},
      {"metric":{"a":"2"},"values":[[1700000000,"0.9"]]}]}}`}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
}

// TestLive_DeploySignalStillWins: a blocking deploy-sourced signal must
// short-circuit even when every scraped series is healthy.
func TestLive_DeploySignalStillWins(t *testing.T) {
	rs := &rangeServer{series: healthySeries()}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 1))
	if code != exitRollback {
		t.Fatalf("exit = %d, want %d\n%s", code, exitRollback, stdout)
	}
}

// TestLive_NaNIsNotAnObservation: Prometheus reports gaps as NaN; those
// are absences, not zeros.
func TestLive_NaNIsNotAnObservation(t *testing.T) {
	rs := &rangeServer{raw: `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[
      [1700000000,"NaN"],[1700000060,"NaN"],[1700000120,"NaN"]]}]}}`}
	code, stdout, _ := runLive(t, rs, deploySnapshot(t, 0))
	if code != exitHold {
		t.Fatalf("exit = %d, want %d\n%s", code, exitHold, stdout)
	}
}

// ── unit-level coverage of the streak helper ─────────────────────────

func TestTrailingBreachStreak(t *testing.T) {
	at := func(vals ...float64) []samplePoint {
		out := make([]samplePoint, len(vals))
		base := time.Unix(1700000000, 0)
		for i, v := range vals {
			out[i] = samplePoint{at: base.Add(time.Duration(i) * time.Minute), value: v}
		}
		return out
	}
	tests := []struct {
		name       string
		series     []samplePoint
		comparison string
		threshold  float64
		want       int
	}{
		{"all healthy", at(0.1, 0.1, 0.1), "gt", 1.0, 0},
		{"all breaching", at(2, 2, 2), "gt", 1.0, 3},
		{"trailing two", at(0.1, 0.1, 2, 2), "gt", 1.0, 2},
		{"recovered spike", at(2, 2, 2, 0.1), "gt", 1.0, 0},
		{"empty", nil, "gt", 1.0, 0},
		{"lt comparison", at(5, 0.5, 0.5), "lt", 1.0, 2},
		{"gte boundary", at(1.0, 1.0), "gte", 1.0, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := trailingBreachStreak(tt.series, tt.comparison, tt.threshold); got != tt.want {
				t.Fatalf("streak = %d, want %d", got, tt.want)
			}
		})
	}
}

// TestBreachesMatchesEvaluator pins this file's comparison helper to the
// evaluator's, so a change to one cannot silently desynchronise the
// streak from the verdict.
func TestBreachesMatchesEvaluator(t *testing.T) {
	policy, err := ops.LoadRollbackPolicy(repoFSForEval(t), ops.RollbackPolicyPath)
	if err != nil {
		t.Fatalf("load policy: %v", err)
	}
	for _, sig := range policy.Signals {
		for _, v := range []float64{sig.Rollback - 1, sig.Rollback, sig.Rollback + 1} {
			local := breaches(sig.Comparison, v, sig.Rollback)
			// Reproduce the evaluator's decision through the public API.
			snap := ops.ReleaseSnapshot{
				Environment: "staging",
				ObservedAt:  fixedNow(),
				BakeElapsed: time.Hour,
				Samples:     []ops.MetricSample{{SignalID: sig.ID, Value: v, ObservedAt: fixedNow(), Samples: 99, BreachStreak: 99}},
			}
			decision := ops.Evaluate(policy, snap)
			var viaEvaluator bool
			for _, ev := range decision.Signals {
				if ev.SignalID == sig.ID {
					viaEvaluator = ev.Verdict == ops.VerdictRollback
				}
			}
			if local != viaEvaluator {
				t.Errorf("signal %s value %v: local breaches()=%v but evaluator rollback=%v", sig.ID, v, local, viaEvaluator)
			}
		}
	}
}

func TestRangeQuery_RejectsEmptyWindow(t *testing.T) {
	c := &prometheusClient{baseURL: "http://example", http: http.DefaultClient}
	now := time.Now()
	if _, err := c.rangeQuery(context.Background(), "x", now, now, time.Minute); err == nil {
		t.Fatal("expected an error for a zero-width window")
	}
}

func TestRangeQuery_SortsByTimestamp(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[
          [1700000120,"3"],[1700000000,"1"],[1700000060,"2"]]}]}}`))
	}))
	defer srv.Close()

	c := &prometheusClient{baseURL: srv.URL, http: srv.Client()}
	pts, err := c.rangeQuery(context.Background(), "x", time.Unix(1700000000, 0), time.Unix(1700000200, 0), time.Minute)
	if err != nil {
		t.Fatalf("rangeQuery: %v", err)
	}
	if len(pts) != 3 || pts[0].value != 1 || pts[2].value != 3 {
		t.Fatalf("points not ordered oldest-first: %+v", pts)
	}
}

// writeSnapshotFile is a small helper shared with the offline tests.
func writeSnapshotFile(t *testing.T, snap ops.ReleaseSnapshot) string {
	t.Helper()
	path := t.TempDir() + "/release-health.json"
	body, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if err := writeFileHelper(path, body); err != nil {
		t.Fatalf("write snapshot: %v", err)
	}
	return path
}
