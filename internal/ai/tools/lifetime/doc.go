// Package lifetime contains the lifetime-stats-QA, TCO-narration, and
// vampire-drain-explanation AI tools. ADR-011 §3 keeps bounded-context
// AI tools in subpackages. The three tools share a narrative summary
// over long-horizon analytics theme and a strict Layer: domain charter:
//
//	stats_qa.go      — RegisterLifetimeStatsQATools + LifetimeStats*
//	tco.go           — RegisterTCONarrationTools + TCOSummary/TCOSummarizer
//	vampire_drain.go — RegisterVampireDrainExplanationTools +
//	                   VampireDrainExplanationSources / VampireDrainSource
//
// ADR-015 §I12 (AI-Off Contract): exported type, interface, and
// function names, JSON tags, schema fields, and Execute payload shapes
// must remain stable. ai-vet and the aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside other clusters MAY alias as `lifetimeaitools` to
// disambiguate. The composition root in internal/api/router.go
// imports it without alias because no collision exists there.
//
// Layer: domain
package lifetime
