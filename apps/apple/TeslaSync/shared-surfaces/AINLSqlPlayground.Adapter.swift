//
//  AINLSqlPlayground.Adapter.swift
//  TeslaSync — P4 shared surface · 0035 · AINLSqlPlayground (Apple)
//
//  The testable projection core for the "Helix natural-language SQL drafter" panel — the
//  SwiftUI parity of components/ai/AINLSqlPlayground.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the
//  request-body projection (the web `body` useMemo `{ prompt }`), the prompt validity gate
//  (web `canStart`/`hasPrompt`), and the typed `tool_result` envelope decode (the web
//  `parseReadonlySQLDraft`) are all unit tested in isolation without rendering a view.
//
//  Parity note: the web component computes
//    const trimmed = prompt.trim()
//    const hasPrompt = trimmed.length > 0
//    const body = useMemo(() => ({ prompt: trimmed }), [trimmed])
//  and, when the LLM emits a `tool_result` for `draft_readonly_sql`, captures a typed
//  ReadonlySQLDraft via `parseReadonlySQLDraft(ev.data)`. `NLSqlPlaygroundRequest.project`
//  reproduces the body walk; `ReadonlySQLDraft.parse` reproduces the defensive decode
//  bit-for-bit, so the POSTed `{ prompt }` body (POST /api/v1/ai/power/sql/draft, guard
//  `nl-sql-playground`) and the propose-only draft capture stay faithful (ADR-015 §I8).
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum NLSqlPlaygroundSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AINLSqlPlayground"
    /// The AI feature id (web `withAiFeature('nl-sql-playground', …)`).
    public static let featureID = "nl-sql-playground"
    /// The tool name whose `tool_result` carries the typed draft (web
    /// `ev.name === 'draft_readonly_sql'`).
    public static let draftToolName = "draft_readonly_sql"
}

// MARK: - Request projection (web `body` useMemo + `prompt.trim()`)

/// The projected POST body for `/ai/power/sql/draft` — the native mirror of the web `body`
/// useMemo `{ prompt: trimmed }`. The `prompt` is trimmed (web `prompt.trim()`); the validity
/// gate reproduces the web `hasPrompt = prompt.trim().length > 0` boolean the "Draft SQL"
/// button reads. The view never builds this directly — the model projects it from the user's
/// prompt before handing it to the source's `startStream`.
public struct NLSqlPlaygroundRequest: Equatable, Sendable {
    /// The trimmed prompt text (web `trimmed = prompt.trim()`).
    public let prompt: String

    public init(prompt: String) {
        self.prompt = prompt
    }

    /// Native port of the web `body` useMemo: trim the raw prompt (web `prompt.trim()`) so a
    /// whitespace-only prompt cannot start a stream. The trimmed value is what the on-mode
    /// stream POSTs, matching the wire contract `{ prompt }`.
    public static func project(rawPrompt: String) -> NLSqlPlaygroundRequest {
        NLSqlPlaygroundRequest(prompt: rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// Web `hasPrompt = trimmed.length > 0` — the AIFeatureCard button gate's only input
    /// predicate (this surface has no vehicle scope and no character cap).
    public var isPromptValid: Bool {
        !prompt.isEmpty
    }

    /// Web `canStart = hasPrompt`. The prompt validity is the whole gate.
    public var canStart: Bool {
        isPromptValid
    }
}

// MARK: - Typed draft envelope (web `ReadonlySQLDraft` + `parseReadonlySQLDraft`)

/// The typed payload the Helix panel captures when the LLM successfully calls
/// `draft_readonly_sql` — the native mirror of the web `ReadonlySQLDraft` interface (and the
/// Go-side `ReadonlySQLDraft` DTO in internal/ai/tools/nl_sql_playground.go). The field set is
/// intentionally narrow: only the fields the deterministic SQL editor already owns. The LLM
/// never executes the query (ADR-015 §I8 propose-only); the user applies the draft explicitly.
public struct ReadonlySQLDraft: Equatable, Sendable {
    /// The natural-language prompt the draft answers (web `prompt`).
    public let prompt: String
    /// The proposed read-only SQL (web `sql`).
    public let sql: String
    /// Helix's short explanation of the query (web `rationale`).
    public let rationale: String
    /// The tables the query references (web `referenced_tables`, snake_case on the wire).
    public let referencedTables: [String]

    public init(prompt: String, sql: String, rationale: String, referencedTables: [String]) {
        self.prompt = prompt
        self.sql = sql
        self.rationale = rationale
        self.referencedTables = referencedTables
    }

    /// Native port of the web `parseReadonlySQLDraft(data: unknown)`: decode the raw
    /// `tool_result` `data` JSON bytes and validate the envelope shape. Returns `nil` for any
    /// non-conforming payload (no data, not an object, `status !== 'ok'`, missing/!string
    /// prompt/sql/rationale), exactly like the web guard chain.
    public static func parse(toolResultData data: Data?) -> ReadonlySQLDraft? {
        guard let data, !data.isEmpty,
              let root = try? JSONSerialization.jsonObject(with: data),
              let object = root as? [String: Any]
        else { return nil }
        return parse(toolResultObject: object)
    }

    /// The decoded-object form of the web `parseReadonlySQLDraft` guard chain, split out so it
    /// is unit tested without round-tripping through `Data`.
    public static func parse(toolResultObject object: [String: Any]) -> ReadonlySQLDraft? {
        guard (object["status"] as? String) == "ok" else { return nil }
        guard let draft = object["draft"] as? [String: Any] else { return nil }
        guard let prompt = draft["prompt"] as? String,
              let sql = draft["sql"] as? String,
              let rationale = draft["rationale"] as? String
        else { return nil }
        // Web: `Array.isArray(referenced_tables) ? filter(string) : []`.
        let tables = (draft["referenced_tables"] as? [Any])?
            .compactMap { $0 as? String } ?? []
        return ReadonlySQLDraft(
            prompt: prompt,
            sql: sql,
            rationale: rationale,
            referencedTables: tables
        )
    }
}
