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

// defaultMaxFiresPerHour is the engine-level safety cap that limits how
// many times a single (rule, vehicle) pair can fire inside any rolling
// 1h window. It supersedes the legacy CooldownFSM hourly limit (also 4)
// merged into the engine in Phase-49 / Slice 0004. A rule that exceeds
// it gets suppressed even if cooldown_min and max_fires_per_resolution
// would otherwise allow the fire — this is the last-line defence against
// notification storms from a flapping signal.
const defaultMaxFiresPerHour = 4

// RuleEngine evaluates alert rules against incoming telemetry signals.
// It tracks per-rule cooldown and previous signal state in an in-memory
// write-through cache backed by RuleStateStore (when configured). The
// in-memory map is the hot-read path; writes go to the store first to
// enforce cross-pod race safety, then update the cache on success.
type RuleEngine struct {
	mu              sync.RWMutex
	state           map[ruleKey]*ruleState // per (ruleID, vehicleID) state
	stateRepo       RuleStateStore         // optional; nil means in-memory-only (legacy/test)
	maxFiresPerHour int                    // 0 ⇒ defaultMaxFiresPerHour; non-zero overrides
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
	// FireCountSinceReset mirrors alert_rule_state.fire_count_since_reset.
	// Compared against rule.MaxFiresPerResolution to enforce the per-rule
	// cap added in Phase-49 / Slice 0003 / Decision D5. Reset to 0 on the
	// falling edge by ClearLatch (both DB and cache).
	FireCountSinceReset int
	// HourWindowStart and FireCountHour back the engine-level hourly safety
	// cap merged in from CooldownFSM in Phase-49 / Slice 0004. The window
	// rolls over lazily on the next fire after time.Hour has elapsed; the
	// counter is intentionally NOT reset on the falling edge so that a
	// signal flapping repeatedly within an hour still gets suppressed once
	// the cap is reached. Pure in-memory (no DB persistence) — pod restart
	// rearms the cap, matching pre-merge CooldownFSM behaviour.
	HourWindowStart time.Time
	FireCountHour   int
	// ConditionStartedAt records when the underlying condition was first
	// observed as TRUE in the current resolution (the fire that bumped
	// FireCountSinceReset from 0 → 1). Cleared on the falling edge by
	// ClearLatch. Read by the escalation gate (Phase-49 / Slice 0009 /
	// Decision D8) to compute "minutes the condition has stayed
	// unresolved." Pure in-memory (no DB persistence) — pod restart
	// resets the escalation timer, same trade-off as HourWindowStart.
	ConditionStartedAt *time.Time
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

// SetMaxFiresPerHour overrides the engine-level hourly fire cap. Pass 0
// (or omit entirely) to fall back to defaultMaxFiresPerHour. Tests use
// this to exercise the cap with small numbers without sleeping.
func (e *RuleEngine) SetMaxFiresPerHour(n int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.maxFiresPerHour = n
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
		st.FireCountSinceReset = row.FireCountSinceReset
	}
	log.Info().Int("rows", len(rows)).Msg("alert_rules: hydrated rule_engine state from alert_rule_state")
}

