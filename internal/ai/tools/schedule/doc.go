// Package schedule carves the time-window draft/validate tool family out of
// the parent internal/ai/tools/ flat package per ADR-011 §3 + ADR-015-amend.
//
// All three tools follow the "LLM drafts a typed time window → Go
// validator hardens it against historical signals / cost rates / quiet
// rules" pattern. They share the larger NL-two-step contract from the
// nl/ cluster but specifically deal with TIME-WINDOW proposals (charge
// start/end, climate preheat hour, alert quiet-hours range) rather than
// query filters or watch context.
//
//	charge.go       — RegisterSmartChargeScheduleSuggestionTools
//	                  (ChargeScheduleComputer port; computes ChargeWindow +
//	                   CostComparison + HourlyRate from a draft and reads
//	                   live electricity tariff schedule)
//	climate.go      — RegisterPreheatPrecoolRecommenderTools
//	                  (ClimateScheduleAdvisor port; reads vehicle climate
//	                   preference + ambient temp forecast to draft a
//	                   preheat/precool ClimateScheduleDraftRequest)
//	quiet_hours.go  — RegisterQuietHoursSuggestionTools
//	                  (QuietHoursSuggestionSource port + WithScopedQuietHours-
//	                   Window context-injection — replaces middleware that
//	                   used to live in the parent pkg)
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12. Each tool's
// JSON schema, validate rules, and Execute payload shape are unchanged
// from the pre-R6.11 parent-pkg version. ai-vet mirror at
// web/src/ai/features.ts confirms parity at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this alongside other
// clusters MAY alias as `scheduleaitools` (collision-prone short name).
// The composition root in internal/api/router.go imports without alias.
//
// Layer: domain
package schedule
