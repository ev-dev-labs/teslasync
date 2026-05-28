package api

import (
	"encoding/json"
	"time"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"

	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// automationResponse wraps an Automation with computed fields.
type automationResponse struct {
	*models.Automation
	NextFireTime *string              `json:"next_fire_time,omitempty"`
	Conflicts    []condition.Conflict `json:"conflicts,omitempty"`
}

// presetsResponse is the envelope for the presets API.
type presetsResponse struct {
	Categories []presets.Category `json:"categories"`
	Presets    []presets.Preset   `json:"presets"`
}

// automationInputWire is the strict create/update JSON shape. Step payloads are
// decoded separately by kind so each lane can reject fields from legacy action
// blobs and frontend-only aliases.
type automationInputWire struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	VehicleID   *int64            `json:"vehicle_id"`
	Enabled     *bool             `json:"enabled"`
	Triggers    []json.RawMessage `json:"triggers"`
	Conditions  []json.RawMessage `json:"conditions"`
	Actions     []json.RawMessage `json:"actions"`
}

// createAutomationRequest is the normalized request body for creating or
// updating an automation.
type createAutomationRequest struct {
	Name        string
	Description string
	VehicleID   *int64
	Enabled     *bool
	Triggers    []automationTypedStep
	Conditions  []automationTypedStep
	Actions     []automationTypedStep
}

type automationTypedStep struct {
	Kind      string
	StepOrder *int
	Payload   interface{}
}

type automationTriggerSignalDTO struct {
	Kind      string   `json:"kind"`
	StepOrder *int     `json:"step_order,omitempty"`
	Signal    string   `json:"signal"`
	Op        string   `json:"op"`
	ValueText *string  `json:"value_text,omitempty"`
	ValueNum  *float64 `json:"value_num,omitempty"`
	ValueBool *bool    `json:"value_bool,omitempty"`
}

type automationTriggerGeofenceDTO struct {
	Kind         string `json:"kind"`
	StepOrder    *int   `json:"step_order,omitempty"`
	PlaceID      int64  `json:"place_id"`
	Event        string `json:"event"`
	DwellMinutes *int   `json:"dwell_minutes,omitempty"`
}

type automationTriggerScheduleDTO struct {
	Kind      string `json:"kind"`
	StepOrder *int   `json:"step_order,omitempty"`
	CronExpr  string `json:"cron_expr"`
	Timezone  string `json:"timezone,omitempty"`
}

type automationTriggerEventDTO struct {
	Kind      string `json:"kind"`
	StepOrder *int   `json:"step_order,omitempty"`
	EventType string `json:"event_type"`
}

type automationConditionSignalDTO struct {
	Kind      string   `json:"kind"`
	StepOrder *int     `json:"step_order,omitempty"`
	Signal    string   `json:"signal"`
	Op        string   `json:"op"`
	ValueText *string  `json:"value_text,omitempty"`
	ValueNum  *float64 `json:"value_num,omitempty"`
	ValueBool *bool    `json:"value_bool,omitempty"`
	ValueMin  *float64 `json:"value_min,omitempty"`
	ValueMax  *float64 `json:"value_max,omitempty"`
}

type automationConditionTimeWindowDTO struct {
	Kind       string `json:"kind"`
	StepOrder  *int   `json:"step_order,omitempty"`
	StartTime  string `json:"start_time"`
	EndTime    string `json:"end_time"`
	Timezone   string `json:"timezone,omitempty"`
	DaysOfWeek []int  `json:"days_of_week,omitempty"`
}

type automationConditionGeofenceDTO struct {
	Kind      string `json:"kind"`
	StepOrder *int   `json:"step_order,omitempty"`
	PlaceID   int64  `json:"place_id"`
	State     string `json:"state"`
}

type automationConditionOtherAutomationDTO struct {
	Kind              string `json:"kind"`
	StepOrder         *int   `json:"step_order,omitempty"`
	OtherAutomationID int64  `json:"other_automation_id"`
	State             string `json:"state"`
}

type automationActionCommandDTO struct {
	Kind          string          `json:"kind"`
	StepOrder     *int            `json:"step_order,omitempty"`
	CommandName   string          `json:"command_name"`
	CommandParams json.RawMessage `json:"command_params,omitempty"`
}

type automationActionNotifyDTO struct {
	Kind      string `json:"kind"`
	StepOrder *int   `json:"step_order,omitempty"`
	ChannelID int64  `json:"channel_id"`
	Template  string `json:"template"`
}

type automationActionSetSettingDTO struct {
	Kind       string   `json:"kind"`
	StepOrder  *int     `json:"step_order,omitempty"`
	SettingKey string   `json:"setting_key"`
	ValueText  *string  `json:"value_text,omitempty"`
	ValueNum   *float64 `json:"value_num,omitempty"`
	ValueBool  *bool    `json:"value_bool,omitempty"`
}

