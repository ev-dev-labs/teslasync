// Package nl contains the natural-language draft/validate AI tool family.
// ADR-011 §3 keeps bounded-context AI tools in subpackages.
//
// All three tools follow the "LLM drafts a typed payload → deterministic
// validator hardens it" pattern (the "two-step NL contract"): the LLM
// produces a free-form JSON envelope; a second tool replays the envelope
// through a Go validator that rejects anything outside the canonical
// schema/allowlist. This shape is the ADR-015 §I12 AI-Off Contract
// surface area and must remain stable.
//
//	signal_filter.go — RegisterSignalExplorerNlFilterTools (NL-to-SignalFilter
//	                   contract; WithScopedSignalCatalog context-injection
//	                   used by request middleware to scope the catalog to a
//	                   single vehicle/session so the LLM CANNOT propose a
//	                   signal it hasn't been shown)
//	watch_face.go    — RegisterWatchFaceNLResponseTools (query_watch_context
//	                   tool; reads recent alert history into a typed envelope
//	                   the watch UI narrates over)
//	inbox.go         — RegisterInboxAutoCategorizationTools (draft + validate
//	                   alert categories; CategoryForSignal classifier kept
//	                   exported as it has callers outside the AI surface)
//
// Unexported helpers (namesToSet, namesSetToSortedSlice) stay in
// signal_filter.go scoped to the file that defines them.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `nlaitools` to disambiguate from the
// many "nl-*" strategy packages in internal/ai/strategies/. The composition
// root in internal/api/router.go imports without alias.
//
// Layer: domain
package nl
