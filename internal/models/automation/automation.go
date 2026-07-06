package automation

import (
	"encoding/json"
	"time"
)

// AutomationHistory records the result of a single automation execution.
type AutomationHistory struct {
	ID                 int64           `json:"id" db:"id"`
	AutomationID       int64           `json:"automation_id" db:"automation_id"`
	AutomationName     string          `json:"automation_name" db:"automation_name"`
	VehicleID          *int64          `json:"vehicle_id" db:"vehicle_id"`
	TriggeredAt        time.Time       `json:"triggered_at" db:"triggered_at"`
	CompletedAt        *time.Time      `json:"completed_at" db:"completed_at"`
	DurationMs         *int            `json:"duration_ms" db:"duration_ms"`
	TriggerType        string          `json:"trigger_type" db:"trigger_type"`
	TriggerSnapshot    json.RawMessage `json:"trigger_snapshot" db:"trigger_snapshot"`
	ConditionsMet      bool            `json:"conditions_met" db:"conditions_met"`
	ConditionsSnapshot json.RawMessage `json:"conditions_snapshot" db:"conditions_snapshot"`
	ActionsExecuted    json.RawMessage `json:"actions_executed" db:"actions_executed"`
	ActionsTotal       int             `json:"actions_total" db:"actions_total"`
	ActionsSucceeded   int             `json:"actions_succeeded" db:"actions_succeeded"`
	ActionsFailed      int             `json:"actions_failed" db:"actions_failed"`
	Status             string          `json:"status" db:"status"`
	Error              *string         `json:"error" db:"error"`
	FSMState           *string         `json:"fsm_state" db:"fsm_state"`
	CreatedAt          time.Time       `json:"created_at" db:"created_at"`
}

// HistoryStatus enumerates the valid `status` values for an AutomationHistory
// row. It is the single source of truth for the execution-status vocabulary
// shared by the engine (which writes these values), the history repository's
// aggregate SQL filters, and the frontend `AutomationHistoryStatus` union.
//
// The AutomationHistory.Status field is kept as a plain string for storage/scan
// compatibility; use StatusValue to obtain a typed view.
type HistoryStatus string

const (
	// HistoryStatusRunning marks an execution whose actions are still in flight.
	// It is the only non-terminal status.
	HistoryStatusRunning HistoryStatus = "running"
	// HistoryStatusSuccess marks an execution where every action succeeded.
	HistoryStatusSuccess HistoryStatus = "success"
	// HistoryStatusPartial marks an execution where at least one — but not all —
	// action failed.
	HistoryStatusPartial HistoryStatus = "partial"
	// HistoryStatusFailed marks an execution where no action succeeded.
	HistoryStatusFailed HistoryStatus = "failed"
	// HistoryStatusSkipped marks an execution abandoned before running actions
	// (for example, because conditions were not met).
	HistoryStatusSkipped HistoryStatus = "skipped"
	// HistoryStatusCancelled marks an execution cancelled before completion.
	HistoryStatusCancelled HistoryStatus = "cancelled"
	// HistoryStatusTest marks a dry-run that executed no real commands.
	HistoryStatusTest HistoryStatus = "test"
	// HistoryStatusUndo marks a reversal of a prior execution.
	HistoryStatusUndo HistoryStatus = "undo"
)

// AllHistoryStatuses returns every known HistoryStatus in a stable order. A
// fresh slice is returned on each call so callers cannot mutate shared state.
func AllHistoryStatuses() []HistoryStatus {
	return []HistoryStatus{
		HistoryStatusRunning, HistoryStatusSuccess, HistoryStatusPartial,
		HistoryStatusFailed, HistoryStatusSkipped, HistoryStatusCancelled,
		HistoryStatusTest, HistoryStatusUndo,
	}
}

// Valid reports whether s is one of the known execution statuses.
func (s HistoryStatus) Valid() bool {
	switch s {
	case HistoryStatusRunning, HistoryStatusSuccess, HistoryStatusPartial,
		HistoryStatusFailed, HistoryStatusSkipped, HistoryStatusCancelled,
		HistoryStatusTest, HistoryStatusUndo:
		return true
	default:
		return false
	}
}

// IsTerminal reports whether s represents a finished execution. Every known
// status except "running" is terminal; unknown/empty values are treated as
// non-terminal so a malformed row never looks "done".
func (s HistoryStatus) IsTerminal() bool {
	return s.Valid() && s != HistoryStatusRunning
}

// StatusValue returns the Status field as a typed HistoryStatus. It is nil-safe
// and returns the empty status for a nil receiver.
func (h *AutomationHistory) StatusValue() HistoryStatus {
	if h == nil {
		return ""
	}
	return HistoryStatus(h.Status)
}

// IsRunning reports whether the execution is still in flight. Nil-safe.
func (h *AutomationHistory) IsRunning() bool {
	return h.StatusValue() == HistoryStatusRunning
}

// IsTerminal reports whether the execution has reached a terminal status.
// Nil-safe: a nil receiver is never terminal.
func (h *AutomationHistory) IsTerminal() bool {
	return h.StatusValue().IsTerminal()
}

// IsComplete reports whether the repository has stamped a completion time on the
// record. This is independent of Status: a "running" row has no CompletedAt,
// while every finalized row does. Nil-safe.
func (h *AutomationHistory) IsComplete() bool {
	return h != nil && h.CompletedAt != nil
}

// IsFleetWide reports whether the execution is not scoped to a specific vehicle
// (VehicleID is nil). Nil-safe.
func (h *AutomationHistory) IsFleetWide() bool {
	return h != nil && h.VehicleID == nil
}

// Duration returns the wall-clock execution time. It prefers the persisted
// DurationMs (authoritative — written by the engine on completion) and falls
// back to CompletedAt - TriggeredAt when DurationMs is absent. Returns 0 when
// neither is available or the computed span is non-positive. Nil-safe.
func (h *AutomationHistory) Duration() time.Duration {
	if h == nil {
		return 0
	}
	if h.DurationMs != nil {
		if *h.DurationMs <= 0 {
			return 0
		}
		return time.Duration(*h.DurationMs) * time.Millisecond
	}
	if h.CompletedAt != nil {
		if d := h.CompletedAt.Sub(h.TriggeredAt); d > 0 {
			return d
		}
	}
	return 0
}

// ActionSuccessRate returns the fraction of executed actions that succeeded, in
// the range [0,1]. It is distinct from the repository's per-automation
// execution success rate: this is a per-record, action-level ratio. It guards
// against division by zero (returns 0 when no actions ran) and clamps the
// numerator into [0, ActionsTotal] so a malformed row can never report a rate
// outside [0,1]. Nil-safe.
func (h *AutomationHistory) ActionSuccessRate() float64 {
	if h == nil || h.ActionsTotal <= 0 {
		return 0
	}
	succeeded := h.ActionsSucceeded
	if succeeded < 0 {
		succeeded = 0
	}
	if succeeded > h.ActionsTotal {
		succeeded = h.ActionsTotal
	}
	return float64(succeeded) / float64(h.ActionsTotal)
}

// AutomationVariable stores cross-automation key-value state.
type AutomationVariable struct {
	ID        int64     `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	VehicleID *int64    `json:"vehicle_id" db:"vehicle_id"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// IsGlobal reports whether the variable applies across the whole fleet rather
// than being scoped to a single vehicle (VehicleID is nil). Nil-safe.
func (v *AutomationVariable) IsGlobal() bool {
	return v != nil && v.VehicleID == nil
}
