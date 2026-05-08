// Package api provides alert rule evaluation against real-time telemetry signals.
package api

import (
	"context"
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog/log"
)

// RuleStateStore is the persistence seam for alert latch + fire state. It
// is satisfied by *database.AlertRuleStateRepo in production and by a
// small in-memory fake in unit tests. See migration 000193 and Phase-49
// Slice 0002 for the design rationale.
//
// All methods are safe to call from a concurrent context — the SQL
// implementation uses a race-safe ON CONFLICT upsert (see
// alertRuleStateMarkFiredSQL) and the tests' fake uses a mutex.
type RuleStateStore interface {
	LoadAll(ctx context.Context) ([]*database.AlertRuleState, error)
	MarkFired(ctx context.Context, ruleID, vehicleID int64, now time.Time, isOnce bool) (bool, error)
	ClearLatch(ctx context.Context, ruleID, vehicleID int64, now time.Time) error
}

// RuleEngine evaluates alert rules against incoming telemetry signals.
// It tracks per-rule cooldown and previous signal state in an in-memory
// write-through cache backed by RuleStateStore (when configured). The
// in-memory map is the hot-read path; writes go to the store first to
// enforce cross-pod race safety, then update the cache on success.
type RuleEngine struct {
	mu        sync.RWMutex
	state     map[ruleKey]*ruleState // per (ruleID, vehicleID) state
	stateRepo RuleStateStore         // optional; nil means in-memory-only (legacy/test)
}

type ruleKey struct {
	RuleID    int64
	VehicleID int64
}

type ruleState struct {
	PrevSignals map[string]interface{} // previous signal values for transition baselines
	LastFiredAt *time.Time             // cooldown tracking
	// OnceLatched is true while a once-mode rule is suppressed after firing,
	// until ClearLatch runs on the falling edge. Sourced from
	// alert_rule_state.latched_at IS NOT NULL when stateRepo is configured.
	OnceLatched bool
}

// NewRuleEngine creates a new alert rule engine. The returned engine has
// no persistence wiring; call SetStateRepo + HydrateFromDB to enable
// pod-restart-safe latch state.
func NewRuleEngine() *RuleEngine {
	return &RuleEngine{
		state: make(map[ruleKey]*ruleState),
	}
}

// SetStateRepo wires the persistent latch/fire-state repo. Pass nil to
// disable persistence (used by unit tests that don't care about restart
// survival). Production wiring lives in
// internal/api/telemetry_alerts.go::NewTelemetryAlertEvaluator.
func (e *RuleEngine) SetStateRepo(repo RuleStateStore) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stateRepo = repo
}

// HydrateFromDB loads every persisted (rule, vehicle) state row into the
// in-memory cache. Must be called once at engine boot, before MQTT
// subscribers start dispatching telemetry. No-op when stateRepo is nil.
//
// Errors are logged but NOT fatal — degraded behavior (no latch
// persistence) is preferable to refusing to start.
func (e *RuleEngine) HydrateFromDB(ctx context.Context) {
	e.mu.RLock()
	repo := e.stateRepo
	e.mu.RUnlock()
	if repo == nil {
		return
	}
	rows, err := repo.LoadAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("alert_rules: HydrateFromDB failed — running with empty latch cache")
		return
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	for _, row := range rows {
		key := ruleKey{RuleID: row.RuleID, VehicleID: row.VehicleID}
		st, ok := e.state[key]
		if !ok {
			st = &ruleState{}
			e.state[key] = st
		}
		if row.LatchedAt != nil {
			st.OnceLatched = true
		}
		if row.LastFiredAt != nil {
			t := *row.LastFiredAt
			st.LastFiredAt = &t
		}
	}
	log.Info().Int("rows", len(rows)).Msg("alert_rules: hydrated rule_engine state from alert_rule_state")
}

// EvalResult holds the outcome of evaluating a rule.
type EvalResult struct {
	Triggered bool
	Message   string
}

