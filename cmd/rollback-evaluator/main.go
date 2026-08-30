// cmd/rollback-evaluator evaluates release health against the OPS-02
// rollback policy.
//
//	# offline: evaluate a snapshot produced by the deploy pipeline
//	go run ./cmd/rollback-evaluator -snapshot release-health.json
//
//	# live: query Prometheus during the bake window
//	go run ./cmd/rollback-evaluator -prometheus-url https://prom.internal
//
// Exit codes are the verdict, so a shell can branch without parsing
// prose:
//
//	0  proceed
//	2  hold      (missing/stale data, or a warn-band breach)
//	3  rollback
//	1  usage/setup error
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ops"
)

// Exit codes. `hold` deliberately is not 1: a hold is a decision point,
// not a tooling failure, and conflating the two makes pipelines treat
// "we cannot tell yet" as "the evaluator crashed".
const (
	exitProceed  = 0
	exitError    = 1
	exitHold     = 2
	exitRollback = 3
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, os.Getenv, time.Now))
}

type options struct {
	root          string
	policy        string
	snapshot      string
	prometheusURL string
	environment   string
	version       string
	commit        string
	bakeElapsed   time.Duration
	jsonPath      string
	summaryPath   string
	printPlan     bool
	lookback      time.Duration
}

func parseFlags(args []string, stderr io.Writer) (*options, error) {
	opt := &options{}
	fs := flag.NewFlagSet("rollback-evaluator", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opt.root, "root", ".", "repository root")
	fs.StringVar(&opt.policy, "policy", ops.RollbackPolicyPath, "policy path (relative to -root)")
	fs.StringVar(&opt.snapshot, "snapshot", "", "release-health snapshot JSON produced by the deploy pipeline")
	fs.StringVar(&opt.prometheusURL, "prometheus-url", "", "Prometheus base URL for live evaluation (falls back to $PROMETHEUS_URL)")
	fs.StringVar(&opt.environment, "environment", "", "environment name as declared in the policy")
	fs.StringVar(&opt.version, "version", "", "version under evaluation")
	fs.StringVar(&opt.commit, "commit", "", "commit SHA under evaluation")
	fs.DurationVar(&opt.bakeElapsed, "bake-elapsed", 0, "how long the revision has been baking (overrides the snapshot)")
	fs.StringVar(&opt.jsonPath, "json", "", "write the decision as JSON to this path")
	fs.StringVar(&opt.summaryPath, "summary", "", "append a markdown summary to this path")
	fs.BoolVar(&opt.printPlan, "print-plan", false, "print the remediation plan and exit without evaluating")
	fs.DurationVar(&opt.lookback, "lookback", 0, "range-query lookback window (default: the policy bake time, capped at -bake-elapsed)")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return opt, nil
}

func run(args []string, stdout, stderr io.Writer, getenv func(string) string, now func() time.Time) int {
	opt, err := parseFlags(args, stderr)
	if err != nil {
		return exitError
	}

	policy, err := ops.LoadRollbackPolicy(os.DirFS(opt.root), opt.policy)
	if err != nil {
		fmt.Fprintf(stderr, "rollback-evaluator: %v\n", err)
		return exitError
	}
	if findings := ops.ValidateRollback(policy); len(findings) > 0 {
		for _, f := range findings {
			fmt.Fprintf(stderr, "rollback-evaluator: invalid policy: %s: %s\n", f.Subject, f.Message)
		}
		return exitError
	}

	if opt.printPlan {
		printPlan(stdout, policy)
		if opt.summaryPath != "" {
			if err := appendPlanSummary(opt.summaryPath, policy); err != nil {
				fmt.Fprintf(stderr, "rollback-evaluator: %v\n", err)
				return exitError
			}
		}
		return exitProceed
	}

	snap, err := buildSnapshot(opt, getenv, now)
	if err != nil {
		fmt.Fprintf(stderr, "rollback-evaluator: %v\n", err)
		return exitError
	}

	decision := ops.Evaluate(policy, snap)
	writeDecision(stdout, decision)

	if opt.jsonPath != "" {
		body, mErr := json.MarshalIndent(decision, "", "  ")
		if mErr != nil {
			fmt.Fprintf(stderr, "rollback-evaluator: %v\n", mErr)
			return exitError
		}
		if wErr := os.WriteFile(opt.jsonPath, append(body, '\n'), 0o644); wErr != nil {
			fmt.Fprintf(stderr, "rollback-evaluator: %v\n", wErr)
			return exitError
		}
	}
	if opt.summaryPath != "" {
		if err := appendDecisionSummary(opt.summaryPath, decision); err != nil {
			fmt.Fprintf(stderr, "rollback-evaluator: %v\n", err)
			return exitError
		}
	}

	switch decision.Verdict {
	case ops.VerdictRollback:
		return exitRollback
	case ops.VerdictHold:
		return exitHold
	default:
		return exitProceed
	}
}

