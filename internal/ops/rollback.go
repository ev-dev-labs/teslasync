package ops

import (
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"
)

// RollbackPolicyPath is the canonical location of the OPS-02 policy.
const RollbackPolicyPath = "ops/rollback/policy.yaml"

// Verdict is the outcome of a rollback evaluation.
type Verdict string

const (
	// VerdictProceed means every required signal is healthy and the
	// bake window elapsed.
	VerdictProceed Verdict = "proceed"
	// VerdictHold means the release is neither provably healthy nor
	// provably broken. Deployment pauses; a human decides.
	VerdictHold Verdict = "hold"
	// VerdictRollback means a measured threshold was crossed.
	VerdictRollback Verdict = "rollback"
)

// RollbackPolicy is the parsed ops/rollback/policy.yaml.
type RollbackPolicy struct {
	Version      int                   `yaml:"version"`
	Evaluation   RollbackEvaluation    `yaml:"evaluation"`
	Environments []RollbackEnvironment `yaml:"environments"`
	Signals      []RollbackSignal      `yaml:"signals"`
	RollbackPlan []RollbackStep        `yaml:"rollback_plan"`
}

// RollbackEvaluation holds the windowing rules.
type RollbackEvaluation struct {
	BakeTime               time.Duration `yaml:"bake_time"`
	SampleInterval         time.Duration `yaml:"sample_interval"`
	MinSamples             int           `yaml:"min_samples"`
	BreachStreak           int           `yaml:"breach_streak"`
	MaxSampleAge           time.Duration `yaml:"max_sample_age"`
	MissingRequiredVerdict Verdict       `yaml:"missing_required_verdict"`
}

// RollbackEnvironment declares whether a `rollback` verdict may be acted
// on automatically in that environment.
type RollbackEnvironment struct {
	Name             string `yaml:"name"`
	Mode             string `yaml:"mode"` // advise | enforce
	ApprovalRequired bool   `yaml:"approval_required"`
}

// RollbackSignal is one measurable release-health input.
type RollbackSignal struct {
	ID         string  `yaml:"id"`
	Title      string  `yaml:"title"`
	Dimension  string  `yaml:"dimension"`
	Source     string  `yaml:"source"` // prometheus | deploy | manual
	Query      string  `yaml:"query"`
	Unit       string  `yaml:"unit"`
	Comparison string  `yaml:"comparison"` // gt | gte | lt | lte
	Warn       float64 `yaml:"warn"`
	Rollback   float64 `yaml:"rollback"`
	Required   bool    `yaml:"required"`
	Blocking   bool    `yaml:"blocking"`
	Rationale  string  `yaml:"rationale"`
}

// RollbackStep is one ordered remediation action.
type RollbackStep struct {
	Step        string `yaml:"step"`
	Description string `yaml:"description"`
	Command     string `yaml:"command"`
}

// MetricSample is one observed value for a signal.
type MetricSample struct {
	SignalID     string    `json:"signal_id" yaml:"signal_id"`
	Value        float64   `json:"value" yaml:"value"`
	ObservedAt   time.Time `json:"observed_at" yaml:"observed_at"`
	Samples      int       `json:"samples" yaml:"samples"`
	BreachStreak int       `json:"breach_streak" yaml:"breach_streak"`
}

// ReleaseSnapshot is the evaluator input: what was measured, when, for
// which environment, and how long the revision has been baking.
type ReleaseSnapshot struct {
	Environment string         `json:"environment"`
	Version     string         `json:"version"`
	Commit      string         `json:"commit"`
	ObservedAt  time.Time      `json:"observed_at"`
	BakeElapsed time.Duration  `json:"bake_elapsed_ns"`
	Samples     []MetricSample `json:"samples"`
}

// SignalEvaluation is the per-signal verdict detail.
type SignalEvaluation struct {
	SignalID   string   `json:"signal_id"`
	Title      string   `json:"title"`
	Dimension  string   `json:"dimension"`
	Required   bool     `json:"required"`
	Observed   bool     `json:"observed"`
	Value      float64  `json:"value"`
	Warn       float64  `json:"warn"`
	Rollback   float64  `json:"rollback"`
	Comparison string   `json:"comparison"`
	Verdict    Verdict  `json:"verdict"`
	Reasons    []string `json:"reasons,omitempty"`
}