// Evaluate checks a single rule against the current signal batch.
// Returns whether the rule triggered and the rendered message.
func (e *RuleEngine) Evaluate(rule *models.AlertRule, vehicleID int64, signals map[string]interface{}) EvalResult {
	// Snooze takes precedence over cooldown, condition, and trigger mode.
	// While snoozed, no state is changed (no prev-signal updates) so the
	// rule resumes its previous behavior cleanly when the snooze expires.
	if rule.SnoozedUntil != nil && time.Now().UTC().Before(*rule.SnoozedUntil) {
		metrics.AlertRulesSnoozeSkipped.Inc()
		return EvalResult{}
	}

	// Cooldown check.
	key := ruleKey{RuleID: rule.ID, VehicleID: vehicleID}
	e.mu.RLock()
	st, hasState := e.state[key]

	// Copy state under lock to avoid concurrent map access.
	var prevSignals map[string]interface{}
	var lastFiredAt *time.Time
	var onceLatched bool
	if hasState {
		lastFiredAt = st.LastFiredAt
		onceLatched = st.OnceLatched
		prevSignals = cloneSignals(st.PrevSignals)
	}
	if len(prevSignals) < 1 {
		if baseline, ok := e.state[ruleKey{RuleID: 0, VehicleID: vehicleID}]; ok {
			prevSignals = cloneSignals(baseline.PrevSignals)
		}
	}
	e.mu.RUnlock()

	// Once-mode rules need to keep evaluating to detect the falling edge that
	// resets the latch — same as transition rules.
	needsFalseEdgeDetection := isTransitionRule(rule) || rule.TriggerMode == "once"

	inCooldown := false
	if hasState && lastFiredAt != nil {
		cooldown := time.Duration(rule.CooldownMin) * time.Minute
		if cooldown <= 0 {
			cooldown = 15 * time.Minute
		}
		if time.Since(*lastFiredAt) < cooldown {
			if !needsFalseEdgeDetection {
				metrics.AlertRulesCooldownSkipped.Inc()
				return EvalResult{} // still in cooldown — non-edge rules skip evaluation
			}
			inCooldown = true // edge-aware rules continue to evaluate for reset detection
		}
	}

	// Evaluate typed rule fields.
	matched := evalRule(rule, signals, prevSignals)

	if !matched {
		// Falling edge: clear the once-mode latch and reset cooldown for
		// edge-aware rules so the next rising edge can fire immediately.
		// Also clears the persistent latch row when stateRepo is wired —
		// otherwise a pod restart would re-suppress the next rising edge
		// based on the still-set latched_at column.
		e.mu.Lock()
		hadLatch := st != nil && st.OnceLatched
		hadLastFired := st != nil && st.LastFiredAt != nil && needsFalseEdgeDetection
		if st != nil {
			st.OnceLatched = false
			if st.LastFiredAt != nil && needsFalseEdgeDetection {
				st.LastFiredAt = nil
			}
		}
		repo := e.stateRepo
		e.mu.Unlock()
		if repo != nil && (hadLatch || hadLastFired) {
			if err := repo.ClearLatch(context.Background(), rule.ID, vehicleID, time.Now().UTC()); err != nil {
				log.Warn().Err(err).Int64("rule_id", rule.ID).Int64("vehicle_id", vehicleID).
					Msg("alert_rules: ClearLatch failed; in-memory cleared but DB row stale")
			}
		}
		e.updatePrevSignals(key, signals)
		return EvalResult{}
	}

	// Matched. Once-mode rules that already fired since the last falling
	// edge stay quiet until the condition resets.
	if rule.TriggerMode == "once" && onceLatched {
		metrics.AlertRulesCooldownSkipped.Inc()
		e.updatePrevSignals(key, signals)
		return EvalResult{}
	}

	// Update state.
	e.updatePrevSignals(key, signals)

	// Transition / once-mode rules that matched but are still in cooldown
	// get suppressed.
	if inCooldown {
		metrics.AlertRulesCooldownSkipped.Inc()
		return EvalResult{}
	}

	// Fire. Persist the fire BEFORE updating the in-memory cache so that
	// race-lost peers (MarkFired returns (false, nil) when another pod
	// already latched) don't dispatch the alert. Repo failures fall back
	// to in-memory-only behavior — degraded persistence is preferable to
	// dropping the alert entirely.
	now := time.Now().UTC()
	isOnce := rule.TriggerMode == "once"

	e.mu.RLock()
	repo := e.stateRepo
	e.mu.RUnlock()

	if repo != nil {
		ok, err := repo.MarkFired(context.Background(), rule.ID, vehicleID, now, isOnce)
		if err != nil {
			log.Warn().Err(err).Int64("rule_id", rule.ID).Int64("vehicle_id", vehicleID).
				Msg("alert_rules: MarkFired failed; firing anyway with in-memory state only")
		} else if !ok {
			// Race lost — peer pod (or earlier batch on this pod with a
			// stale cache) already latched. Update local cache to match
			// the persistent truth and suppress.
			metrics.AlertRulesCooldownSkipped.Inc()
			e.mu.Lock()
			if st == nil {
				st = &ruleState{}
				e.state[key] = st
			}
			if isOnce {
				st.OnceLatched = true
			}
			st.LastFiredAt = &now
			e.mu.Unlock()
			return EvalResult{}
		}
	}

	e.mu.Lock()
	if st != nil {
		st.LastFiredAt = &now
		if isOnce {
			st.OnceLatched = true
		}
	} else {
		st = &ruleState{LastFiredAt: &now}
		if isOnce {
			st.OnceLatched = true
		}
		e.state[key] = st
	}
	e.mu.Unlock()

	// Render message template — merge prevSignals with current batch so template
	// variables resolve even when the signal was from a recent (but not current) batch
	mergedSignals := make(map[string]interface{}, len(signals))
	if prevSignals != nil {
		for k, v := range prevSignals {
			mergedSignals[k] = v
		}
	}
	for k, v := range signals {
		mergedSignals[k] = v
	}
	// MsgTemplate was removed from AlertRule; derive a default template
	// that includes the rule name and the triggering signal value.
	defaultTmpl := rule.Name + ": {{" + rule.SignalName + "}}"
	message := renderTemplate(defaultTmpl, mergedSignals)
	if len(message) < 1 {
		message = rule.Name
	}

	return EvalResult{
		Triggered: true,
		Message:   message,
	}
}

