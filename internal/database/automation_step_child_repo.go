package database

// AutomationStepChildRepo provides batched loaders for the CTI child tables
// hanging off automation_steps (ADR-004 / ADR-005). Each automation step has
// exactly one kind-specific child row; this repo exposes loaders that fetch
// children for a batch of step IDs in a single round-trip to avoid N+1
// fan-out when hydrating an automation tree.
type AutomationStepChildRepo struct {
	db *DB
}

func NewAutomationStepChildRepo(db *DB) *AutomationStepChildRepo {
	return &AutomationStepChildRepo{db: db}
}
