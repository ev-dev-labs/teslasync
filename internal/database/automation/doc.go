// Package automation holds repository types for the automation aggregate:
// AutomationRepo (rules CRUD with bulk/mutation/query split files),
// AutomationStepRepo + AutomationStepChildRepo (per-step rule tree storage
// with persistence + query split), AutomationHistoryRepo (execution log),
// and AutomationVariableRepo (rule-scoped variables).
//
// Carved from internal/database in Phase R4.7 per ADR-011 — the LARGEST
// single-aggregate carve so far at 10 src files + 1 test. Callers import
// as `dbauto` to disambiguate from internal/automation (runtime engine).
//
// Cross-aggregate dependency: methods consume database.DBTX (transaction
// interface) which lives in the parent package. The carved files qualify
// every reference as `database.DBTX`.
//
// Layer: adapter (database)
package automation
