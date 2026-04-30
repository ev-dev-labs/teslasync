package database

// AutomationRepo provides automation data access operations against the
// post-migration `automations` table. Per ADR-004 the typed CTI children
// (steps, triggers, scope) are loaded by their own repos; methods here
// operate only on the automations row itself.
type AutomationRepo struct {
	db *DB
}

// AutomationStepWrite is the persistence DTO for an ordered discriminator row
// plus its already-validated typed CTI payload.
type AutomationStepWrite struct {
	StepOrder int
	Kind      string
	Payload   any
}

func NewAutomationRepo(db *DB) *AutomationRepo {
	return &AutomationRepo{db: db}
}