// EvalResult holds the outcome of evaluating a rule.
type EvalResult struct {
	Triggered bool
	// Message is the body text produced by the engine for backward
	// compatibility with callers that don't yet route through the
	// alertmsg package. The canonical title/body are now produced at
	// dispatch time using EvalResult.Context — callers should prefer
	// alertmsg.RenderTitle / alertmsg.RenderBody over this field.
	Message string
	// Severity is the EFFECTIVE severity for this fire — it equals the
	// rule's base severity in the common case, and the rule's
	// `EscalationSeverity` when the escalation timer fired (Phase-49 /
	// Slice 0009 / Decision D8). Empty string when the rule did not
	// trigger; callers MUST fall back to `rule.Severity` defensively if
	// they ever see an empty severity on a Triggered=true result.
	Severity string
	// Context is the merged signal map (previous + current batch) the
	// engine evaluated against, exposed so the dispatch layer can build
	// a notification body via alertmsg.RenderBody / alertmsg.Substitute
	// without re-cloning state. Nil when Triggered is false.
	// Phase-50 / ADR-005.
	Context map[string]any
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
	var fireCount int
	var hourWindowStart time.Time
	var fireCountHour int
	maxFiresPerHour := e.maxFiresPerHour
	if hasState {
		lastFiredAt = st.LastFiredAt
		onceLatched = st.OnceLatched
		fireCount = st.FireCountSinceReset
		hourWindowStart = st.HourWindowStart
		fireCountHour = st.FireCountHour
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
		hadFireCount := st != nil && st.FireCountSinceReset > 0
		if st != nil {
			st.OnceLatched = false
			if st.LastFiredAt != nil && needsFalseEdgeDetection {
				st.LastFiredAt = nil
			}
			st.FireCountSinceReset = 0
			// Phase-49 / Slice 0009 — clear the escalation onset on the
			// falling edge so the next rising edge starts a fresh
			// escalation timer. Mirrors FireCountSinceReset reset.
			st.ConditionStartedAt = nil
		}
		repo := e.stateRepo
		e.mu.Unlock()
		if repo != nil && (hadLatch || hadLastFired || hadFireCount) {
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

	// Per-rule max-fires-per-resolution cap (Phase-49 / Slice 0003 / D5).
	// Once-mode rules are exempt — the latch already caps them at 1, and
	// applying the cap on top would just be a redundant guard. The
	// counter resets to 0 on the falling edge (handled above), so a
	// rule that hit the cap stays suppressed only until the underlying
	// condition resolves and re-fires.
	if rule.TriggerMode != "once" &&
		rule.MaxFiresPerResolution != nil &&
		fireCount >= *rule.MaxFiresPerResolution {
		metrics.AlertRulesMaxFiresCapHit.Inc()
		return EvalResult{}
	}

	// Engine-level hourly fire cap (Phase-49 / Slice 0004 — replaces
	// CooldownFSM.MaxFiresPerHour). Computed against an in-memory rolling
	// 1h window per (rule, vehicle). Once-mode rules are exempt because
	// the latch already caps them at 1 per resolution. The window is
	// rolled lazily during MarkFired bookkeeping below; here we only
	// observe the snapshot taken at evaluation start.
	if rule.TriggerMode != "once" {
		capHour := maxFiresPerHour
		if capHour <= 0 {
			capHour = defaultMaxFiresPerHour
		}
		if !hourWindowStart.IsZero() &&
			time.Since(hourWindowStart) <= time.Hour &&
			fireCountHour >= capHour {
			metrics.AlertRulesHourlyCapHit.Inc()
			return EvalResult{}
		}
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
	// Phase-49 / Slice 0009 — stamp ConditionStartedAt on the FIRST fire
	// of this resolution (the one that bumps fire_count_since_reset 0→1).
	// Subsequent fires within the same resolution leave it alone so the
	// escalation timer measures from "condition first observed true."
	// Cleared by the falling-edge branch above (and by ClearLatch on
	// the persistent side). This is in-memory only, mirroring the
	// HourWindowStart trade-off.
	if st != nil {
		st.LastFiredAt = &now
		if st.FireCountSinceReset == 0 {
			started := now
			st.ConditionStartedAt = &started
		}
		st.FireCountSinceReset++
		if isOnce {
			st.OnceLatched = true
		}
		if st.HourWindowStart.IsZero() || now.Sub(st.HourWindowStart) > time.Hour {
			st.HourWindowStart = now
			st.FireCountHour = 1
		} else {
			st.FireCountHour++
		}
	} else {
		started := now
		st = &ruleState{
			LastFiredAt:         &now,
			FireCountSinceReset: 1,
			HourWindowStart:     now,
			FireCountHour:       1,
			ConditionStartedAt:  &started,
		}
		if isOnce {
			st.OnceLatched = true
		}
		e.state[key] = st
	}
	// Re-snapshot ConditionStartedAt under the same lock so the
	// escalation gate below sees a consistent view (could have been
	// freshly stamped above on the first-fire path).
	conditionStartedAtLocal := st.ConditionStartedAt
	e.mu.Unlock()

	// Phase-49 / Slice 0009 — escalation severity gate. Only meaningful
	// for repeat-mode rules (DB CHECK constraint enforces that, defence
	// in depth here too). When the rule has both escalation knobs set
	// AND the condition has stayed unresolved for at least
	// EscalationAfterMin minutes, fire AT the higher severity. The
	// counter is bumped once per dispatched escalated alert (not per
	// evaluation, so it cannot drift on cap-suppressed evals).
	effectiveSeverity := rule.Severity
	if rule.TriggerMode != "once" &&
		rule.EscalationAfterMin != nil && rule.EscalationSeverity != nil &&
		conditionStartedAtLocal != nil &&
		now.Sub(*conditionStartedAtLocal) >= time.Duration(*rule.EscalationAfterMin)*time.Minute {
		effectiveSeverity = *rule.EscalationSeverity
		metrics.AlertRulesEscalated.Inc()
	}

	// Render message template — merge prevSignals with current batch so template
	// variables resolve even when the signal was from a recent (but not current) batch.
	// The merged map is also returned in EvalResult.Context so the dispatch
	// layer can render title/body via internal/alertmsg without re-cloning.
	mergedSignals := make(map[string]interface{}, len(signals))
	for k, v := range prevSignals {
		mergedSignals[k] = v
	}
	for k, v := range signals {
		mergedSignals[k] = v
	}
	// Legacy Message field — kept populated for backward compatibility
	// with callers that haven't yet been routed through alertmsg. The
	// new dispatch path (telemetry_alerts.fireAlert / preview endpoint)
	// ignores this and re-renders via alertmsg.RenderBody using
	// EvalResult.Context. Phase-50 / ADR-005.
	defaultTmpl := rule.Name + ": {{" + rule.SignalName + "}}"
	message := renderTemplate(defaultTmpl, mergedSignals)
	if len(message) < 1 {
		message = rule.Name
	}

	return EvalResult{
		Triggered: true,
		Message:   message,
		Severity:  effectiveSeverity,
		Context:   mergedSignals,
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
//
// Phase-49 / Slice 0005: iterates `rule.VehicleIDs` for multi-select rules
// instead of the deprecated single `rule.VehicleID`. Sticky-all rules
// (`rule.AllVehicles=true`) get a single fleet-baseline entry keyed on
// vehicleID=0; per-vehicle state rows materialise organically as fires
// happen against specific vehicles.
func (e *RuleEngine) LoadCooldownFromDB(ctx context.Context, rules []*models.AlertRule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, rule := range rules {
		vids := vehicleIDsForState(rule)
		for _, vid := range vids {
			key := ruleKey{RuleID: rule.ID, VehicleID: vid}
			if _, ok := e.state[key]; !ok {
				e.state[key] = &ruleState{}
			}
		}
	}
}

// vehicleIDsForState returns the set of vehicle IDs to seed in the rule
// state map. Sticky-all rules use the fleet-baseline key (vehicleID=0);
// explicit-subset rules use each junction entry. Phase-49 / Slice 0005.
func vehicleIDsForState(rule *models.AlertRule) []int64 {
	if rule == nil {
		return nil
	}
	if rule.AllVehicles || len(rule.VehicleIDs) == 0 {
		return []int64{0}
	}
	out := make([]int64, len(rule.VehicleIDs))
	copy(out, rule.VehicleIDs)
	return out
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
