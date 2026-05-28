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

// AutomationVariable stores cross-automation key-value state.
type AutomationVariable struct {
	ID        int64     `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	VehicleID *int64    `json:"vehicle_id" db:"vehicle_id"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}
