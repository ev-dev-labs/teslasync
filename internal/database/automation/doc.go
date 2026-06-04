// Package automation holds repository types for the automation aggregate:
// AutomationRepo (rules CRUD with bulk/mutation/query split files),
// AutomationStepRepo + AutomationStepChildRepo (per-step rule tree storage
// with persistence + query split), AutomationHistoryRepo (execution log),
// and AutomationVariableRepo (rule-scoped variables).
//
// Callers typically import this package as `dbauto` to disambiguate it
// from internal/automation, which contains the runtime engine.
//
// Cross-aggregate dependency: methods consume database.DBTX (transaction
// interface) which lives in the parent package. The carved files qualify
// every reference as `database.DBTX`.
//
// Layer: adapter
package automation
