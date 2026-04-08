// Package api provides the CEP (Complex Event Processing) rule engine
// for evaluating alert conditions against real-time telemetry signals.
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

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// RuleEngine evaluates CEP rules against incoming telemetry signals.
// It tracks per-rule state (cooldowns, previous signals, temporal windows)
// and dispatches alerts when conditions are met.
type RuleEngine struct {
	mu    sync.RWMutex
	state map[ruleKey]*ruleState // per (ruleID, vehicleID) state
}

type ruleKey struct {
	RuleID    int64
	VehicleID int64
}

type ruleState struct {
	PrevSignals       map[string]interface{} // previous signal values (for changed_to/from)
	ConditionTrueSince *time.Time            // when the condition first became true (for temporal)
	LastFiredAt       *time.Time             // cooldown tracking
}

// NewRuleEngine creates a new CEP rule engine.
func NewRuleEngine() *RuleEngine {
	return &RuleEngine{
		state: make(map[ruleKey]*ruleState),
	}
}

// EvalResult holds the outcome of evaluating a rule.
type EvalResult struct {
	Triggered bool
	Message   string
}

// Evaluate checks a single rule against the current signal batch.
// Returns whether the rule triggered and the rendered message.
func (e *RuleEngine) Evaluate(rule *models.AlertRule, vehicleID int64, signals map[string]interface{}) EvalResult {
	// === COOLDOWN CHECK ===
	key := ruleKey{RuleID: rule.ID, VehicleID: vehicleID}
	e.mu.RLock()
	st, hasState := e.state[key]
	e.mu.RUnlock()

	if hasState && st.LastFiredAt != nil {
		cooldown := time.Duration(rule.CooldownMin) * time.Minute
		if cooldown <= 0 {
			cooldown = 15 * time.Minute
		}
		if time.Since(*st.LastFiredAt) < cooldown {
			metrics.CEPRulesCooldownSkipped.Inc()
			return EvalResult{} // still in cooldown
		}
	}

	// Parse conditions
	var cond models.RuleCondition
	if err := json.Unmarshal(rule.Conditions, &cond); err != nil {
		log.Warn().Err(err).Int64("rule_id", rule.ID).Msg("cep: failed to parse rule conditions")
		return EvalResult{}
	}

	// Get previous signals for this rule+vehicle
	var prevSignals map[string]interface{}
	if hasState && st.PrevSignals != nil {
		prevSignals = st.PrevSignals
	}

	// === EVALUATE CONDITION TREE ===
	matched := evalNode(&cond, signals, prevSignals)

	// === TEMPORAL CHECK (FOR duration) ===
	if matched && cond.ForSeconds != nil && *cond.ForSeconds > 0 {
		e.mu.Lock()
		if st == nil {
			st = &ruleState{}
			e.state[key] = st
		}
		if st.ConditionTrueSince == nil {
			now := time.Now().UTC()
			st.ConditionTrueSince = &now
			e.mu.Unlock()
			// Not sustained long enough yet
			e.updatePrevSignals(key, signals)
			return EvalResult{}
		}
		elapsed := time.Since(*st.ConditionTrueSince)
		required := time.Duration(*cond.ForSeconds) * time.Second
		if elapsed < required {
			e.mu.Unlock()
			e.updatePrevSignals(key, signals)
			return EvalResult{} // not sustained long enough
		}
		// Reset temporal tracker after firing
		st.ConditionTrueSince = nil
		e.mu.Unlock()
	} else if !matched {
		// Condition is false — reset temporal tracker
		e.mu.Lock()
		if st != nil {
			st.ConditionTrueSince = nil
		}
		e.mu.Unlock()
	}

	// === UPDATE STATE ===
	e.updatePrevSignals(key, signals)

	if !matched {
		return EvalResult{}
	}

	// === FIRE ===
	now := time.Now().UTC()
	e.mu.Lock()
	if st == nil {
		st = &ruleState{}
		e.state[key] = st
	}
	st.LastFiredAt = &now
	st.ConditionTrueSince = nil // reset after firing
	e.mu.Unlock()

	// Render message template
	message := renderTemplate(rule.MsgTemplate, signals)
	if message == "" {
		message = rule.Name
	}

	return EvalResult{
		Triggered: true,
		Message:   message,
	}
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
	if st.PrevSignals == nil {
		st.PrevSignals = make(map[string]interface{}, len(signals))
	}
	for k, v := range signals {
		if v != nil {
			st.PrevSignals[k] = v
		}
	}
}

// SetLastFired updates the cooldown state (called after external dedup check, e.g. Redis).
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
func (e *RuleEngine) LoadCooldownFromDB(ctx context.Context, rules []*models.AlertRule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, rule := range rules {
		if rule.LastFiredAt != nil {
			// Apply to all vehicles (vehicleID 0 = wildcard)
			vid := int64(0)
			if rule.VehicleID != nil {
				vid = *rule.VehicleID
			}
			key := ruleKey{RuleID: rule.ID, VehicleID: vid}
			st, ok := e.state[key]
			if !ok {
				st = &ruleState{}
				e.state[key] = st
			}
			st.LastFiredAt = rule.LastFiredAt
		}
	}
}

// ──────────────────────────────────────────────────────────────────────
// Condition tree evaluation
// ──────────────────────────────────────────────────────────────────────

func evalNode(node *models.RuleCondition, signals, prevSignals map[string]interface{}) bool {
	// Branch node (combinator)
	if node.Op != "" && len(node.Rules) > 0 {
		switch strings.ToUpper(node.Op) {
		case "AND":
			for _, child := range node.Rules {
				if !evalNode(&child, signals, prevSignals) {
					return false
				}
			}
			return true
		case "OR":
			for _, child := range node.Rules {
				if evalNode(&child, signals, prevSignals) {
					return true
				}
			}
			return false
		case "NOT":
			if len(node.Rules) > 0 {
				return !evalNode(&node.Rules[0], signals, prevSignals)
			}
			return false
		}
	}

	// Leaf node (signal comparison)
	if node.Signal == "" || node.Compare == "" {
		return false
	}

	current, hasCurrent := signals[node.Signal]
	if !hasCurrent {
		// Signal not in this batch — check if it's a transition operator
		if node.Compare == "changed_to" || node.Compare == "changed_from" {
			return false // can't detect change without current value
		}
		return false
	}

	switch node.Compare {
	case "==":
		return compareEq(current, node.Value)
	case "!=":
		return !compareEq(current, node.Value)
	case ">":
		return compareNum(current, node.Value) > 0
	case "<":
		return compareNum(current, node.Value) < 0
	case ">=":
		return compareNum(current, node.Value) >= 0
	case "<=":
		return compareNum(current, node.Value) <= 0
	case "contains":
		return strings.Contains(toString(current), toString(node.Value))
	case "is_true":
		return toBool(current)
	case "is_false":
		return !toBool(current)
	case "changed_to":
		prev, hasPrev := prevSignals[node.Signal]
		if !hasPrev {
			// First time seeing this signal — treat as change if value matches
			return compareEq(current, node.Value)
		}
		return !compareEq(prev, node.Value) && compareEq(current, node.Value)
	case "changed_from":
		prev, hasPrev := prevSignals[node.Signal]
		if !hasPrev {
			return false
		}
		return compareEq(prev, node.Value) && !compareEq(current, node.Value)
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

var templateRe = regexp.MustCompile(`\{\{(\w+)\}\}`)

func renderTemplate(tmpl string, signals map[string]interface{}) string {
	if tmpl == "" {
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
