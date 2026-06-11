//
//  ChartTimeRangeContext.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  The SwiftUI surface — the parity of components/charts/ChartTimeRangeContext.tsx. The web source is
//  a React context provider plus three hooks; SwiftUI's idiomatic equivalent of a React context is an
//  Environment value, so this file exposes:
//
//    • EnvironmentValues.chartSyncContext — the parity of `useChartSync()`. It resolves to the active
//      `ChartTimeRangeContextModel`, or `nil` outside a provider (web `useContext(Ctx)` → `null`), so
//      a standalone chart keeps working unchanged.
//    • ChartTimeRangeProvider — the parity of `<ChartTimeRangeProvider syncId syncMethod>`. It owns
//      the per-provider model, injects it into the environment for every descendant chart, and clears
//      its persistent cursor when it unmounts (the web `clearCursorSync(syncId)` effect cleanup).
//    • .chartTimeRangeProvider(syncId:syncMethod:) — the ergonomic, idiomatic-Swift spelling of the
//      same wrap (mirroring the sibling primitive's `.withAiFeature(_:)` modifier).
//
//  The other two hooks map to reads off the environment model: `useSyncedCursor()` is
//  `model.syncedCursor` (the spread props) plus `model.moveCursor(to:)` (the `onMouseMove` broadcast),
//  and `useSyncedReferenceLineX()` is `model.referenceLineX`. The chart bridge that turns those into a
//  `.chartXSelection` + a `RuleMark` lives in ChartTimeRangeContext.Views.swift. No networking, no
//  Tailwind ports, no raw hex — chrome is token-driven (P1/S9) and copy resolves through P1/S10.
//

import SwiftUI

// MARK: - Environment (web React context `Ctx`)

/// The environment slot carrying the active chart-sync context — the SwiftUI analog of the web
/// `createContext<ChartSyncContextValue | null>(null)`. The default is `nil` so a chart outside any
/// provider resolves exactly as the web `useChartSync()` does (`null`).
private struct ChartSyncContextEnvironmentKey: EnvironmentKey {
    static let defaultValue: ChartTimeRangeContextModel? = nil
}

public extension EnvironmentValues {
    /// The active chart-sync context (web `useChartSync()`) — `nil` outside a
    /// ``ChartTimeRangeProvider``. Descendant charts read this to spread `model.syncedCursor`,
    /// broadcast hovers via `model.moveCursor(to:)`, and draw the persistent reference line at
    /// `model.referenceLineX`.
    var chartSyncContext: ChartTimeRangeContextModel? {
        get { self[ChartSyncContextEnvironmentKey.self] }
        set { self[ChartSyncContextEnvironmentKey.self] = newValue }
    }
}

// MARK: - ChartTimeRangeProvider (web `<ChartTimeRangeProvider>`)

/// The shared cursor-sync provider — the SwiftUI parity of `ChartTimeRangeProvider`. Wrap a page's
/// stacked time-series charts in one provider; every descendant chart then reads the same context
/// from the environment and shares a single persistent cursor. The provider clears its `syncId`'s
/// stored cursor when it unmounts so navigating between pages never leaks a stale reference line.
public struct ChartTimeRangeProvider<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ChartTimeRangeSurface.slug
    }

    @State private var model: ChartTimeRangeContextModel
    private let content: Content

    /// Production initializer — the parity of `<ChartTimeRangeProvider syncId syncMethod>`. `syncId`
    /// is the stable, page-scoped identifier; `syncMethod` defaults to `.index` (fastest path, safe
    /// when all charts share one dataset). `store` defaults to the process-wide ``CursorSyncStore``.
    public init(
        syncId: String,
        syncMethod: ChartSyncMethod = .index,
        store: CursorSyncStore = .shared,
        @ViewBuilder content: () -> Content
    ) {
        _model = State(initialValue: ChartTimeRangeContextModel(
            syncId: syncId,
            syncMethod: syncMethod,
            store: store
        ))
        self.content = content()
    }

    /// Model-injecting initializer — used by previews + tests that drive a fresh ``CursorSyncStore``
    /// and want to assert against the bound model.
    public init(model: ChartTimeRangeContextModel, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: model)
        self.content = content()
    }

    public var body: some View {
        content
            .environment(\.chartSyncContext, model)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - View modifier (idiomatic provider spelling)

public extension View {
    /// Wraps `self` in a ``ChartTimeRangeProvider`` — the ergonomic, idiomatic-Swift spelling of the
    /// web `<ChartTimeRangeProvider>` wrap, mirroring the sibling primitive's `.withAiFeature(_:)`
    /// modifier. Every chart inside the receiver shares one persistent cursor keyed by `syncId`.
    func chartTimeRangeProvider(
        syncId: String,
        syncMethod: ChartSyncMethod = .index,
        store: CursorSyncStore = .shared
    ) -> some View {
        ChartTimeRangeProvider(syncId: syncId, syncMethod: syncMethod, store: store) { self }
    }
}
