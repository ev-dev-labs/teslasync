// Package summary carves the "summarize a recent window of system data"
// tool family out of the parent internal/ai/tools/ flat package per
// ADR-011 §3 + ADR-015-amend (AI subsystem in scope for Phase R,
// file-move-only).
//
// All four tools follow the same shape: a Scoped*Window middleware injects
// a time range + filter into the request context, a tool reads recent
// signal_log / log / FSM-trace / changelog rows for that window into a
// typed envelope, and the LLM narrates over the envelope to produce a
// human-readable summary. This is the AI-Off Contract surface (ADR-015
// §I12) — preserved verbatim from the pre-R6.12 parent-pkg version.
//
//	incident_timeline.go — RegisterIncidentTimelineSummarizerTools
//	                       (WithScopedIncidentID + IncidentTimelineSource port +
//	                        IncidentTimelineEnvelope; exports
//	                        FormatIncidentTimestamp helper used by the strategy
//	                        package to render the prompt)
//	log_trace.go         — RegisterLogTraceSummarizerTools
//	                       (WithScopedLogTraceWindow + TraceWindowSource port +
//	                        TraceWindowEnvelope; LogLevelCount + TraceOpStat
//	                        aggregates)
//	software_update.go   — RegisterSoftwareUpdateChangelogSummarizerTools
//	                       (WithScopedSoftwareUpdateChangelogWindow +
//	                        VehicleSoftwareSource port + VehicleSoftwareEnvelope)
//	fsm_trace.go         — RegisterStateMachineDebuggerNarratorTools
//	                       (WithScopedFSMTraceWindow + FSMTraceSource port +
//	                        FSMTraceEnvelope; transition + edge + FSM counts)
//
// Alias convention (ADR-011 §3): callsites importing this alongside other
// clusters MAY alias as `summaryaitools` (the short name "summary"
// collides with several other things in the tree). The composition root
// in internal/api/router.go imports without alias.
//
// Strategy packages under internal/ai/strategies/ contain stale GoDoc
// references like `tools.TraceWindowEnvelope`; these are comments only
// (no symbol resolution) so they're left in place — godoc tooling still
// hyperlinks the symbol correctly through the new path after R6.12.
//
// Layer: domain
package summary
