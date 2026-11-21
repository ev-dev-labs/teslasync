package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
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

	t.Run("CanonicalWaitConfigConstruction", func(t *testing.T) {
		for _, payload := range []any{
			models.AutomationStepActionWait{StepID: 5, DurationS: 30},
			&models.AutomationStepActionWait{StepID: 5, DurationS: 30},
		} {
			configs, err := buildTypedActionConfigs([]any{
				&models.AutomationAction{CommandName: "cabin_overheat_protection_on"},
				&models.AutomationAction{CommandName: "hvac_on"},
				payload,
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(configs) != 3 || configs[0].Type != "command" || configs[1].Type != "command" || configs[2].Type != "wait" {
				t.Fatalf("configs = %#v", configs)
			}
			wait, ok := configs[2].Payload.(*models.AutomationStepActionWait)
			if !ok || wait.DurationS != 30 || wait.StepID != 5 {
				t.Fatalf("typed payload = %#v", configs[2].Payload)
			}
			if strings.Contains(string(configs[2].Raw), "duration_seconds") {
				t.Fatal("legacy wait JSON bridge used")
			}
		}
		for _, payload := range []any{
			(*models.AutomationStepActionWait)(nil),
			models.AutomationStepActionWait{DurationS: 3601},
		} {
			if _, err := buildTypedActionConfigs([]any{payload}); err == nil {
				t.Fatal("invalid wait config accepted")
			}
		}
	})

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
	if history.climate != nil {
		t.Fatal("direct evaluation with a schedule snapshot must not record a scheduler receipt")
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
	created   *automationmodel.AutomationHistory
	completed *automationmodel.AutomationHistory
	climate   *automationmodel.ScheduledClimateReceipt
}

func (s *runtimeHistoryStore) Create(_ context.Context, h *automationmodel.AutomationHistory) error {
	copy := *h
	copy.ID = 99
	s.created = &copy
	h.ID = copy.ID
	return nil
}

func (s *runtimeHistoryStore) Complete(ctx context.Context, h *automationmodel.AutomationHistory, climate *automationmodel.ScheduledClimateReceipt) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	copy := *h
	s.completed = &copy
	s.climate = climate
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

type capturedCronRegistration struct {
	registration trigger.CronAutomation
	fired        chan context.Context
}

func (c capturedCronRegistration) LoadEnabledScheduleTriggers(context.Context) ([]trigger.CronAutomation, error) {
	return []trigger.CronAutomation{c.registration}, nil
}

func (c capturedCronRegistration) Evaluate(ctx context.Context, _ int64, _ json.RawMessage) error {
	select {
	case c.fired <- ctx:
	default:
	}
	return nil
}

func TestAutomationRuntimeDoesNotDispatchAnObsoleteScheduleRegistration(t *testing.T) {
	revision := time.Now().UTC().Add(-time.Hour)
	schedule := models.AutomationStepTriggerSchedule{StepID: 17, CronExpr: "@every 1s", Timezone: "UTC"}
	rule := &models.AutomationFull{
		Automation: models.Automation{ID: 1, UpdatedAt: revision, Enabled: true},
		Steps:      []models.AutomationStep{{ID: 17, Kind: models.AutomationStepKindTriggerSchedule}},
		Triggers:   []any{&schedule},
		Actions:    []any{&models.AutomationAction{CommandName: "lock"}},
	}
	capture := capturedCronRegistration{
		registration: trigger.CronAutomation{Automation: rule.Automation, Trigger: schedule},
		fired:        make(chan context.Context, 1),
	}
	cron := trigger.NewCronTrigger(capture, capture)
	if err := cron.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	defer cron.Stop()
	var firing context.Context
	select {
	case firing = <-capture.fired:
	case <-time.After(5 * time.Second):
		t.Fatal("registered schedule never fired")
	}
	history, recorder := &runtimeHistoryStore{}, &typedActionRecorder{}
	chain := action.NewChainExecutor(nil)
	chain.Register("command", recorder)
	engine := NewEngine(&runtimeAutomationStore{automation: rule}, history, chain)
	if err := engine.Evaluate(firing, rule.ID, nil); err != nil || !recorder.typedCalled || history.completed == nil {
		t.Fatalf("matching registration did not dispatch: %v", err)
	}
	for _, change := range []func(){
		func() { rule.Triggers = []any{&models.AutomationStepTriggerSchedule{StepID: 17, CronExpr: "@every 2s", Timezone: "UTC"}} },
		func() { rule.Triggers, rule.UpdatedAt = []any{&schedule}, revision.Add(time.Minute) },
	} {
		change()
		*recorder, *history = typedActionRecorder{}, runtimeHistoryStore{}
		if err := engine.Evaluate(firing, rule.ID, nil); err != nil || recorder.typedCalled || history.created != nil {
			t.Fatalf("obsolete registration evaluated a different snapshot: %v", err)
		}
	}
}

type interruptedRuntimeWait struct {
	cancel   context.CancelFunc
	unrelated bool
}

func (a interruptedRuntimeWait) Execute(ctx context.Context, _ *int64, _ json.RawMessage) (json.RawMessage, error) {
	a.cancel()
	if a.unrelated {
		return nil, fmt.Errorf("independent failure")
	}
	return nil, fmt.Errorf("wait interrupted: %w", ctx.Err())
}

func TestAutomationRuntimeKeepsFailuresDistinctFromInterruptions(t *testing.T) {
	rule := &models.AutomationFull{
		Automation: models.Automation{ID: 1, Enabled: true},
		Steps:      []models.AutomationStep{{ID: 21, Kind: models.AutomationStepKindTriggerSchedule}},
		Triggers:   []any{&models.AutomationStepTriggerSchedule{StepID: 21}},
		Actions:    []any{&models.AutomationStepActionWait{DurationS: 1}},
	}
	for _, tc := range []struct {
		status    string
		unrelated bool
		failed    int
	}{{"cancelled", false, 0}, {"failed", true, 1}} {
		t.Run(tc.status, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			chain := action.NewChainExecutor(nil)
			chain.Register("wait", interruptedRuntimeWait{cancel: cancel, unrelated: tc.unrelated})
			history := &runtimeHistoryStore{}
			engine := NewEngine(&runtimeAutomationStore{automation: rule}, history, chain)
			if err := engine.Evaluate(ctx, rule.ID, nil); err != nil {
				t.Fatal(err)
			}
			if h := history.completed; h == nil || h.Status != tc.status || h.ActionsFailed != tc.failed {
				t.Fatalf("incorrect durable classification: %+v", h)
			}
		})
	}
}

func TestScheduledClimateReceiptRequiresExactAcceptedOutcomeAndCurrentSchedule(t *testing.T) {
	target := int64(7)
	revision := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	fired := trigger.ScheduleFire{AutomationID: 1, Revision: revision, FiredAt: revision.Add(8 * time.Hour),
		Trigger: models.AutomationStepTriggerSchedule{StepID: 2, CronExpr: "0 8 * * 2", Timezone: "UTC"}}

	type scenario struct {
		name   string
		change func(*models.AutomationFull, *trigger.ScheduleFire, *action.ActionResult)
	}
	for _, tt := range []scenario{
		{name: "accepted for this vehicle"},
		{name: "accepted only for another vehicle", change: func(_ *models.AutomationFull, _ *trigger.ScheduleFire, r *action.ActionResult) {
			r.Output = json.RawMessage(`[{"vehicle_id":15,"command":"hvac_on","success":true}]`)
		}},
		{name: "ambiguous duplicate vehicle", change: func(_ *models.AutomationFull, _ *trigger.ScheduleFire, r *action.ActionResult) {
			r.Output = json.RawMessage(`[{"vehicle_id":7,"command":"hvac_on","success":true},{"vehicle_id":7,"command":"hvac_on","success":true}]`)
		}},
		{name: "command timed out", change: func(_ *models.AutomationFull, _ *trigger.ScheduleFire, r *action.ActionResult) {
			r.Success, r.Error = false, "deadline exceeded"
		}},
		{name: "edited since registration", change: func(a *models.AutomationFull, _ *trigger.ScheduleFire, _ *action.ActionResult) {
			a.UpdatedAt = a.UpdatedAt.Add(time.Minute)
		}},
		{name: "different typed schedule step", change: func(_ *models.AutomationFull, newer *trigger.ScheduleFire, _ *action.ActionResult) {
			newer.Trigger.StepID++
		}},
		{name: "manual invocation", change: func(_ *models.AutomationFull, newer *trigger.ScheduleFire, _ *action.ActionResult) {
			*newer = trigger.ScheduleFire{}
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			schedule := fired.Trigger
			rule := models.AutomationFull{
				Automation: models.Automation{ID: 1, VehicleID: &target, UpdatedAt: revision},
				Triggers:   []any{&schedule},
				Actions:    []any{&models.AutomationAction{CommandName: "hvac_on"}},
			}
			result := action.ActionResult{ActionType: "command", Success: true,
				Output: json.RawMessage(`[{"vehicle_id":15,"command":"hvac_on","success":true},{"vehicle_id":7,"command":"hvac_on","success":true}]`)}
			firing := fired
			if tt.change != nil {
				tt.change(&rule, &firing, &result)
			}
			got := scheduledClimateReceipt(&rule, firing, []action.ActionResult{result})
			if tt.change != nil {
				if got != nil {
					t.Fatalf("unattributable result was recorded: %+v", got)
				}
				return
			}
			if got == nil || got.VehicleID != target || !got.FiredAt.Equal(fired.FiredAt) || !got.Revision.Equal(revision) {
				t.Fatalf("matched outcome not recorded for exact target: %+v", got)
			}
		})
	}
}
