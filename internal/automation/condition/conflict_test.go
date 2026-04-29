package condition

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestAutomationConflictDetectionUsesTypedChildren(t *testing.T) {
	candidate := typedConflictAutomation(1, "lock nightly", "0 22 * * *", "lock")
	other := typedConflictAutomation(2, "unlock nightly", "0 22 * * *", "unlock")

	conflicts := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(conflicts) != 1 {
		t.Fatalf("conflicts = %d, want 1", len(conflicts))
	}
	if conflicts[0].AutomationID != other.ID || conflicts[0].Severity != "warning" {
		t.Fatalf("conflict = %#v", conflicts[0])
	}
}

func typedConflictAutomation(id int64, name, cronExpr, command string) *models.AutomationFull {
	return &models.AutomationFull{
		Automation: models.Automation{
			ID:      id,
			Name:    name,
			Enabled: true,
		},
		Steps: []models.AutomationStep{
			{ID: id*10 + 1, AutomationID: id, StepOrder: 1, Kind: models.AutomationStepKindTriggerSchedule},
			{ID: id*10 + 2, AutomationID: id, StepOrder: 2, Kind: models.AutomationStepKindActionCommand},
		},
		Triggers: []any{
			&models.AutomationStepTriggerSchedule{StepID: id*10 + 1, CronExpr: cronExpr, Timezone: "UTC"},
		},
		Actions: []any{
			&models.AutomationAction{StepID: id*10 + 2, CommandName: command},
		},
	}
}
