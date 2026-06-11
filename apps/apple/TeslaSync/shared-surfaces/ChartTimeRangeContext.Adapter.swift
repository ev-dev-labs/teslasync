//
//  ChartTimeRangeContext.Adapter.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  The testable, dependency-light core for multi-chart cursor sync — the SwiftUI parity of
//  components/charts/ChartTimeRangeContext.tsx + its companion external store
//  components/charts/cursorSync.ts. The web source is a coordination primitive, not a visual
//  component: a React context (`ChartTimeRangeProvider`) hands every descendant chart a stable
//  `syncId` + `syncMethod`, and a module-level `useSyncExternalStore` store records the last hovered
//  x value per `syncId` so a *persistent* vertical reference line survives mouseleave across every
//  synced chart. This file is the Foundation-only heart of the native peer: the value types
//  (`CursorSyncValue`, `ChartSyncMethod`, `ChartSyncContextValue`, `SyncedCursorProps`) and the pure
//  store reducer (`CursorSyncReducer`) that ports `setCursorSyncPosition` / `getCursorSyncPosition` /
//  `clearCursorSync` verbatim. No SwiftUI, no Charts, no @Observable store — so every branch is unit
//  testable in isolation.
//
//  Faithful-parity note: the web source renders NO chrome of its own — it is a transparent provider
//  whose only outputs are the `syncId`/`syncMethod` it broadcasts and the persistent x value it
//  stores. It has no loading / empty / error / stale / offline branches (there is no fetch and no
//  remote data — the store is a local in-process Map). Inventing such chrome would contradict the
//  spec, so this surface reproduces only the source's REAL branches: inside vs. outside a provider,
//  a stored cursor value present vs. absent, and `syncMethod` index vs. value — exactly mirroring the
//  sibling anonymous primitive `withAiFeature` (which likewise renders only its real outcomes).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened`
/// (P1/S11). The web source is anonymous (it has no slug of its own); the prompt assigns this
/// surface the canonical slug `ChartTimeRangeContext`, kept here (SwiftUI-free) so the state-holder
/// can emit telemetry without depending on the view layer.
public enum ChartTimeRangeSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ChartTimeRangeContext"
}

// MARK: - CursorSyncValue (web `string | number | null`)

/// The active x value a synced chart records and every sibling renders as a persistent reference
/// line — the native peer of the web `CursorSyncValue = string | number | null`. The non-null part
/// of the union maps to the two cases; the `null` of the union maps to Swift `nil`, so the stored
/// value's type is `CursorSyncValue?` everywhere (the store deletes the entry rather than holding a
/// `.none` case, exactly as `setCursorSyncPosition(syncId, null)` does).
///
/// Recharts' `activeLabel` is either the formatted category string (`syncMethod == .index`) or the
/// raw x-axis value (`syncMethod == .value`); both are represented here so the native chart bridge
/// can broadcast whichever its x-scale uses.
public enum CursorSyncValue: Sendable, Equatable, Hashable {
    /// A category / formatted-label x value (web `string`).
    case text(String)
    /// A numeric x value — a raw axis value or a timestamp (web `number`).
    case number(Double)

    /// Builds a numeric cursor value from an integer row index (the `syncMethod == .index` path).
    public init(index: Int) {
        self = .number(Double(index))
    }

    /// Builds a numeric cursor value from a `Date`, projecting to a stable, non-formatted instant
    /// (seconds since the reference date) — the native spelling of the web guidance to carry "a
    /// stable, non-formatted value (e.g., a raw timestamp)" on the x-axis for `syncMethod == .value`.
    public init(date: Date) {
        self = .number(date.timeIntervalSinceReferenceDate)
    }

    /// The numeric payload when this value is `.number`, else `nil` — used by the chart bridge to
    /// place a `RuleMark` on a numeric x-scale.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The string payload when this value is `.text`, else `nil` — used by the chart bridge to place
    /// a `RuleMark` on a category x-scale.
    public var textValue: String? {
        if case let .text(value) = self { return value }
        return nil
    }
}

// MARK: - ChartSyncMethod (web `'index' | 'value'`)

