package automation

import "github.com/ev-dev-labs/teslasync/internal/database"

// AutomationStepChildRepo provides batched loaders for the CTI child tables
// hanging off automation_steps. Each automation step has
// exactly one kind-specific child row; this repo exposes loaders that fetch
// children for a batch of step IDs in a single round-trip to avoid N+1
// fan-out when hydrating an automation tree.
type AutomationStepChildRepo struct {
	db *database.DB
}

func NewAutomationStepChildRepo(db *database.DB) *AutomationStepChildRepo {
	return &AutomationStepChildRepo{db: db}
}
