// Package command implements the Command Execution FSM.
// Manages wake-then-execute lifecycle for Tesla vehicle commands.
package command

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// State represents the command execution lifecycle.
type State string

const (
	Queued        State = "queued"
	Waking        State = "waking"
	WakeConfirmed State = "wake_confirmed"
	WakeTimeout   State = "wake_timeout"
	Sending       State = "sending"
	Succeeded     State = "succeeded"
	Failed        State = "failed"
	TimedOut      State = "timed_out"
	Retrying      State = "retrying"
	GaveUp        State = "gave_up"
)

const (
	WakeTimeoutDuration = 30 * time.Second
	SendTimeoutDuration = 15 * time.Second
	MaxWakeRetries      = 2
	MaxCmdRetries       = 3
	DedupWindow         = 5 * time.Second
)

// CommandError categorizes failures for retry decisions.
type CommandError struct {
	StatusCode int    `json:"status_code"`
	Message    string `json:"message"`
	Category   string `json:"category"` // "rate_limit", "auth", "vehicle", "network", "timeout"
}

// IsRetryable returns true for transient errors.
func (e *CommandError) IsRetryable() bool {
	switch e.Category {
	case "rate_limit", "network", "timeout":
		return true
	default:
		return e.StatusCode >= 500
	}
}

// ExecutionFSM manages the lifecycle of a single vehicle command.
type ExecutionFSM struct {
	mu              sync.Mutex
	state           State
	commandType     string
	vehicleID       int64
	wakeRetryCount  int
	cmdRetryCount   int
	lastError       *CommandError
	backoffBase     time.Duration
	nextRetryAt     time.Time
	createdAt       time.Time
	completedAt     *time.Time
	wakeSentAt      *time.Time
	wakeConfirmedAt *time.Time
	commandSentAt   *time.Time
	logger          zerolog.Logger
}

// NewExecutionFSM creates a command FSM in Queued state.
func NewExecutionFSM(commandID int64, vehicleID int64, commandType string) *ExecutionFSM {
	return &ExecutionFSM{
		state:       Queued,
		commandType: commandType,
		vehicleID:   vehicleID,
		backoffBase: 2 * time.Second,
		createdAt:   time.Now().UTC(),
		logger: log.With().Str("component", "command_fsm").
			Int64("command_id", commandID).Str("command", commandType).Logger(),
	}
}

// State returns the current state.
func (m *ExecutionFSM) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// IsTerminal returns true if the command reached a final state.
func (m *ExecutionFSM) IsTerminal() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == Succeeded || m.state == GaveUp
}

// MarkVehicleAwake transitions Queued→Sending (vehicle already awake).
func (m *ExecutionFSM) MarkVehicleAwake() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == Queued {
		m.transition(Sending)
		now := time.Now().UTC()
		m.commandSentAt = &now
	}
}

// MarkVehicleAsleep transitions Queued→Waking (need to wake first).
func (m *ExecutionFSM) MarkVehicleAsleep() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == Queued {
		m.transition(Waking)
		now := time.Now().UTC()
		m.wakeSentAt = &now
	}
}

// MarkWakeConfirmed transitions Waking→WakeConfirmed.
func (m *ExecutionFSM) MarkWakeConfirmed() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == Waking {
		m.transition(WakeConfirmed)
		now := time.Now().UTC()
		m.wakeConfirmedAt = &now
	}
}

// MarkWakeTimeout transitions Waking→WakeTimeout.
func (m *ExecutionFSM) MarkWakeTimeout() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Waking {
		return
	}
	m.wakeRetryCount++
	if m.wakeRetryCount > MaxWakeRetries {
		m.transition(GaveUp)
		now := time.Now().UTC()
		m.completedAt = &now
		m.lastError = &CommandError{Message: "wake timeout after max retries", Category: "timeout"}
	} else {
		m.transition(WakeTimeout)
	}
}

// RetryWake transitions WakeTimeout→Waking for another attempt.
func (m *ExecutionFSM) RetryWake() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == WakeTimeout {
		m.transition(Waking)
		now := time.Now().UTC()
		m.wakeSentAt = &now
	}
}

// StartSending transitions WakeConfirmed→Sending (after init delay).
func (m *ExecutionFSM) StartSending() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == WakeConfirmed || m.state == Retrying {
		m.transition(Sending)
		now := time.Now().UTC()
		m.commandSentAt = &now
	}
}

// MarkSucceeded transitions Sending→Succeeded.
func (m *ExecutionFSM) MarkSucceeded() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == Sending {
		m.transition(Succeeded)
		now := time.Now().UTC()
		m.completedAt = &now
	}
}

// MarkFailed transitions Sending→Failed with error details.
func (m *ExecutionFSM) MarkFailed(err *CommandError) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == Sending {
		m.lastError = err
		m.transition(Failed)
	}
}

// MarkTimedOut transitions Sending→TimedOut.
func (m *ExecutionFSM) MarkTimedOut() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == Sending {
		m.lastError = &CommandError{Message: "command timeout", Category: "timeout"}
		m.transition(TimedOut)
	}
}

// ScheduleRetry moves Failed/TimedOut→Retrying with backoff, or GaveUp if max retries.
func (m *ExecutionFSM) ScheduleRetry() bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state != Failed && m.state != TimedOut {
		return false
	}

	if m.lastError != nil && !m.lastError.IsRetryable() {
		m.transition(GaveUp)
		now := time.Now().UTC()
		m.completedAt = &now
		return false
	}

	m.cmdRetryCount++
	if m.cmdRetryCount > MaxCmdRetries {
		m.transition(GaveUp)
		now := time.Now().UTC()
		m.completedAt = &now
		return false
	}

	backoff := m.backoffBase * (1 << (m.cmdRetryCount - 1))
	m.nextRetryAt = time.Now().UTC().Add(backoff)
	m.transition(Retrying)
	return true
}

// IsReadyForRetry returns true if the backoff has expired.
func (m *ExecutionFSM) IsReadyForRetry() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == Retrying && time.Now().UTC().After(m.nextRetryAt)
}

// StatusMessage returns a user-friendly status string for SSE.
func (m *ExecutionFSM) StatusMessage() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch m.state {
	case Queued:
		return "Command queued..."
	case Waking:
		return "Waking vehicle..."
	case WakeConfirmed:
		return "Vehicle awake, sending..."
	case WakeTimeout:
		return "Wake timeout, retrying..."
	case Sending:
		return "Sending command..."
	case Succeeded:
		return "✅ " + m.commandType + " succeeded"
	case Failed:
		msg := "Command failed"
		if m.lastError != nil {
			msg += " — " + m.lastError.Message
		}
		return "⚠️ " + msg + ", retrying..."
	case GaveUp:
		msg := "Command failed"
		if m.lastError != nil {
			msg += " — " + m.lastError.Message
		}
		return "❌ " + msg
	default:
		return ""
	}
}

func (m *ExecutionFSM) transition(to State) {
	from := m.state
	m.state = to
	m.logger.Info().Str("from", string(from)).Str("to", string(to)).Msg("command transition")
}