func cloneSignals(signals map[string]interface{}) map[string]interface{} {
	if signals != nil {
		cloned := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			cloned[k] = v
		}
		return cloned
	}
	return nil
}

// updatePrevSignals stores the current signals as previous for next evaluation.
func (e *RuleEngine) updatePrevSignals(key ruleKey, signals map[string]interface{}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	st, ok := e.state[key]
	if !ok {
		st = &ruleState{}
		e.state[key] = st
	}
	// Merge (don't overwrite — partial batches shouldn't erase known values)
	if st.PrevSignals != nil {
		// Merge into the existing baseline.
	} else {
		st.PrevSignals = make(map[string]interface{}, len(signals))
	}
	for k, v := range signals {
		if v != nil {
			st.PrevSignals[k] = v
		}
	}
}

// SetLastFired updates the cooldown state after an external dedup check.
func (e *RuleEngine) SetLastFired(ruleID, vehicleID int64, t time.Time) {
	key := ruleKey{RuleID: ruleID, VehicleID: vehicleID}
	e.mu.Lock()
	defer e.mu.Unlock()
	st, ok := e.state[key]
	if !ok {
		st = &ruleState{}
		e.state[key] = st
	}
	st.LastFiredAt = &t
}

// LoadCooldownFromDB restores cooldown state from the database (pod restart recovery).
// LastFiredAt is now tracked in-memory only; this method initializes state entries
// for rules scoped to specific vehicles so cooldown tracking begins immediately.
func (e *RuleEngine) LoadCooldownFromDB(ctx context.Context, rules []*models.AlertRule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, rule := range rules {
		vid := int64(0)
		if rule.VehicleID != nil {
			vid = *rule.VehicleID
		}
		key := ruleKey{RuleID: rule.ID, VehicleID: vid}
		if _, ok := e.state[key]; !ok {
			e.state[key] = &ruleState{}
		}
	}
}

// LoadPrevSignalsFromStore populates prevSignals for all rules from the SignalStore.
// Called after pod restart so changed operators have a baseline.
func (e *RuleEngine) LoadPrevSignalsFromStore(vehicleID int64, signals map[string]interface{}) {
	if len(signals) < 1 {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	// Update existing state entries
	for key, st := range e.state {
		if key.VehicleID != vehicleID && key.VehicleID != 0 {
			continue
		}
		if st.PrevSignals != nil {
			// Merge into the existing baseline.
		} else {
			st.PrevSignals = make(map[string]interface{}, len(signals))
		}
		for k, v := range signals {
			st.PrevSignals[k] = v
		}
	}

	// Also create a "baseline" entry for this vehicle so new rules
	// get prevSignals on their first evaluation
	baselineKey := ruleKey{RuleID: 0, VehicleID: vehicleID}
	if _, exists := e.state[baselineKey]; !exists {
		baseline := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			baseline[k] = v
		}
		e.state[baselineKey] = &ruleState{
			PrevSignals: baseline,
		}
	}
}

