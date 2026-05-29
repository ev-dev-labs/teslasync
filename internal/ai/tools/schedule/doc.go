// Package schedule hosts time-window draft/validate tools.
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
// Each tool's JSON schema, validation rules, and Execute payload shape
// are part of the AI contract mirrored by web/src/ai/features.ts.
//
// Alias convention (ADR-011 §3): callsites importing this alongside other
// clusters MAY alias as `scheduleaitools` (collision-prone short name).
// The composition root in internal/api/router.go imports without alias.
//
// Layer: domain
package schedule
