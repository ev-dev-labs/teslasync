// Package lifetime carves the lifetime-stats-QA, TCO-narration, and
// vampire-drain-explanation tool family out of the parent
// internal/ai/tools/ flat package per ADR-011 §3 (bounded-context
// subpackages) + ADR-015-amend (AI subsystem in scope for Phase R,
// file-move-only). The three tools share a "narrative summary over
// long-horizon analytics" theme and a strict Layer: domain charter:
//
//	stats_qa.go      — RegisterLifetimeStatsQATools + LifetimeStats*
//	tco.go           — RegisterTCONarrationTools + TCOSummary/TCOSummarizer
//	vampire_drain.go — RegisterVampireDrainExplanationTools +
//	                   VampireDrainExplanationSources / VampireDrainSource
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.16 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside other clusters MAY alias as `lifetimeaitools` to
// disambiguate. The composition root in internal/api/router.go
// imports it without alias because no collision exists there.
//
// Layer: domain
package lifetime