// ──────────────────────────────────────────────────────────────────────
// Typed rule evaluation
// ──────────────────────────────────────────────────────────────────────

func evalRule(rule *models.AlertRule, signals, prevSignals map[string]interface{}) bool {
	if rule != nil {
		// Continue with typed rule evaluation.
	} else {
		return false
	}
	if len(rule.SignalName) < 1 || len(rule.Op) < 1 {
		return false
	}

	current, hasCurrent := signals[rule.SignalName]
	if !hasCurrent {
		switch rule.Op {
		case "changed":
			return false
		}
		// Tesla delta-streams only changed values, so a signal may be absent
		// from this batch but still valid from a recent batch.
		if prev, hasPrev := prevSignals[rule.SignalName]; hasPrev {
			current = prev
			hasCurrent = true
		}
		if !hasCurrent {
			return false
		}
	}

	switch rule.Op {
	case "=":
		operand, ok := alertRuleOperand(rule)
		return ok && compareEq(current, operand)
	case "!=":
		operand, ok := alertRuleOperand(rule)
		return ok && !compareEq(current, operand)
	case ">":
		operand, ok := alertRuleOperand(rule)
		return ok && compareNum(current, operand) > 0
	case "<":
		operand, ok := alertRuleOperand(rule)
		return ok && compareNum(current, operand) < 0
	case ">=":
		operand, ok := alertRuleOperand(rule)
		return ok && compareNum(current, operand) >= 0
	case "<=":
		operand, ok := alertRuleOperand(rule)
		return ok && compareNum(current, operand) <= 0
	case "changed":
		prev, hasPrev := prevSignals[rule.SignalName]
		if !hasPrev {
			return false
		}
		if compareEq(prev, current) {
			return false
		}
		operand, hasOperand := alertRuleOperand(rule)
		if !hasOperand {
			return true
		}
		return compareEq(current, operand)
	case "between":
		return evalRange(rule, current, true)
	case "outside":
		return evalRange(rule, current, false)
	}

	return false
}

func alertRuleOperand(rule *models.AlertRule) (interface{}, bool) {
	if rule.ValueNum != nil {
		return *rule.ValueNum, true
	}
	if rule.ValueText != nil {
		return *rule.ValueText, true
	}
	if rule.ValueBool != nil {
		return *rule.ValueBool, true
	}
	return nil, false
}

func evalRange(rule *models.AlertRule, current interface{}, inside bool) bool {
	if rule.ValueMin != nil && rule.ValueMax != nil {
		aboveMin := compareNum(current, *rule.ValueMin) >= 0
		belowMax := compareNum(current, *rule.ValueMax) <= 0
		inRange := aboveMin && belowMax
		if inside {
			return inRange
		}
		return !inRange
	}
	return false
}

// ──────────────────────────────────────────────────────────────────────
// Type coercion helpers
// ──────────────────────────────────────────────────────────────────────

func ruleToNum(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case json.Number:
		f, _ := val.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	case bool:
		if val {
			return 1
		}
		return 0
	}
	return 0
}

func compareEq(a, b interface{}) bool {
	aNum, bNum := ruleToNum(a), ruleToNum(b)
	if aNum != 0 || bNum != 0 {
		return math.Abs(aNum-bNum) < 0.001
	}
	return strings.EqualFold(toString(a), toString(b))
}

func compareNum(a, b interface{}) int {
	aNum, bNum := ruleToNum(a), ruleToNum(b)
	if aNum < bNum {
		return -1
	}
	if aNum > bNum {
		return 1
	}
	return 0
}

// ──────────────────────────────────────────────────────────────────────
// Template rendering
// ──────────────────────────────────────────────────────────────────────

// isTransitionRule returns true for baseline-aware transition rules. Cooldown
// reset only applies to transitions; threshold rules should not reset on brief
// bounces to avoid notification storms.
func isTransitionRule(rule *models.AlertRule) bool {
	if rule != nil {
		switch rule.Op {
		case "changed":
			return true
		}
	}
	return false
}

var templateRe = regexp.MustCompile(`\{\{(\w+)\}\}`)

func renderTemplate(tmpl string, signals map[string]interface{}) string {
	if len(tmpl) < 1 {
		return ""
	}
	return templateRe.ReplaceAllStringFunc(tmpl, func(match string) string {
		key := match[2 : len(match)-2] // strip {{ and }}
		if v, ok := signals[key]; ok {
			return toString(v)
		}
		return match
	})
}
