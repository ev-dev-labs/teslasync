package computed

import (
	"context"
	"fmt"
	"sync"
	"time"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// Evaluator evaluates kind='computed_metric' alert rules on a scheduled
// cadence. Unlike the streaming RuleEngine in internal/api which is
// driven by per-batch telemetry, this evaluator is invoked from a worker
// goroutine every few minutes.
//
// State is per-(ruleID, vehicleID) cooldown only — there is no "previous
// signal" baseline because computed metrics are always evaluated against
// a fresh aggregation.
type Evaluator struct {
	db       *database.DB
	registry map[string]MetricDef
	now      func() time.Time
	mu       sync.Mutex
	state    map[stateKey]time.Time // last fired
}

// stateKey identifies one (rule, vehicle) cooldown bucket. Defined locally
// (instead of importing internal/api.ruleKey) so the package remains
// independent of internal/api.
type stateKey struct {
	RuleID    int64
	VehicleID int64
}

// Result is the per-evaluation outcome carrying the raw metric value so
// the /alerts/test preview can show "right now this is $147.82". The
// Triggered + Message fields preserve the historical embedded EvalResult
// shape via field promotion at the JSON / struct-literal layer.
type Result struct {
	Triggered     bool
	Message       string
	Value         float64 // current-window metric value
	PreviousValue float64 // previous-window metric value (only set for %_change_ ops)
	PercentChange float64 // computed pct change (only set for %_change_ ops)
}

// New builds an evaluator backed by the global ComputedMetrics registry.
// db is used by the per-metric Compute functions.
func New(db *database.DB) *Evaluator {
	return &Evaluator{
		db:       db,
		registry: ComputedMetrics,
		now:      func() time.Time { return time.Now().UTC() },
		state:    make(map[stateKey]time.Time),
	}
}

// NewWithRegistry is the constructor used by tests so they can inject
// deterministic Compute functions instead of hitting the DB.
func NewWithRegistry(registry map[string]MetricDef, now func() time.Time) *Evaluator {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Evaluator{
		registry: registry,
		now:      now,
		state:    make(map[stateKey]time.Time),
	}
}

// Evaluate computes the metric for one rule + vehicle and returns whether
// the rule should fire. Honors snoozed_until and the rule's cooldown_min.
func (e *Evaluator) Evaluate(ctx context.Context, rule *alertmodel.AlertRule, vehicleID int64) (Result, error) {
	if rule == nil {
		return Result{}, fmt.Errorf("computed_metric: nil rule")
	}
	if rule.Kind != alertmodel.AlertRuleKindComputedMetric {
		return Result{}, fmt.Errorf("computed_metric: rule %d has kind %q, expected %q",
			rule.ID, rule.Kind, alertmodel.AlertRuleKindComputedMetric)
	}
	if rule.MetricID == nil || rule.MetricWindow == nil || rule.MetricThreshold == nil || rule.MetricOp == nil {
		return Result{}, fmt.Errorf("computed_metric: rule %d missing metric_*", rule.ID)
	}

	metric, ok := e.registry[*rule.MetricID]
	if !ok {
		return Result{}, fmt.Errorf("%w: %s", ErrUnknownMetric, *rule.MetricID)
	}
	if !metric.IsValidWindow(*rule.MetricWindow) {
		return Result{}, fmt.Errorf("computed_metric: window %q not allowed for metric %q",
			*rule.MetricWindow, metric.ID)
	}

	now := e.now()
	curStart, curEnd, err := WindowBounds(*rule.MetricWindow, now)
	if err != nil {
		return Result{}, err
	}

	current, err := metric.Compute(ctx, e.db, vehicleID, curStart, curEnd)
	if err != nil {
		return Result{}, fmt.Errorf("computed_metric %s: %w", metric.ID, err)
	}

	out := Result{Value: current}

	// Snooze takes precedence over cooldown / matching. Computing the
	// metric before this check is intentional so /alerts/test still
	// returns the current value while a rule is snoozed (preview UX).
	if rule.SnoozedUntil != nil && now.Before(*rule.SnoozedUntil) {
		return out, nil
	}

	matched := false
	if IsPercentChangeOp(*rule.MetricOp) {
		prevStart, prevEnd, err := PreviousWindowBounds(*rule.MetricWindow, now)
		if err != nil {
			return out, err
		}
		previous, err := metric.Compute(ctx, e.db, vehicleID, prevStart, prevEnd)
		if err != nil {
			return out, fmt.Errorf("computed_metric %s previous-window: %w", metric.ID, err)
		}
		out.PreviousValue = previous
		matched, out.PercentChange, err = ComparePercentChange(*rule.MetricOp, current, previous, *rule.MetricThreshold)
		if err != nil {
			return out, err
		}
	} else {
		matched, err = CompareMetric(*rule.MetricOp, current, *rule.MetricThreshold)
		if err != nil {
			return out, err
		}
	}

	if !matched {
		return out, nil
	}

	// Cooldown: a rule that just fired stays quiet for cooldown_min.
	key := stateKey{RuleID: rule.ID, VehicleID: vehicleID}
	cooldown := time.Duration(rule.CooldownMin) * time.Minute
	if cooldown <= 0 {
		cooldown = 60 * time.Minute
	}
	e.mu.Lock()
	if last, ok := e.state[key]; ok && now.Sub(last) < cooldown {
		e.mu.Unlock()
		metrics.AlertRulesCooldownSkipped.Inc()
		return out, nil
	}
	e.state[key] = now
	e.mu.Unlock()

	out.Triggered = true
	out.Message = formatComputedMetricMessage(metric, *rule.MetricOp, current, *rule.MetricThreshold, out.PercentChange)
	return out, nil
}

// Preview computes the metric without firing — used by POST /alerts/test
// for kind='computed_metric' so the rule builder UI can show "right now
// this is X". Bypasses snooze and cooldown.
func (e *Evaluator) Preview(ctx context.Context, rule *alertmodel.AlertRule, vehicleID int64) (Result, bool, error) {
	if rule == nil {
		return Result{}, false, fmt.Errorf("computed_metric: nil rule")
	}
	if rule.MetricID == nil || rule.MetricWindow == nil || rule.MetricThreshold == nil || rule.MetricOp == nil {
		return Result{}, false, fmt.Errorf("computed_metric: missing metric_*")
	}
	metric, ok := e.registry[*rule.MetricID]
	if !ok {
		return Result{}, false, fmt.Errorf("%w: %s", ErrUnknownMetric, *rule.MetricID)
	}
	if !metric.IsValidWindow(*rule.MetricWindow) {
		return Result{}, false, fmt.Errorf("window %q not allowed for metric %q", *rule.MetricWindow, metric.ID)
	}
	now := e.now()
	curStart, curEnd, err := WindowBounds(*rule.MetricWindow, now)
	if err != nil {
		return Result{}, false, err
	}
	current, err := metric.Compute(ctx, e.db, vehicleID, curStart, curEnd)
	if err != nil {
		return Result{}, false, err
	}
	out := Result{Value: current}
	matched := false
	if IsPercentChangeOp(*rule.MetricOp) {
		prevStart, prevEnd, err := PreviousWindowBounds(*rule.MetricWindow, now)
		if err != nil {
			return out, false, err
		}
		previous, err := metric.Compute(ctx, e.db, vehicleID, prevStart, prevEnd)
		if err != nil {
			return out, false, err
		}
		out.PreviousValue = previous
		matched, out.PercentChange, err = ComparePercentChange(*rule.MetricOp, current, previous, *rule.MetricThreshold)
		if err != nil {
			return out, false, err
		}
	} else {
		matched, err = CompareMetric(*rule.MetricOp, current, *rule.MetricThreshold)
		if err != nil {
			return out, false, err
		}
	}
	out.Message = formatComputedMetricMessage(metric, *rule.MetricOp, current, *rule.MetricThreshold, out.PercentChange)
	return out, matched, nil
}

// ResetCooldown clears the in-memory cooldown state for one rule.
// Exposed for tests; production code never needs to call it.
func (e *Evaluator) ResetCooldown(ruleID, vehicleID int64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.state, stateKey{RuleID: ruleID, VehicleID: vehicleID})
}
