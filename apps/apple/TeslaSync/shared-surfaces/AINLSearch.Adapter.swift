//
//  AINLSearch.Adapter.swift
//  TeslaSync — P4 shared surface · 0034 · AINLSearch (Apple)
//
//  The testable projection core for the "Search with natural language" Helix panel — the
//  SwiftUI parity of components/ai/AINLSearch.tsx. Everything here is pure + dependency-free
//  (Foundation only — no SwiftUI, no Observation, no network), so the request-body projection
//  (the web `body` useMemo) and the prompt validity gate (web `canStart`) are unit tested in
//  isolation without rendering a view.
//
//  Parity note: the web component computes
//    const body = useMemo(() => ({ prompt }), [prompt])
//    canStart = prompt.trim().length > 0
//  Like the AINLDriveSearch analog this surface has NO vehicle scope and NO MaxQuestionChars
//  cap — its only POST field is the free-form `prompt`, and the search button enables purely on
//  a non-empty trimmed prompt. `NLSearchRequest.project(rawPrompt:)` reproduces that walk
//  exactly, so the POSTed `{ prompt }` body + the button gate stay faithful to the on-mode SSE
//  wiring contract (POST /api/v1/ai/search/query, guard `nl-search`).
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum NLSearchSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AINLSearch"
    /// The AI feature id (web `withAiFeature('nl-search', …)`).
    public static let featureID = "nl-search"
}

// MARK: - Request projection (web `body` useMemo + `prompt.trim()`)

/// The projected POST body for `/ai/search/query` — the native mirror of the web `body`
/// useMemo `{ prompt }`. The `prompt` is trimmed (web `canStart` reads `prompt.trim()`); the
/// validity gate reproduces the web `canStart = prompt.trim().length > 0` boolean the button
/// reads. The view never builds this directly — the model projects it from the user's prompt
/// before handing it to the source's `startStream`.
public struct NLSearchRequest: Equatable, Sendable {
    /// The trimmed prompt text (web `prompt`, after `prompt.trim()`).
    public let prompt: String

    public init(prompt: String) {
        self.prompt = prompt
    }

    /// Native port of the web `body` useMemo: trim the raw prompt (web `prompt.trim()`) so a
    /// whitespace-only prompt cannot start a stream. The trimmed value is what the on-mode
    /// stream POSTs, matching the wire contract `{ prompt }`.
    public static func project(rawPrompt: String) -> NLSearchRequest {
        NLSearchRequest(prompt: rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// Web `prompt.trim().length > 0` — the AIFeatureCard button gate's only input predicate.
    public var isPromptValid: Bool {
        !prompt.isEmpty
    }

    /// Web `canStart = prompt.trim().length > 0`. This surface has no vehicle scope, so the
    /// prompt validity is the whole gate.
    public var canStart: Bool {
        isPromptValid
    }
}