type automationActionCallAutomationDTO struct {
	Kind               string `json:"kind"`
	StepOrder          *int   `json:"step_order,omitempty"`
	TargetAutomationID int64  `json:"target_automation_id"`
}

// historyListResponse wraps paginated history items with summary statistics.
type historyListResponse struct {
	Items   []*automationmodel.AutomationHistory `json:"items"`
	Total   int                                  `json:"total"`
	Limit   int                                  `json:"limit"`
	Offset  int                                  `json:"offset"`
	Summary *database.HistoryStats               `json:"summary"`
}

// historyDetailResponse wraps a single execution record with FSM transitions.
type historyDetailResponse struct {
	*automationmodel.AutomationHistory
	SuccessRate    float64                        `json:"success_rate"`
	FSMTransitions []database.FSMTransitionRecord `json:"fsm_transitions"`
}

// testRunResponse is the top-level response for a dry-run test.
type testRunResponse struct {
	AutomationID   int64                 `json:"automation_id"`
	AutomationName string                `json:"automation_name"`
	VehicleID      *int64                `json:"vehicle_id"`
	TriggerType    string                `json:"trigger_type"`
	Status         string                `json:"status"` // always "test"
	ConditionsMet  bool                  `json:"conditions_met"`
	Conditions     []testConditionResult `json:"conditions"`
	Actions        []testActionResult    `json:"actions"`
	ExecutionPlan  testExecutionPlan     `json:"execution_plan"`
	HistoryID      int64                 `json:"history_id"`
	Timestamp      time.Time             `json:"timestamp"`
}

// testConditionResult captures the evaluation of a single condition during dry-run.
type testConditionResult struct {
	Index    int             `json:"index"`
	Type     string          `json:"type"`
	Result   string          `json:"result"` // "met", "not_met", "unknown"
	Reason   string          `json:"reason"`
	Snapshot json.RawMessage `json:"snapshot,omitempty"`
}

// testActionResult captures the simulated outcome of a single action.
type testActionResult struct {
	Index      int             `json:"index"`
	ActionType string          `json:"action_type"`
	Config     json.RawMessage `json:"action_config"`
	Valid      bool            `json:"valid"`
	Error      string          `json:"error,omitempty"`
	Simulated  bool            `json:"simulated"`
	WouldSkip  bool            `json:"would_skip,omitempty"`
	SkipReason string          `json:"skip_reason,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
}

// testExecutionPlan summarises what the automation would do.
type testExecutionPlan struct {
	TotalActions         int  `json:"total_actions"`
	ValidActions         int  `json:"valid_actions"`
	StopOnFailure        bool `json:"stop_on_failure"`
	ConditionsCount      int  `json:"conditions_count"`
	AllConditionsMet     bool `json:"all_conditions_met"`
	HasUnknownConditions bool `json:"has_unknown_conditions"`
}

// undoResponse is the top-level response for the undo endpoint.
type undoResponse struct {
	AutomationID      int64              `json:"automation_id"`
	AutomationName    string             `json:"automation_name"`
	OriginalHistoryID int64              `json:"original_history_id"`
	UndoHistoryID     int64              `json:"undo_history_id"`
	Actions           []undoActionResult `json:"actions"`
	Reversed          int                `json:"reversed"`
	Skipped           int                `json:"skipped"`
	Failed            int                `json:"failed"`
	Status            string             `json:"status"`
	Timestamp         time.Time          `json:"timestamp"`
}

// undoActionResult captures the outcome of reversing a single command.
type undoActionResult struct {
	OriginalCommand string `json:"original_command"`
	ReverseCommand  string `json:"reverse_command,omitempty"`
	Status          string `json:"status"` // "reversed", "skipped", "failed", "irreversible"
	Error           string `json:"error,omitempty"`
	DurationMs      int64  `json:"duration_ms,omitempty"`
}

// automationExportEnvelope is the top-level JSON document for import/export.
type automationExportEnvelope struct {
	Version     int                  `json:"version"`
	ExportedAt  string               `json:"exported_at"`
	Automations []automationPortable `json:"automations"`
}

// automationPortable is a shareable automation definition stripped of
// instance-specific state (IDs, counters, timestamps, secrets).
type automationPortable struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	VehicleID   *int64            `json:"vehicle_id,omitempty"`
	Enabled     *bool             `json:"enabled,omitempty"`
	Triggers    []json.RawMessage `json:"triggers"`
	Conditions  []json.RawMessage `json:"conditions"`
	Actions     []json.RawMessage `json:"actions"`
}

// importedAutomation describes a successfully imported automation.
type importedAutomation struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	WebhookToken string `json:"webhook_token,omitempty"`
}

// importError describes a single import failure within a batch.
type importError struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
	Error string `json:"error"`
}

// importResult is the response body for the import endpoint.
type importResult struct {
	Imported []importedAutomation `json:"imported"`
	Errors   []importError        `json:"errors,omitempty"`
}