// RollbackDecision is the machine-readable evaluator output.
type RollbackDecision struct {
	Environment    string             `json:"environment"`
	Version        string             `json:"version"`
	Commit         string             `json:"commit"`
	Verdict        Verdict            `json:"verdict"`
	Mode           string             `json:"mode"`
	AutomationOK   bool               `json:"automation_allowed"`
	BakeSatisfied  bool               `json:"bake_satisfied"`
	Reasons        []string           `json:"reasons"`
	Signals        []SignalEvaluation `json:"signals"`
	RemediationFor Verdict            `json:"remediation_for,omitempty"`
	Plan           []RollbackStep     `json:"plan,omitempty"`
}

// LoadRollbackPolicy reads and returns the OPS-02 policy.
func LoadRollbackPolicy(fsys fs.FS, path string) (*RollbackPolicy, error) {
	var p RollbackPolicy
	if err := loadYAML(fsys, path, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

var validComparisons = map[string]bool{"gt": true, "gte": true, "lt": true, "lte": true}
var validSignalSources = map[string]bool{"prometheus": true, "deploy": true, "manual": true}
var validRollbackModes = map[string]bool{"advise": true, "enforce": true}

// requiredRollbackDimensions are the release-health dimensions the task
// mandates coverage for. A policy that drops one of them fails the gate.
var requiredRollbackSignals = []string{
	"api_error_rate",
	"frontend_error_rate",
	"frontend_lcp_p75",
	"frontend_inp_p75",
	"migration_failures",
}

// ValidateRollback enforces the policy invariants statically.
func ValidateRollback(p *RollbackPolicy) []Finding {
	const check = "rollback"
	var out []Finding

	if p.Version != 1 {
		out = append(out, errf(check, RollbackPolicyPath, "unsupported policy version %d (want 1)", p.Version))
	}
	e := p.Evaluation
	if e.BakeTime <= 0 {
		out = append(out, errf(check, "evaluation.bake_time", "must be positive — a zero bake window makes `proceed` meaningless"))
	}
	if e.SampleInterval <= 0 {
		out = append(out, errf(check, "evaluation.sample_interval", "must be positive"))
	}
	if e.MinSamples < 1 {
		out = append(out, errf(check, "evaluation.min_samples", "must be at least 1"))
	}
	if e.BreachStreak < 2 {
		out = append(out, errf(check, "evaluation.breach_streak", "must be at least 2 — ADR-008 forbids single-window rollback triggers"))
	}
	if e.MaxSampleAge <= 0 {
		out = append(out, errf(check, "evaluation.max_sample_age", "must be positive so stale data is never read as healthy"))
	}
	if e.MissingRequiredVerdict != VerdictHold && e.MissingRequiredVerdict != VerdictRollback {
		out = append(out, errf(check, "evaluation.missing_required_verdict", "must be hold or rollback — never proceed on absent telemetry"))
	}
	if e.BakeTime > 0 && e.SampleInterval > 0 && e.MinSamples > 0 {
		if need := time.Duration(e.MinSamples) * e.SampleInterval; need > e.BakeTime {
			out = append(out, errf(check, "evaluation", "min_samples(%d) x sample_interval(%s) = %s exceeds bake_time(%s); the policy can never reach `proceed`", e.MinSamples, e.SampleInterval, need, e.BakeTime))
		}
	}

	if len(p.Environments) == 0 {
		out = append(out, errf(check, "environments", "at least one environment must be declared"))
	}
	envSeen := map[string]bool{}
	for _, env := range p.Environments {
		if env.Name == "" {
			out = append(out, errf(check, "environments[]", "environment needs a name"))
			continue
		}
		if envSeen[env.Name] {
			out = append(out, errf(check, "environments["+env.Name+"]", "duplicate environment"))
		}
		envSeen[env.Name] = true
		if !validRollbackModes[env.Mode] {
			out = append(out, errf(check, "environments["+env.Name+"].mode", "mode %q must be advise or enforce", env.Mode))
		}
	}
	if env, ok := lookupEnvironment(p, "production"); ok && env.Mode == "enforce" && !env.ApprovalRequired {
		out = append(out, errf(check, "environments[production]", "enforce mode in production requires approval_required: true"))
	}

	seen := map[string]bool{}
	for _, s := range p.Signals {
		subject := "signals[" + s.ID + "]"
		if s.ID == "" {
			out = append(out, errf(check, "signals[]", "signal needs an id"))
			continue
		}
		if seen[s.ID] {
			out = append(out, errf(check, subject, "duplicate signal id"))
		}
		seen[s.ID] = true
		if strings.TrimSpace(s.Rationale) == "" {
			out = append(out, errf(check, subject, "rationale is required — thresholds without a documented basis are not reviewable"))
		}
		if !validSignalSources[s.Source] {
			out = append(out, errf(check, subject, "source %q must be prometheus, deploy, or manual", s.Source))
		}
		if s.Source == "prometheus" && strings.TrimSpace(s.Query) == "" {
			out = append(out, errf(check, subject, "prometheus signals need a query"))
		}
		if s.Source != "prometheus" && strings.TrimSpace(s.Query) != "" {
			out = append(out, errf(check, subject, "non-prometheus signal must not carry a promql query"))
		}
		if !validComparisons[s.Comparison] {
			out = append(out, errf(check, subject, "comparison %q must be gt, gte, lt, or lte", s.Comparison))
		}
		if s.Unit == "" {
			out = append(out, errf(check, subject, "unit is required"))
		}
		switch s.Comparison {
		case "gt", "gte":
			if s.Rollback < s.Warn {
				out = append(out, errf(check, subject, "rollback threshold (%v) must be >= warn (%v) for a %q comparison", s.Rollback, s.Warn, s.Comparison))
			}
		case "lt", "lte":
			if s.Rollback > s.Warn {
				out = append(out, errf(check, subject, "rollback threshold (%v) must be <= warn (%v) for a %q comparison", s.Rollback, s.Warn, s.Comparison))
			}
		}
		if s.Blocking && !s.Required {
			out = append(out, errf(check, subject, "a blocking signal must also be required"))
		}
	}

	for _, id := range requiredRollbackSignals {
		if !seen[id] {
			out = append(out, errf(check, RollbackPolicyPath, "missing mandatory signal %q", id))
			continue
		}
		if s, ok := lookupSignal(p, id); ok && !s.Required {
			out = append(out, errf(check, "signals["+id+"]", "mandatory signal must be marked required: true"))
		}
	}

	if len(p.RollbackPlan) == 0 {
		out = append(out, errf(check, "rollback_plan", "a rollback verdict with no plan is not actionable"))
	}
	planSteps := map[string]bool{}
	for _, s := range p.RollbackPlan {
		if s.Step == "" || strings.TrimSpace(s.Description) == "" {
			out = append(out, errf(check, "rollback_plan[]", "every step needs a name and a description"))
			continue
		}
		planSteps[s.Step] = true
	}
	for _, must := range []string{"revert-workloads", "assess-schema", "verify"} {
		if !planSteps[must] {
			out = append(out, errf(check, "rollback_plan", "missing mandatory step %q", must))
		}
	}
	return out
}

func lookupSignal(p *RollbackPolicy, id string) (RollbackSignal, bool) {
	for _, s := range p.Signals {
		if s.ID == id {
			return s, true
		}
	}
	return RollbackSignal{}, false
}

func lookupEnvironment(p *RollbackPolicy, name string) (RollbackEnvironment, bool) {
	for _, e := range p.Environments {
		if e.Name == name {
			return e, true
		}
	}
	return RollbackEnvironment{}, false
}

// breaches reports whether value crosses threshold under comparison.
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

// Evaluate turns a policy plus an observed snapshot into a decision.
//
// The rules, in precedence order:
//
//  1. A blocking signal that crossed its rollback threshold → rollback
//     immediately (no streak requirement — a failed migration does not
//     get three chances).
//  2. A non-blocking signal that crossed its rollback threshold for at
//     least breach_streak consecutive samples → rollback.
//  3. A required signal that is absent, stale, or under-sampled →
//     evaluation.missing_required_verdict (never proceed).
//  4. Any signal inside its warn band, or a rollback breach that has not
//     yet met the streak → hold.
//  5. Bake window not yet elapsed → hold.
//  6. Otherwise → proceed.
func Evaluate(p *RollbackPolicy, snap ReleaseSnapshot) RollbackDecision {
	byID := make(map[string]MetricSample, len(snap.Samples))
	for _, s := range snap.Samples {
		byID[s.SignalID] = s
	}

	decision := RollbackDecision{
		Environment:   snap.Environment,
		Version:       snap.Version,
		Commit:        snap.Commit,
		Verdict:       VerdictProceed,
		BakeSatisfied: snap.BakeElapsed >= p.Evaluation.BakeTime,
	}
	if env, ok := lookupEnvironment(p, snap.Environment); ok {
		decision.Mode = env.Mode
		decision.AutomationOK = env.Mode == "enforce"
	} else {
		decision.Mode = "advise"
		decision.AutomationOK = false
		decision.Reasons = append(decision.Reasons, fmt.Sprintf("environment %q is not declared in the policy; defaulting to advise-only", snap.Environment))
	}

	worst := VerdictProceed
	for _, sig := range p.Signals {
		ev := SignalEvaluation{
			SignalID:   sig.ID,
			Title:      sig.Title,
			Dimension:  sig.Dimension,
			Required:   sig.Required,
			Warn:       sig.Warn,
			Rollback:   sig.Rollback,
			Comparison: sig.Comparison,
			Verdict:    VerdictProceed,
		}

		sample, ok := byID[sig.ID]
		switch {
		case !ok:
			if sig.Required {
				ev.Verdict = p.Evaluation.MissingRequiredVerdict
				ev.Reasons = append(ev.Reasons, "no sample reported for a required signal")
			} else {
				ev.Reasons = append(ev.Reasons, "no sample reported (signal is optional)")
			}
		default:
			ev.Observed = true
			ev.Value = sample.Value
			age := snap.ObservedAt.Sub(sample.ObservedAt)
			switch {
			case !sample.ObservedAt.IsZero() && age > p.Evaluation.MaxSampleAge:
				if sig.Required {
					ev.Verdict = p.Evaluation.MissingRequiredVerdict
				}
				ev.Reasons = append(ev.Reasons, fmt.Sprintf("sample is %s old, older than max_sample_age %s", age.Round(time.Second), p.Evaluation.MaxSampleAge))
			case sample.Samples > 0 && sample.Samples < p.Evaluation.MinSamples && sig.Required && requiresSampling(sig):
				ev.Verdict = p.Evaluation.MissingRequiredVerdict
				ev.Reasons = append(ev.Reasons, fmt.Sprintf("only %d samples, need %d", sample.Samples, p.Evaluation.MinSamples))
			case breaches(sig.Comparison, sample.Value, sig.Rollback):
				switch {
				case sig.Blocking:
					ev.Verdict = VerdictRollback
					ev.Reasons = append(ev.Reasons, fmt.Sprintf("blocking signal breached rollback threshold (%v %s %v)", sample.Value, sig.Comparison, sig.Rollback))
				case sample.BreachStreak >= p.Evaluation.BreachStreak:
					ev.Verdict = VerdictRollback
					ev.Reasons = append(ev.Reasons, fmt.Sprintf("breached rollback threshold (%v %s %v) for %d consecutive samples", sample.Value, sig.Comparison, sig.Rollback, sample.BreachStreak))
				default:
					ev.Verdict = VerdictHold
					ev.Reasons = append(ev.Reasons, fmt.Sprintf("breached rollback threshold (%v %s %v) but streak is %d/%d", sample.Value, sig.Comparison, sig.Rollback, sample.BreachStreak, p.Evaluation.BreachStreak))
				}
			case breaches(sig.Comparison, sample.Value, sig.Warn):
				ev.Verdict = VerdictHold
				ev.Reasons = append(ev.Reasons, fmt.Sprintf("inside warn band (%v %s %v)", sample.Value, sig.Comparison, sig.Warn))
			}
		}

		if severity(ev.Verdict) > severity(worst) {
			worst = ev.Verdict
		}
		decision.Signals = append(decision.Signals, ev)
	}

	decision.Verdict = worst
	if worst == VerdictProceed && !decision.BakeSatisfied {
		decision.Verdict = VerdictHold
		decision.Reasons = append(decision.Reasons, fmt.Sprintf("bake window not satisfied: %s elapsed of %s", snap.BakeElapsed.Round(time.Second), p.Evaluation.BakeTime))
	}
	for _, ev := range decision.Signals {
		if ev.Verdict == VerdictProceed {
			continue
		}
		for _, r := range ev.Reasons {
			decision.Reasons = append(decision.Reasons, ev.SignalID+": "+r)
		}
	}
	sort.Strings(decision.Reasons)
	if decision.Verdict == VerdictRollback {
		decision.RemediationFor = VerdictRollback
		decision.Plan = p.RollbackPlan
	}
	return decision
}

// requiresSampling reports whether min_samples / breach_streak apply to
// a signal.
//
// Only scraped time-series accumulate samples. A deploy-sourced fact —
// "the migrate Job exited non-zero" — is observed exactly once, and
// demanding five samples of it would turn a hard failure into a
// permanent `hold`. Blocking signals are exempt for the same reason:
// they are asserted, not sampled.
func requiresSampling(s RollbackSignal) bool {
	return s.Source == "prometheus" && !s.Blocking
}

func severity(v Verdict) int {
	switch v {
	case VerdictRollback:
		return 2
	case VerdictHold:
		return 1
	default:
		return 0
	}
}

// CheckRollback loads and validates the policy at the canonical path.
func CheckRollback(fsys fs.FS) []Finding {
	p, err := LoadRollbackPolicy(fsys, RollbackPolicyPath)
	if err != nil {
		return []Finding{errf("rollback", RollbackPolicyPath, "%v", err)}
	}
	return ValidateRollback(p)
}