// buildSnapshot merges the offline snapshot file (which carries the
// deploy-sourced signals such as migration_failures) with live
// Prometheus values. The file wins for any signal it already contains,
// because a deploy-observed fact beats a scrape.
func buildSnapshot(opt *options, getenv func(string) string, now func() time.Time) (ops.ReleaseSnapshot, error) {
	snap := ops.ReleaseSnapshot{
		Environment: opt.environment,
		Version:     opt.version,
		Commit:      opt.commit,
		ObservedAt:  now(),
		BakeElapsed: opt.bakeElapsed,
	}

	if opt.snapshot != "" {
		raw, err := os.ReadFile(opt.snapshot)
		if err != nil {
			return snap, fmt.Errorf("read snapshot: %w", err)
		}
		var fromFile ops.ReleaseSnapshot
		if err := json.Unmarshal(raw, &fromFile); err != nil {
			return snap, fmt.Errorf("parse snapshot: %w", err)
		}
		snap.Samples = fromFile.Samples
		if snap.Environment == "" {
			snap.Environment = fromFile.Environment
		}
		if snap.Version == "" {
			snap.Version = fromFile.Version
		}
		if snap.Commit == "" {
			snap.Commit = fromFile.Commit
		}
		if opt.bakeElapsed == 0 {
			snap.BakeElapsed = fromFile.BakeElapsed
		}
		if !fromFile.ObservedAt.IsZero() {
			snap.ObservedAt = fromFile.ObservedAt
		}
	}

	promURL := opt.prometheusURL
	if promURL == "" {
		promURL = getenv("PROMETHEUS_URL")
	}
	if promURL == "" {
		return snap, nil
	}

	policy, err := ops.LoadRollbackPolicy(os.DirFS(opt.root), opt.policy)
	if err != nil {
		return snap, err
	}
	have := map[string]bool{}
	for _, s := range snap.Samples {
		have[s.SignalID] = true
	}

	client := &prometheusClient{
		baseURL: strings.TrimRight(promURL, "/"),
		token:   getenv("PROMETHEUS_TOKEN"),
		http:    &http.Client{Timeout: 60 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	// Look back over the bake window (or, before it has elapsed, over
	// however long the revision has actually been up) at the policy's
	// sample interval. That is what makes min_samples and breach_streak
	// mean anything: a single instant query has exactly one data point,
	// so it can neither satisfy a sample floor nor establish a streak.
	lookback := opt.lookback
	if lookback <= 0 {
		lookback = policy.Evaluation.BakeTime
		if snap.BakeElapsed > 0 && snap.BakeElapsed < lookback {
			lookback = snap.BakeElapsed
		}
	}
	step := policy.Evaluation.SampleInterval
	if step <= 0 {
		step = time.Minute
	}

	for _, sig := range policy.Signals {
		if sig.Source != "prometheus" || have[sig.ID] {
			continue
		}
		series, qErr := client.rangeQuery(ctx, sig.Query, snap.ObservedAt.Add(-lookback), snap.ObservedAt, step)
		if qErr != nil || len(series) == 0 {
			// A failed, malformed, or empty range query is NOT a healthy
			// signal. Omitting the sample makes the evaluator treat a
			// required signal as missing, which yields `hold` — never
			// `proceed`. Fabricating Samples=min_samples here (as the
			// first implementation did) would have manufactured consent
			// from a broken query.
			continue
		}
		snap.Samples = append(snap.Samples, ops.MetricSample{
			SignalID:   sig.ID,
			Value:      series[len(series)-1].value,
			ObservedAt: series[len(series)-1].at,
			Samples:    len(series),
			// Trailing run of consecutive breaching points, newest-first.
			BreachStreak: trailingBreachStreak(series, sig.Comparison, sig.Rollback),
		})
	}
	return snap, nil
}

// samplePoint is one (timestamp, value) pair from a range query.
type samplePoint struct {
	at    time.Time
	value float64
}

// trailingBreachStreak counts how many of the MOST RECENT consecutive
// points breach the threshold. It walks backwards and stops at the first
// healthy point, so an old spike that has since recovered contributes
// nothing — which is exactly the property the multi-window rule in
// ADR-008 is asking for.
func trailingBreachStreak(series []samplePoint, comparison string, threshold float64) int {
	streak := 0
	for i := len(series) - 1; i >= 0; i-- {
		if !breaches(comparison, series[i].value, threshold) {
			break
		}
		streak++
	}
	return streak
}

// breaches mirrors internal/ops.Evaluate's comparison semantics. It is
// duplicated (rather than exported) deliberately: the evaluator's copy
// is the authority for the verdict, and TestBreachesMatchesEvaluator
// pins the two together so they cannot diverge.
func breaches(comparison string, value, threshold float64) bool {
	switch comparison {
	case "gt":
		return value > threshold
	case "gte":
		return value >= threshold
	case "lt":
		return value < threshold
	case "lte":
		return value <= threshold
	}
	return false
}

// prometheusClient is a minimal range-query client. The full
// prometheus/client_golang API package is deliberately not pulled in:
// this binary needs one endpoint and must stay trivially testable.
type prometheusClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// rangeQuery returns the ordered points of a single time series.
//
// A range query (not an instant query) is what makes `min_samples` and
// `breach_streak` meaningful: an instant query yields exactly one point,
// so it can never satisfy a sample floor nor establish a consecutive
// breach run.
//
// It returns an error for transport/protocol failures and an empty slice
// for "no data". Both are treated as *missing*, never as healthy.
func (c *prometheusClient) rangeQuery(ctx context.Context, query string, start, end time.Time, step time.Duration) ([]samplePoint, error) {
	if !end.After(start) {
		return nil, fmt.Errorf("range query window is empty (start=%s end=%s)", start, end)
	}
	params := url.Values{}
	params.Set("query", strings.TrimSpace(query))
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(end.Unix(), 10))
	params.Set("step", strconv.FormatInt(int64(step.Seconds()), 10)+"s")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/query_range?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus returned %d", resp.StatusCode)
	}

	var body struct {
		Status string `json:"status"`
		Data   struct {
			ResultType string `json:"resultType"`
			Result     []struct {
				Values [][]any `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decode query_range response: %w", err)
	}
	if body.Status != "success" {
		return nil, fmt.Errorf("prometheus status %q", body.Status)
	}
	if len(body.Data.Result) == 0 {
		return nil, nil
	}
	if len(body.Data.Result) > 1 {
		// An unaggregated query would make "the" value ambiguous and the
		// streak meaningless. Every signal query in the policy is a
		// scalar aggregate; if one stops being so, say so loudly.
		return nil, fmt.Errorf("query returned %d series; rollback signals must aggregate to exactly one", len(body.Data.Result))
	}

	raw := body.Data.Result[0].Values
	out := make([]samplePoint, 0, len(raw))
	for _, pair := range raw {
		if len(pair) < 2 {
			continue
		}
		ts, ok := toFloat(pair[0])
		if !ok {
			continue
		}
		text, ok := pair[1].(string)
		if !ok {
			continue
		}
		v, convErr := strconv.ParseFloat(text, 64)
		// NaN is Prometheus' way of saying "no value here"; it is not a
		// zero and must not be counted as an observation.
		if convErr != nil || math.IsNaN(v) {
			continue
		}
		out = append(out, samplePoint{at: time.Unix(int64(ts), 0).UTC(), value: v})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].at.Before(out[j].at) })
	return out, nil
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	}
	return 0, false
}

func writeDecision(w io.Writer, d ops.RollbackDecision) {
	fmt.Fprintf(w, "verdict: %s (environment=%s mode=%s automation_allowed=%t bake_satisfied=%t)\n",
		d.Verdict, d.Environment, d.Mode, d.AutomationOK, d.BakeSatisfied)
	for _, s := range d.Signals {
		observed := "—"
		if s.Observed {
			observed = strconv.FormatFloat(s.Value, 'g', 6, 64)
		}
		fmt.Fprintf(w, "  %-10s %-26s value=%-12s warn=%-10g rollback=%-10g %s\n",
			s.Verdict, s.SignalID, observed, s.Warn, s.Rollback, strings.Join(s.Reasons, "; "))
	}
	if len(d.Reasons) > 0 {
		fmt.Fprintln(w, "reasons:")
		for _, r := range d.Reasons {
			fmt.Fprintf(w, "  - %s\n", r)
		}
	}
	if d.Verdict == ops.VerdictRollback {
		fmt.Fprintln(w, "\nremediation plan:")
		for i, step := range d.Plan {
			fmt.Fprintf(w, "  %d. %-18s %s\n", i+1, step.Step, step.Description)
			if step.Command != "" {
				fmt.Fprintf(w, "     $ %s\n", step.Command)
			}
		}
		if !d.AutomationOK {
			fmt.Fprintf(w, "\nenvironment %q is in %q mode: this verdict is ADVISORY. A human must authorise the rollback.\n", d.Environment, d.Mode)
		}
	}
}

func printPlan(w io.Writer, p *ops.RollbackPolicy) {
	fmt.Fprintln(w, "rollback plan:")
	for i, step := range p.RollbackPlan {
		fmt.Fprintf(w, "  %d. %-18s %s\n", i+1, step.Step, step.Description)
		if step.Command != "" {
			fmt.Fprintf(w, "     $ %s\n", step.Command)
		}
	}
}

func appendPlanSummary(path string, p *ops.RollbackPolicy) error {
	var b strings.Builder
	b.WriteString("## Rollback plan\n\n")
	b.WriteString("| # | Step | Action | Command |\n|--:|---|---|---|\n")
	for i, s := range p.RollbackPlan {
		cmd := s.Command
		if cmd == "" {
			cmd = "—"
		} else {
			cmd = "`" + cmd + "`"
		}
		fmt.Fprintf(&b, "| %d | `%s` | %s | %s |\n", i+1, s.Step, cell(s.Description), cell(cmd))
	}
	b.WriteString("\n")
	return appendFile(path, b.String())
}

func appendDecisionSummary(path string, d ops.RollbackDecision) error {
	icon := map[ops.Verdict]string{
		ops.VerdictProceed:  "✅",
		ops.VerdictHold:     "⏸️",
		ops.VerdictRollback: "🛑",
	}[d.Verdict]

	var b strings.Builder
	fmt.Fprintf(&b, "## Release health: %s **%s**\n\n", icon, strings.ToUpper(string(d.Verdict)))
	fmt.Fprintf(&b, "Environment `%s` · mode `%s` · automation %s · bake window %s\n\n",
		d.Environment, d.Mode,
		map[bool]string{true: "permitted", false: "advisory only"}[d.AutomationOK],
		map[bool]string{true: "satisfied", false: "not yet satisfied"}[d.BakeSatisfied])

	b.WriteString("| Signal | Verdict | Value | Warn | Rollback | Notes |\n|---|---|---:|---:|---:|---|\n")
	for _, s := range d.Signals {
		value := "—"
		if s.Observed {
			value = strconv.FormatFloat(s.Value, 'g', 6, 64)
		}
		notes := strings.Join(s.Reasons, "; ")
		if notes == "" {
			notes = "—"
		}
		fmt.Fprintf(&b, "| `%s` | `%s` | %s | %g | %g | %s |\n", s.SignalID, s.Verdict, value, s.Warn, s.Rollback, cell(notes))
	}
	b.WriteString("\n")

	if d.Verdict == ops.VerdictRollback {
		b.WriteString("### Remediation\n\n")
		for i, s := range d.Plan {
			fmt.Fprintf(&b, "%d. **%s** — %s\n", i+1, s.Step, cell(s.Description))
			if s.Command != "" {
				fmt.Fprintf(&b, "   ```\n   %s\n   ```\n", s.Command)
			}
		}
		b.WriteString("\n")
	}
	return appendFile(path, b.String())
}

func cell(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "|", "\\|"), "\n", " ")
}

func appendFile(path, body string) error {
	fh, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer fh.Close()
	_, err = fh.WriteString(body)
	return err
}
