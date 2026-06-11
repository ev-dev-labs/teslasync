//
//  ChartTimeRangeContext.Model.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for
//  multi-chart cursor sync. Two observable holders live here:
//
//    • CursorSyncStore — the native peer of the web module-level external store
//      (components/charts/cursorSync.ts). Where the web store pairs a `Map<syncId, value>` with a
//      `Set<listener>` and exposes reads through `useSyncExternalStore`, the native store is an
//      `@Observable` keyed map: SwiftUI's observation tracking replaces the manual subscribe/emit, so
//      any view that reads `position(for:)` re-renders when that entry changes — and only then,
//      because the mutators route through `CursorSyncReducer` and skip assignment when unchanged
//      (the parity of the web `if (current === value) return` guard).
//
//    • ChartTimeRangeContextModel — the per-provider view-model bound by `ChartTimeRangeProvider`.
//      It carries the broadcast `syncId` + `syncMethod` (web `ChartSyncContextValue`), exposes the
//      three hook read-models (`syncedCursor`, `referenceLineX`, the context itself), broadcasts a
//      hover into the store (web `useSyncedCursor.onMouseMove → setCursorSyncPosition`), clears its
//      store entry when the provider unmounts (web `clearCursorSync` cleanup), and emits `view.opened`
//      once. No networking lives in the view; the store is the only seam and it is purely in-process.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The web source is an anonymous, transparent provider — it carries no user-facing
/// copy of its own — so the only entries back the DEBUG sample charts used by the previews +
/// view-composition tests; production callers wrap their own already-localized charts. Keys live in
/// the "ChartTimeRangeContext" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the projection deterministic.
public enum ChartTimeRangeStrings {
    public static let table = "ChartTimeRangeContext"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `Text`-friendly overload for SwiftUI call sites.
    public static func text(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ChartTimeRangeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogChartTimeRangeTelemetry: ChartTimeRangeTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - CursorSyncStore (P1/S8) — web cursorSync.ts external store

/// The persistent cursor store keyed by `syncId` — the native peer of the web module-level external
/// store. An `@Observable` map stands in for the web `Map` + listener `Set`: SwiftUI observation is
/// the subscription, and every mutator routes through ``CursorSyncReducer`` so an unchanged write is
/// a true no-op (no observation invalidation), exactly mirroring the web store's early-return guard.
///
/// `shared` is the process-wide instance — the parity of the web module singleton, whose cross-page
/// leakage is impossible by `syncId` choice (and which each provider additionally clears on unmount).
/// Previews + tests inject a fresh instance instead so they never touch global state.
@MainActor
@Observable
public final class CursorSyncStore {
    /// The process-wide store (web module singleton).
    public static let shared = CursorSyncStore()

    /// The cursor value per `syncId`. A missing key means "no cursor" (web `Map.get ?? null`).
    public private(set) var positions: [String: CursorSyncValue] = [:]

    public init() {}

    /// Reads the current cursor value for a `syncId` — web `getCursorSyncPosition` /
    /// `useCursorSyncPosition`. A `nil` id always reads `nil` (web `useCursorSyncPosition(undefined)`).
    public func position(for syncId: String?) -> CursorSyncValue? {
        CursorSyncReducer.position(in: positions, syncId: syncId)
    }

    /// Sets (or, for a `nil` value, clears) the cursor value for a `syncId` — web
    /// `setCursorSyncPosition`. Assigns only when the value actually changes so no observer is
    /// invalidated spuriously on a repeated hover tick (web `if (current === value) return`).
    public func setPosition(_ value: CursorSyncValue?, for syncId: String) {
        var next = positions
        guard CursorSyncReducer.set(&next, syncId: syncId, value: value) else { return }
        positions = next
    }

    /// Drops the entry for a `syncId` — web `clearCursorSync`. No-op (no invalidation) when absent.
    public func clear(_ syncId: String) {
        var next = positions
        guard CursorSyncReducer.clear(&next, syncId: syncId) else { return }
        positions = next
    }

    /// Fully resets the store — the native peer of the web `_resetCursorSyncStore` test helper.
    /// No-op (no invalidation) when already empty.
    public func reset() {
        guard !positions.isEmpty else { return }
        positions = [:]
    }
}

// MARK: - ChartTimeRangeContextModel (P1/S8) — web `ChartTimeRangeProvider` value + hooks

/// The per-provider view-model — the native peer of the web `ChartTimeRangeProvider`'s context value
/// plus the three hooks descendant charts read. It broadcasts a stable `syncId` + `syncMethod`,
/// exposes the persistent reference-line x (`useSyncedReferenceLineX`) and the spread props
/// (`useSyncedCursor`) as observed reads off the shared store, broadcasts a hover into the store
/// (`useSyncedCursor.onMouseMove`), clears its store entry on unmount (the `clearCursorSync` effect
/// cleanup), and emits `view.opened` once.
@MainActor
@Observable
public final class ChartTimeRangeContextModel {
    /// The broadcast context (web `ChartSyncContextValue`).
    public let context: ChartSyncContextValue

    @ObservationIgnored private let store: CursorSyncStore
    @ObservationIgnored private let telemetry: any ChartTimeRangeTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        syncId: String,
        syncMethod: ChartSyncMethod = .index,
        store: CursorSyncStore = .shared,
        telemetry: any ChartTimeRangeTelemetry = OSLogChartTimeRangeTelemetry()
    ) {
        context = ChartSyncContextValue(syncId: syncId, syncMethod: syncMethod)
        self.store = store
        self.telemetry = telemetry
    }

    /// The broadcast `syncId` (web `ctx.syncId`).
    public var syncId: String {
        context.syncId
    }

    /// The broadcast match method (web `ctx.syncMethod`).
    public var syncMethod: ChartSyncMethod {
        context.syncMethod
    }

    /// The props a descendant chart spreads onto its Swift Charts view — web `useSyncedCursor()`.
    public var syncedCursor: SyncedCursorProps {
        SyncedCursorProps(syncId: context.syncId, syncMethod: context.syncMethod)
    }

    /// The persistent reference-line x value — web `useSyncedReferenceLineX()`. Reading it registers
    /// an observation dependency on the store, so a chart redraws when any sibling moves the cursor
    /// (the native parity of the `useSyncExternalStore` subscription).
    public var referenceLineX: CursorSyncValue? {
        store.position(for: context.syncId)
    }

    /// The full resolved read-model bundle (projection of the cached store + this context). Exposed
    /// for tests and for a chart that prefers one read over three.
    public var resolved: ChartTimeRangeResolved {
        ChartTimeRangeProjection.resolve(context: context, positions: store.positions)
    }

    /// Broadcasts a hover x value into the shared store — web `useSyncedCursor.onMouseMove` writing
    /// `activeLabel`. Passing `nil` leaves the persistent line in place (web `onMouseMove` only ever
    /// writes a non-null `activeLabel`; the line survives mouseleave); call ``clearCursor()`` to drop
    /// it explicitly.
    public func moveCursor(to value: CursorSyncValue?) {
        guard let value else { return }
        store.setPosition(value, for: context.syncId)
    }

    /// Drops this provider's persistent cursor (web `setCursorSyncPosition(syncId, null)`).
    public func clearCursor() {
        store.clear(context.syncId)
    }

    /// Begins providing the context and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per provider instance, never again on
    /// a later re-appear (matching the anonymous-primitive `withAiFeature` once-only contract).
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ChartTimeRangeSurface.slug)
        }
    }

    /// Tears the provider down — clears this `syncId`'s persistent cursor so navigating away never
    /// leaks a stale line into the next page (web `ChartTimeRangeProvider`'s unmount
    /// `clearCursorSync(syncId)` effect cleanup).
    public func stop() {
        started = false
        store.clear(context.syncId)
    }
}
