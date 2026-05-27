// Package automation implements the Automation Execution FSM.
// Manages the lifecycle of automation runs: trigger evaluation, action
// execution, retries, cooldowns, and auto-disable after repeated failures.
package automation

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// State represents the automation execution lifecycle.
type State string

const (
	Idle       State = "idle"       // Enabled, waiting for trigger
	Evaluating State = "evaluating" // Trigger fired, checking conditions
	Executing  State = "executing"  // Conditions met, running actions
	Succeeded  State = "succeeded"  // All actions completed successfully
	Partial    State = "partial"    // Some actions succeeded, some failed
	Failed     State = "failed"     // Action(s) failed
	Retrying   State = "retrying"   // Retrying failed actions
	GaveUp     State = "gave_up"    // Max retries exceeded
	Skipped    State = "skipped"    // Conditions not met
	Cooldown   State = "cooldown"   // Waiting for cooldown period
	Disabled   State = "disabled"   // Auto-disabled after repeated failures
)

// Transition records a single state change in the execution lifecycle.
type Transition struct {
	From    State     `json:"from"`
	To      State     `json:"to"`
	Trigger string    `json:"trigger"`
	At      time.Time `json:"at"`
}

// TransitionEvent is an immutable snapshot emitted to observers after each
// state transition. Captured while the FSM lock is held but delivered after
// unlock so observers never block the FSM.
type TransitionEvent struct {
	AutomationID        int64     `json:"automation_id"`
	AutomationName      string    `json:"automation_name"`
	VehicleID           int64     `json:"vehicle_id"`
	TriggerType         string    `json:"trigger_type"`
	From                State     `json:"from"`
	To                  State     `json:"to"`
	Trigger             string    `json:"trigger"`
	At                  time.Time `json:"at"`
	RetryCount          int       `json:"retry_count"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
}

// TransitionObserver is called after each FSM state transition with an
// immutable snapshot. Implementations MUST NOT block.
type TransitionObserver func(TransitionEvent)

// ExecutionFSM manages the lifecycle of a single automation execution.
type ExecutionFSM struct {
	mu                  sync.Mutex
	state               State
	automationID        int64
	automationName      string
	vehicleID           int64
	triggerType         string
	retryCount          int
	maxRetries          int
	consecutiveFailures int
	disableThreshold    int
	cooldownDuration    time.Duration
	cooldownExpiresAt   time.Time
	startedAt           time.Time
	transitions         []Transition
	observer            TransitionObserver
	logger              zerolog.Logger
}

// NewExecutionFSM creates an automation FSM in Idle state.
func NewExecutionFSM(automationID, vehicleID int64, name, triggerType string,
	maxRetries, disableThreshold int, cooldownDuration time.Duration) *ExecutionFSM {

	return &ExecutionFSM{
		state:            Idle,
		automationID:     automationID,
		automationName:   name,
		vehicleID:        vehicleID,
		triggerType:      triggerType,
		maxRetries:       maxRetries,
		disableThreshold: disableThreshold,
		cooldownDuration: cooldownDuration,
		startedAt:        time.Now().UTC(),
		logger: log.With().
			Str("component", "automation_fsm").
			Int64("automation_id", automationID).
			Str("automation", name).
			Logger(),
	}
}

// SetObserver registers a callback invoked after every state transition.
// The callback receives an immutable snapshot and MUST NOT block.
// Only one observer is supported; subsequent calls replace the previous one.
func (m *ExecutionFSM) SetObserver(obs TransitionObserver) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.observer = obs
}

// State returns the current state.
func (m *ExecutionFSM) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// IsRunComplete returns true if the current execution run has finished
// and no further automatic transitions will occur.
func (m *ExecutionFSM) IsRunComplete() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch m.state {
	case Idle, Succeeded, GaveUp, Skipped, Disabled:
		return true
	default:
		return false
	}
}

// Transitions returns a copy of the transition log for this execution.
func (m *ExecutionFSM) Transitions() []Transition {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]Transition, len(m.transitions))
	copy(result, m.transitions)
	return result
}

// RetryCount returns the number of retries attempted in the current run.
func (m *ExecutionFSM) RetryCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.retryCount
}

// ConsecutiveFailures returns the number of consecutive failed runs.
func (m *ExecutionFSM) ConsecutiveFailures() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.consecutiveFailures
}

// ContextSnapshot returns metadata for transition logging/persistence.
func (m *ExecutionFSM) ContextSnapshot() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return map[string]interface{}{
		"automation_id":   m.automationID,
		"automation_name": m.automationName,
		"trigger_type":    m.triggerType,
		"retry_count":     m.retryCount,
	}
}

// FireTrigger transitions Idle → Evaluating when the automation trigger fires.
// Resets per-run counters for a fresh execution cycle.
func (m *ExecutionFSM) FireTrigger() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Idle {
		return
	}
	m.retryCount = 0
	m.startedAt = time.Now().UTC()
	m.transition(Evaluating, "trigger_fired")
}

// ConditionsMet transitions Evaluating → Executing when all conditions pass.
func (m *ExecutionFSM) ConditionsMet() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Evaluating {
		return
	}
	m.transition(Executing, "conditions_met")
}

// ConditionsNotMet transitions Evaluating → Skipped when conditions are not satisfied.
func (m *ExecutionFSM) ConditionsNotMet() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Evaluating {
		return
	}
	m.transition(Skipped, "conditions_not_met")
}

// MarkSucceeded transitions Executing → Succeeded when all actions complete.
// Resets the consecutive failure counter.
func (m *ExecutionFSM) MarkSucceeded() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Executing {
		return
	}
	m.consecutiveFailures = 0
	m.transition(Succeeded, "all_actions_ok")
}

// MarkPartial transitions Executing → Partial when some actions failed
// (stop_on_failure=false). Resets the consecutive failure counter since
// the run partially succeeded.
func (m *ExecutionFSM) MarkPartial() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Executing {
		return
	}
	m.consecutiveFailures = 0
	m.transition(Partial, "partial_failure")
}

// MarkFailed transitions Executing → Failed when an action fails
// (stop_on_failure=true).
func (m *ExecutionFSM) MarkFailed() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Executing {
		return
	}
	m.transition(Failed, "action_failed")
}

// ScheduleRetry attempts to retry failed actions.
// Returns true if a retry was scheduled (Failed → Retrying).
// Returns false and transitions to GaveUp if max retries exceeded.
// After GaveUp, increments consecutiveFailures and auto-transitions to
// Disabled if the threshold is met, or stays in GaveUp otherwise.
func (m *ExecutionFSM) ScheduleRetry() bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state != Failed {
		return false
	}

	m.retryCount++
	if m.retryCount > m.maxRetries {
		m.transition(GaveUp, "max_retries_exceeded")
		m.consecutiveFailures++
		if m.disableThreshold > 0 && m.consecutiveFailures >= m.disableThreshold {
			m.transition(Disabled, "consecutive_failures_exceeded")
		}
		return false
	}

	m.transition(Retrying, "retry_scheduled")
	return true
}

// RetryNow transitions Retrying → Executing to begin the retry attempt.
func (m *ExecutionFSM) RetryNow() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Retrying {
		return
	}
	m.transition(Executing, "retry_attempt")
}

// ResetFromSuccess transitions Succeeded or Partial to Cooldown (if cooldown > 0)
// or directly to Idle.
func (m *ExecutionFSM) ResetFromSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Succeeded && m.state != Partial {
		return
	}
	if m.cooldownDuration > 0 {
		m.cooldownExpiresAt = time.Now().UTC().Add(m.cooldownDuration)
		m.transition(Cooldown, "cooldown_started")
		return
	}
	m.transition(Idle, "reset")
}

// CooldownExpired transitions Cooldown → Idle after the cooldown period.
func (m *ExecutionFSM) CooldownExpired() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Cooldown {
		return
	}
	m.transition(Idle, "cooldown_expired")
}

// IsCooldownExpired returns true if in Cooldown state and the cooldown period has elapsed.
func (m *ExecutionFSM) IsCooldownExpired() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == Cooldown && time.Now().UTC().After(m.cooldownExpiresAt)
}

// ResetFromGaveUp transitions GaveUp → Idle, ready for the next trigger.
// Only valid when the consecutive failure threshold has not been exceeded
// (i.e., ScheduleRetry did not auto-transition to Disabled).
func (m *ExecutionFSM) ResetFromGaveUp() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != GaveUp {
		return
	}
	m.transition(Idle, "reset_after_gave_up")
}

// ResetFromSkipped transitions Skipped → Idle, ready for the next trigger.
func (m *ExecutionFSM) ResetFromSkipped() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Skipped {
		return
	}
	m.transition(Idle, "reset_after_skip")
}

// ReEnable transitions Disabled → Idle when manually re-enabled.
func (m *ExecutionFSM) ReEnable() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Disabled {
		return
	}
	m.consecutiveFailures = 0
	m.transition(Idle, "manually_re_enabled")
}

func (m *ExecutionFSM) transition(to State, trigger string) {
	from := m.state
	now := time.Now().UTC()

	m.transitions = append(m.transitions, Transition{
		From:    from,
		To:      to,
		Trigger: trigger,
		At:      now,
	})

	m.state = to

	m.logger.Info().
		Str("from", string(from)).
		Str("to", string(to)).
		Str("trigger", trigger).
		Int("retry_count", m.retryCount).
		Int("consecutive_failures", m.consecutiveFailures).
		Msg("automation transition")

	if m.observer != nil {
		m.observer(TransitionEvent{
			AutomationID:        m.automationID,
			AutomationName:      m.automationName,
			VehicleID:           m.vehicleID,
			TriggerType:         m.triggerType,
			From:                from,
			To:                  to,
			Trigger:             trigger,
			At:                  now,
			RetryCount:          m.retryCount,
			ConsecutiveFailures: m.consecutiveFailures,
		})
	}
}