/// How synced charts match the active position — the native peer of the web
/// `syncMethod: 'index' | 'value'`. `index` (the default) matches by row index and is correct only
/// when every participating chart renders from the same-length, same-order dataset; `value` matches
/// by a stable x-axis value and is required when datasets differ in length.
public enum ChartSyncMethod: String, Sendable, Equatable, CaseIterable {
    case index
    case value
}

// MARK: - ChartSyncContextValue (web `ChartSyncContextValue`)

/// The context payload a provider broadcasts to every descendant chart — the native peer of the web
/// `ChartSyncContextValue { syncId, syncMethod }`. Carried in the SwiftUI environment (the analog of
/// the React context) so a chart reads it without the provider passing it down by hand.
public struct ChartSyncContextValue: Sendable, Equatable {
    /// Stable, page-scoped identifier (web recharts `syncId`). Two surfaces on screen at once pick
    /// distinct ids so they never cross-sync.
    public let syncId: String
    /// How synced charts match positions (web `syncMethod`). Defaults to `.index`.
    public let syncMethod: ChartSyncMethod

    public init(syncId: String, syncMethod: ChartSyncMethod = .index) {
        self.syncId = syncId
        self.syncMethod = syncMethod
    }
}

// MARK: - SyncedCursorProps (web `SyncedCursorProps`)

/// The props a chart spreads onto its Swift Charts view — the native peer of the web
/// `SyncedCursorProps { syncId?, syncMethod?, onMouseMove? }`. Outside a provider every field is
/// `nil` (web returns `{}`), so a standalone chart opts in unconditionally without crashing; the
/// broadcast closure (web `onMouseMove`) lives on the state-holder rather than this value type so the
/// pure core stays Foundation-only and `Equatable`.
public struct SyncedCursorProps: Sendable, Equatable {
    public let syncId: String?
    public let syncMethod: ChartSyncMethod?

    public init(syncId: String? = nil, syncMethod: ChartSyncMethod? = nil) {
        self.syncId = syncId
        self.syncMethod = syncMethod
    }

    /// The "outside a provider" value — every field `nil` (web `useSyncedCursor` → `{}`).
    public static let inactive = SyncedCursorProps()

    /// `true` when the props came from a live provider (web `ctx != null`).
    public var isActive: Bool {
        syncId != nil
    }
}

// MARK: - CursorSyncReducer (verbatim port of cursorSync.ts mutations)

/// The pure store semantics behind the persistent cursor — the verbatim port of the web external
/// store mutators (`setCursorSyncPosition` / `getCursorSyncPosition` / `clearCursorSync`). Kept as
/// pure functions over a caller-owned `positions` map so the rules — no-op when unchanged, delete on
/// `nil`, read `nil` for an unknown/`nil` id — are unit tested without an `@Observable` store or a
/// `useSyncExternalStore` subscription.
public enum CursorSyncReducer {
    /// Reads the current cursor value for a `syncId` — the port of `getCursorSyncPosition` and of
    /// `useCursorSyncPosition(undefined)` (a `nil` id always reads `nil` without touching the map).
    public static func position(
        in positions: [String: CursorSyncValue],
        syncId: String?
    ) -> CursorSyncValue? {
        guard let syncId else { return nil }
        return positions[syncId]
    }

    /// Sets (or, for a `nil` value, clears) the cursor value for a `syncId` — the port of
    /// `setCursorSyncPosition`. Returns whether the map changed, so the `@Observable` store can skip
    /// a spurious invalidation when the value is unchanged (web `if (current === value) return`).
    @discardableResult
    public static func set(
        _ positions: inout [String: CursorSyncValue],
        syncId: String,
        value: CursorSyncValue?
    ) -> Bool {
        let current = positions[syncId]
        guard current != value else { return false }
        if let value {
            positions[syncId] = value
        } else {
            positions.removeValue(forKey: syncId)
        }
        return true
    }

    /// Drops the entry for a `syncId` — the port of `clearCursorSync`, called when a provider
    /// unmounts so a page never leaks a stale persistent cursor into the next one. Returns whether
    /// the map changed (web `if (!store.positions.has(syncId)) return`).
    @discardableResult
    public static func clear(
        _ positions: inout [String: CursorSyncValue],
        syncId: String
    ) -> Bool {
        guard positions[syncId] != nil else { return false }
        positions.removeValue(forKey: syncId)
        return true
    }
}
