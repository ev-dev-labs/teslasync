package automation

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type waitWriteRecorder struct {
	sql  string
	args []any
	err  error
}

func (r *waitWriteRecorder) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	r.sql, r.args = sql, args
	return pgconn.NewCommandTag("INSERT 0 1"), r.err
}

func (r *waitWriteRecorder) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected query")
}

func (r *waitWriteRecorder) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected query row in wait write")
}

func TestCanonicalWaitTypedTransactionalWrite(t *testing.T) {
	repo := &AutomationStepChildRepo{}
	step := models.AutomationStep{ID: 6, StepOrder: 6, Kind: models.AutomationStepKindActionWait}
	recorder := &waitWriteRecorder{}
	if err := repo.UpsertTx(context.Background(), recorder, step, &models.AutomationStepActionWait{DurationS: 30}); err != nil {
		t.Fatal(err)
	}

	t.Run("CanonicalWaitOrderedRehydration", func(t *testing.T) {
		af := &models.AutomationFull{
			Automation: models.Automation{ID: 7},
			Steps: []models.AutomationStep{
				{ID: 1, StepOrder: 1, Kind: models.AutomationStepKindTriggerGeofence},
				{ID: 2, StepOrder: 2, Kind: models.AutomationStepKindTriggerGeofence},
				{ID: 3, StepOrder: 3, Kind: models.AutomationStepKindConditionTimeWindow},
				{ID: 4, StepOrder: 4, Kind: models.AutomationStepKindActionCommand},
				{ID: 5, StepOrder: 5, Kind: models.AutomationStepKindActionCommand},
				{ID: 6, StepOrder: 6, Kind: models.AutomationStepKindActionWait},
			},
		}
		triggers := map[int64]any{
			1: &models.AutomationStepTriggerGeofence{StepID: 1, PlaceID: 1, Event: "enter"},
			2: &models.AutomationStepTriggerGeofence{StepID: 2, PlaceID: 2, Event: "exit"},
		}
		conditions := map[int64]any{
			3: &models.AutomationStepConditionTimeWindow{StepID: 3, Timezone: "UTC", DaysOfWeek: []int16{1, 2}},
		}
		actions := map[int64]any{
			6: &models.AutomationStepActionWait{StepID: 6, DurationS: 30},
			5: &models.AutomationAction{StepID: 5, CommandName: "hvac_on"},
			4: &models.AutomationAction{StepID: 4, CommandName: "cabin_overheat_protection_on"},
		}
		if err := hydrateAutomationChildren([]*models.AutomationFull{af}, triggers, conditions, actions); err != nil {
			t.Fatal(err)
		}
		if len(af.Triggers) != 2 || len(af.Conditions) != 1 || len(af.Actions) != 3 ||
			af.Actions[0].(*models.AutomationAction).CommandName != "cabin_overheat_protection_on" ||
			af.Actions[1].(*models.AutomationAction).CommandName != "hvac_on" ||
			af.Actions[2].(*models.AutomationStepActionWait).DurationS != 30 {
			t.Fatalf("ordered aggregate = %#v", af)
		}
		af.Actions = nil
		delete(actions, 6)
		if err := hydrateAutomationChildren([]*models.AutomationFull{af}, triggers, conditions, actions); err == nil {
			t.Fatal("missing wait child silently removed a real action")
		}
	})
	if !strings.Contains(recorder.sql, "automation_step_action_wait (step_id, duration_s)") ||
		!strings.Contains(recorder.sql, "VALUES ($1, $2)") || len(recorder.args) != 2 ||
		recorder.args[0] != int64(6) || recorder.args[1] != 30 {
		t.Fatalf("typed SQL/args = %s %#v", recorder.sql, recorder.args)
	}
	boom := errors.New("child insert failed")
	recorder.err = boom
	if err := repo.UpsertTx(context.Background(), recorder, step, &models.AutomationStepActionWait{DurationS: 30}); !errors.Is(err, boom) {
		t.Fatalf("transaction caller cannot roll back error: %v", err)
	}
	for _, payload := range []any{
		&models.AutomationAction{CommandName: "lock"}, (*models.AutomationStepActionWait)(nil),
		&models.AutomationStepActionWait{DurationS: 0},
		&models.AutomationStepActionWait{DurationS: 3601},
	} {
		next := &waitWriteRecorder{}
		if err := repo.UpsertTx(context.Background(), next, step, payload); err == nil || next.sql != "" {
			t.Fatalf("invalid payload %#v wrote SQL", payload)
		}
	}
	if !models.ActionWait.Valid() || models.ActionWait.String() != step.Kind {
		t.Fatal("wait enum is not canonical")
	}
}
