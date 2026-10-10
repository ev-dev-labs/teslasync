package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestAutomationRuntimeDispatchesTypedTriggerConditionAndAction(t *testing.T) {
	vehicleID := int64(42)
	threshold := 50.0
	automation := &models.AutomationFull{
		Automation: models.Automation{
			ID:        7,
			Name:      "Typed runtime",
			Enabled:   true,
			VehicleID: &vehicleID,
		},
		Steps: []models.AutomationStep{
			{ID: 71, AutomationID: 7, StepOrder: 1, Kind: models.AutomationStepKindTriggerSchedule},
			{ID: 72, AutomationID: 7, StepOrder: 2, Kind: models.AutomationStepKindConditionSignal},
			{ID: 73, AutomationID: 7, StepOrder: 3, Kind: models.AutomationStepKindActionCommand},
		},
		Triggers: []any{
			&models.AutomationStepTriggerSchedule{StepID: 71, CronExpr: "0 8 * * *", Timezone: "UTC"},
		},
		Conditions: []any{
			&models.AutomationStepConditionSignal{
				StepID:   72,
				Signal:   "battery_level",
				Op:       ">",
				ValueNum: &threshold,
			},
		},
		Actions: []any{
			&models.AutomationAction{StepID: 73, CommandName: "lock", CommandParams: json.RawMessage(`{}`)},
		},
	}

	executor := &typedActionRecorder{}
	chain := action.NewChainExecutor(nil)
	chain.Register("command", executor)

	history := &runtimeHistoryStore{}
	engine := NewEngine(
		&runtimeAutomationStore{automation: automation},
		history,
		chain,
		WithStateProvider(runtimeStateProvider{state: &vehiclemodel.VehicleState{VehicleID: vehicleID, BatteryLevel: 75}}),
	)

	if err := engine.Evaluate(context.Background(), automation.ID, json.RawMessage(`{"kind":"trigger_schedule"}`)); err != nil {
		t.Fatalf("Evaluate() unexpected error: %v", err)
	}
	if !executor.typedCalled {
		t.Fatalf("typed action executor was not called")
	}
	if executor.rawCalled {
		t.Fatalf("legacy raw action executor was called")
	}
	if history.created == nil || history.created.TriggerType != models.AutomationStepKindTriggerSchedule {
		t.Fatalf("history trigger = %#v", history.created)
	}
}

func TestAutomationRuntimeRejectsLegacyTriggerPayloadBridge(t *testing.T) {
	automation := &models.AutomationFull{
		Automation: models.Automation{ID: 8, Name: "Legacy bridge", Enabled: true},
		Steps: []models.AutomationStep{
			{ID: 81, AutomationID: 8, StepOrder: 1, Kind: models.AutomationStepKindTriggerSchedule},
			{ID: 82, AutomationID: 8, StepOrder: 2, Kind: models.AutomationStepKindActionCommand},
		},
		Triggers: []any{
			json.RawMessage(`{"kind":"trigger_schedule","cron_expr":"0 8 * * *"}`),
		},
		Actions: []any{
			&models.AutomationAction{StepID: 82, CommandName: "lock", CommandParams: json.RawMessage(`{}`)},
		},
	}

	chain := action.NewChainExecutor(nil)
	chain.Register("command", &typedActionRecorder{})
	engine := NewEngine(&runtimeAutomationStore{automation: automation}, &runtimeHistoryStore{}, chain)

	if err := engine.Evaluate(context.Background(), automation.ID, json.RawMessage(`{"kind":"trigger_schedule"}`)); err == nil {
		t.Fatalf("Evaluate() succeeded with legacy trigger payload")
	}
}

type runtimeAutomationStore struct {
	automation *models.AutomationFull
}

