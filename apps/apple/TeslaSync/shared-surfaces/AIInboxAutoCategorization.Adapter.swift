//
//  AIInboxAutoCategorization.Adapter.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  The testable projection core for the "Suggest inbox categories" Helix panel — the SwiftUI
//  parity of components/ai/AIInboxAutoCategorization.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the typed
//  `tool_result` → `[InboxCategoryBucket]` decode and the stream-lifecycle types are all unit
//  tested in isolation (and in the Foundation verification harness) without rendering a view.
//
//  Parity note: the web `handleEvent` only captures a `tool_result` frame whose
//  `name === 'draft_alert_categories'` AND `ok === true`, requires `data.status === 'ok'` and
//  `data.categories` to be an array, then walks each element with `typeof` guards (`category`
//  non-empty string, `count` number ≥ 0; optional `rule_ids` numbers > 0 and `sample_titles`
//  non-empty strings) and drops anything that fails — never throwing, never surfacing a partial
//  bucket. `InboxCategoryBucket.list(from:)` reproduces that walk exactly. The web only commits
//  the proposal when at least one bucket survives; natively a resolved-but-empty result is kept
//  as the distinct "no categories suggested" capture so the panel is never a blank box (P4).
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and the
/// AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the state-holder
/// can emit telemetry without depending on the view layer.
public enum InboxCategorySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIInboxAutoCategorization"
    /// The AI feature id (web `withAiFeature('inbox-auto-categorization', …)`).
    public static let featureID = "inbox-auto-categorization"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data` object the web
/// `handleEvent` narrows with `typeof` guards. Kept deliberately small (the only shapes the SSE
/// writer emits for this tool) so the decode stays a pure, exhaustively tested function rather
/// than a reflection-driven coder.
public enum InboxCategoryJSONValue: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: InboxCategoryJSONValue])
    case array([InboxCategoryJSONValue])
    case null

    /// The string payload (web `typeof x === 'string'`), or `nil` for any other kind.
    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// The numeric payload (web `typeof x === 'number'`), or `nil` for any other kind.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The nested object (web `typeof raw === 'object'`), or `nil` for any other kind.
    public var objectValue: [String: InboxCategoryJSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }

    /// The array payload (web `Array.isArray(...)`), or `nil` otherwise.
    public var arrayValue: [InboxCategoryJSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's
/// `{ id, name, ok, data, error }` shape. The view never sees this type; the state-holder
/// forwards it to `InboxCategoryBucket.list(from:)`.
public struct InboxCategoryToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: InboxCategoryJSONValue]?
    public let error: String?

    public init(
        id: String,
        name: String,
        ok: Bool,
        data: [String: InboxCategoryJSONValue]? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Category bucket (web `CategoryBucket` envelope)

/// The typed shape of one element in the `draft_alert_categories` tool's `categories` array —
/// the native mirror of the web `CategoryBucket` interface
/// (internal/ai/tools/inbox_auto_categorization.go `CategoryBucket`). Kept narrow so the Helix
/// panel only renders fields it actually uses; `ruleIDs` / `sampleTitles` stay optional exactly
/// as the web payload allows.
public struct InboxCategoryBucket: Equatable, Sendable, Identifiable {
    /// The human-readable category label (web `category`, required + non-empty).
    public let category: String
    /// The number of alerts bucketed into this category (web `count`, required + ≥ 0).
    public let count: Int
    /// The alert-rule ids feeding this category, when the tool echoed any (web `rule_ids`).
    public let ruleIDs: [Int64]?
    /// A few example alert titles, when the tool echoed any (web `sample_titles`).
    public let sampleTitles: [String]?

    public init(category: String, count: Int, ruleIDs: [Int64]? = nil, sampleTitles: [String]? = nil) {
        self.category = category
        self.count = count
        self.ruleIDs = ruleIDs
        self.sampleTitles = sampleTitles
    }

    /// The stable list identity — the web React `key={bucket.category}`.
    public var id: String {
        category
    }

    /// The tool whose `tool_result` frame carries category buckets (web
    /// `ev.name === 'draft_alert_categories'`).
    public static let toolName = "draft_alert_categories"

    /// Native port of the web `handleEvent` walk: accept the frame only when it is the categorize
    /// tool, succeeded, carries `status === 'ok'`, and a `categories` array; then build a bucket
    /// per element that has a non-empty `category` string and a `count` number ≥ 0, dropping any
    /// element that fails (the web `continue`). Returns `nil` when the frame itself is rejected
    /// (web early `return`); returns an array (possibly empty) for an accepted frame — an empty
    /// result is the distinct "no categories suggested" capture (P4 "never a blank box").
    public static func list(from result: InboxCategoryToolResult) -> [InboxCategoryBucket]? {
        guard result.name == toolName, result.ok, let data = result.data else { return nil }
        guard data["status"]?.stringValue == "ok" else { return nil }
        guard let rawCategories = data["categories"]?.arrayValue else { return nil }
        var out: [InboxCategoryBucket] = []
        for raw in rawCategories {
            guard let object = raw.objectValue else { continue }
            guard
                let category = object["category"]?.stringValue, !category.isEmpty,
                let countValue = object["count"]?.numberValue, countValue >= 0
            else {
                continue
            }
            out.append(InboxCategoryBucket(
                category: category,
                count: Int(countValue),
                ruleIDs: ruleIDs(from: object["rule_ids"]),
                sampleTitles: sampleTitles(from: object["sample_titles"])
            ))
        }
        return out
    }

    /// Narrows the optional `rule_ids` field: only positive numbers survive (web `v > 0`), and an
    /// empty / non-array / all-invalid field collapses to `nil` (web omits it entirely).
    private static func ruleIDs(from value: InboxCategoryJSONValue?) -> [Int64]? {
        guard let raw = value?.arrayValue else { return nil }
        let ids = raw.compactMap { element -> Int64? in
            guard let number = element.numberValue, number > 0 else { return nil }
            return Int64(number)
        }
        return ids.isEmpty ? nil : ids
    }

    /// Narrows the optional `sample_titles` field: only non-empty strings survive (web `v !== ''`),
    /// and an empty / non-array / all-invalid field collapses to `nil`.
    private static func sampleTitles(from value: InboxCategoryJSONValue?) -> [String]? {
        guard let raw = value?.arrayValue else { return nil }
        let titles = raw.compactMap { element -> String? in
            guard let title = element.stringValue, !title.isEmpty else { return nil }
            return title
        }
        return titles.isEmpty ? nil : titles
    }
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks a new
/// `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum InboxCategoryStreamPhase: Equatable, Sendable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error(String)

    /// Web `stream.state === 'error'`.
    public var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feature-gate / context snapshot — the orthogonal connectivity axis
/// rendered as the header chip + banner. `live` hides the banner.
public enum InboxCategoryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`. `loading`
/// shows skeleton chrome while the gate resolves; `off` collapses the surface to nothing (web
/// `withAiFeature` returns `null`); `on` renders the card.
public enum InboxCategoryGateState: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}
