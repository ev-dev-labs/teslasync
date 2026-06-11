//
//  ChartTimeRangeContext.Projection.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  The pure projection from the cached store (the persistent cursor positions) + the active context
//  to the resolved, view-ready state every descendant chart reads — the native port of what the web
//  hooks return: `useChartSync()` (the context or `null`), `useSyncedCursor()` (the props to spread,
//  or `{}` outside a provider), and `useSyncedReferenceLineX()` (the persistent x value, or `null`).
//  The view (and the chart bridge) is a pure function of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  it takes the cached `[syncId: CursorSyncValue]` snapshot plus the in-scope context and derives the
//  three read-models, collapsing the inside/outside-provider branch exactly as the web hooks do.
//

import Foundation

// MARK: - Resolved read-models (web hook return values)

/// The resolved, view-ready projection of the cursor-sync state — the native bundle of the three web
/// hook return values. `context` mirrors `useChartSync()` (`nil` outside a provider), `syncedCursor`
/// mirrors `useSyncedCursor()` (`.inactive` outside a provider), and `referenceLineX` mirrors
/// `useSyncedReferenceLineX()` (`nil` outside a provider or before any chart in the group has been
/// hovered). The chart bridge spreads `syncedCursor` and draws a `RuleMark` whenever
/// `referenceLineX` is non-`nil`.
public struct ChartTimeRangeResolved: Sendable, Equatable {
    /// The active context (web `useChartSync()`), or `nil` outside a provider.
    public let context: ChartSyncContextValue?
    /// The props a chart spreads (web `useSyncedCursor()`), `.inactive` outside a provider.
    public let syncedCursor: SyncedCursorProps
    /// The persistent reference-line x value (web `useSyncedReferenceLineX()`), or `nil`.
    public let referenceLineX: CursorSyncValue?

    public init(
        context: ChartSyncContextValue?,
        syncedCursor: SyncedCursorProps,
        referenceLineX: CursorSyncValue?
    ) {
        self.context = context
        self.syncedCursor = syncedCursor
        self.referenceLineX = referenceLineX
    }

    /// `true` when a provider is in scope (web `ctx != null`).
    public var isWithinProvider: Bool {
        context != nil
    }

    /// `true` when a persistent reference line should be drawn (web `syncedX != null`).
    public var hasReferenceLine: Bool {
        referenceLineX != nil
    }

    /// The "outside a provider" projection — every read-model empty (web hooks return
    /// `null` / `{}` / `null`). A standalone chart resolves to this and renders unchanged.
    public static let standalone = ChartTimeRangeResolved(
        context: nil,
        syncedCursor: .inactive,
        referenceLineX: nil
    )
}

// MARK: - Projection (cached store + context → resolved)

/// Pure projection from the cached cursor positions + the in-scope context to the resolved
/// read-models. Outside a provider (`context == nil`) it returns ``ChartTimeRangeResolved/standalone``
/// (web `useChartSync` → `null`, `useSyncedCursor` → `{}`, `useSyncedReferenceLineX` → `null`).
/// Inside a provider it derives the spread props from the context and reads the persistent x value
/// for the context's `syncId` out of the cached map (web `useCursorSyncPosition(ctx.syncId)`).
public enum ChartTimeRangeProjection {
    public static func resolve(
        context: ChartSyncContextValue?,
        positions: [String: CursorSyncValue]
    ) -> ChartTimeRangeResolved {
        guard let context else { return .standalone }
        let cursor = SyncedCursorProps(syncId: context.syncId, syncMethod: context.syncMethod)
        let referenceLineX = CursorSyncReducer.position(in: positions, syncId: context.syncId)
        return ChartTimeRangeResolved(
            context: context,
            syncedCursor: cursor,
            referenceLineX: referenceLineX
        )
    }
}