func TestAutomationRuntimeWeekdayGateSkipsActions(t *testing.T) {
	now := time.Now().UTC()
	clock := time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC)
	automation := &models.AutomationFull{
		Automation: models.Automation{ID: 9, Name: "Weekday gate", Enabled: true},
		Steps: []models.AutomationStep{
			{ID: 91, AutomationID: 9, StepOrder: 1, Kind: models.AutomationStepKindTriggerGeofence},
			{ID: 92, AutomationID: 9, StepOrder: 2, Kind: models.AutomationStepKindConditionTimeWindow},
			{ID: 93, AutomationID: 9, StepOrder: 3, Kind: models.AutomationStepKindActionCommand},
		},
		Triggers: []any{&models.AutomationStepTriggerGeofence{StepID: 91, PlaceID: 1, Event: "enter"}},
		Conditions: []any{&models.AutomationStepConditionTimeWindow{
			StepID: 92, StartTime: clock, EndTime: clock,
			DaysOfWeek: []int16{int16((int(now.Weekday()) + 3) % 7)},
		}},
		Actions: []any{&models.AutomationAction{StepID: 93, CommandName: "lock"}},
	}
	executor := &typedActionRecorder{}
	chain := action.NewChainExecutor(nil)
	chain.Register("command", executor)
	history := &runtimeHistoryStore{}
	engine := NewEngine(&runtimeAutomationStore{automation: automation}, history, chain)
	if err := engine.Evaluate(context.Background(), automation.ID, json.RawMessage(`{"kind":"trigger_geofence"}`)); err != nil {
		t.Fatal(err)
	}
	if executor.typedCalled || executor.rawCalled {
		t.Fatal("wrong weekday executed an action")
	}
	if history.created == nil || history.created.Status != "skipped" {
		t.Fatalf("history = %#v, want skipped", history.created)
	}
}

func TestAutomationTypedWeekdayCondition(t *testing.T) {
	clock := time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC)
	engine := &Engine{}
	now := time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name, timezone, want string
		days                 []int16
	}{
		{"UTC Tuesday allowed", "", "met", []int16{1, 2}},
		{"UTC Tuesday rejected", "", "not_met", []int16{1}},
		{"local Monday allowed", "America/Los_Angeles", "met", []int16{1}},
		{"local Tuesday rejected", "America/Los_Angeles", "not_met", []int16{2}},
		{"unrestricted", "", "met", nil},
		{"invalid timezone", "Mars/Olympus", "unknown", nil},
		{"invalid day", "", "unknown", []int16{7}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c := models.AutomationStepConditionTimeWindow{
				StartTime: clock, EndTime: clock, Timezone: tt.timezone, DaysOfWeek: tt.days,
			}
			for _, payload := range []any{c, &c} {
				result := engine.evaluateTypedCondition(0, payload, &models.AutomationFull{}, now)
				if result.Result != tt.want {
					t.Fatalf("payload %T: result = %#v, want %s", payload, result, tt.want)
				}
			}
		})
	}
}

func (s *runtimeAutomationStore) GetByID(_ context.Context, id int64) (*models.AutomationFull, error) {
	if s.automation == nil || s.automation.ID != id {
		return nil, nil
	}
	return s.automation, nil
}

func (s *runtimeAutomationStore) IncrementExecution(context.Context, int64, bool) error {
	return nil
}

type runtimeHistoryStore struct {
	created *automationmodel.AutomationHistory
}

func (s *runtimeHistoryStore) Create(_ context.Context, h *automationmodel.AutomationHistory) error {
	copy := *h
	copy.ID = 99
	s.created = &copy
	h.ID = copy.ID
	return nil
}

func (s *runtimeHistoryStore) Complete(context.Context, int64, string, *string, int) error {
	return nil
}

func (s *runtimeHistoryStore) CountSinceByAutomation(context.Context, int64, time.Time) (int, error) {
	return 0, nil
}

type runtimeStateProvider struct {
	state *vehiclemodel.VehicleState
}

func (p runtimeStateProvider) GetVehicleState(context.Context, int64) (*vehiclemodel.VehicleState, error) {
	return p.state, nil
}

type typedActionRecorder struct {
	typedCalled bool
	rawCalled   bool
}

func (r *typedActionRecorder) Execute(context.Context, *int64, json.RawMessage) (json.RawMessage, error) {
	r.rawCalled = true
	return nil, fmt.Errorf("legacy raw executor should not be used")
}

func (r *typedActionRecorder) ExecuteTyped(_ context.Context, _ *int64, payload any) (json.RawMessage, error) {
	if _, ok := payload.(*models.AutomationAction); !ok {
		return nil, fmt.Errorf("payload type = %T, want *models.AutomationAction", payload)
	}
	r.typedCalled = true
	return json.RawMessage(`{"ok":true}`), nil
}
