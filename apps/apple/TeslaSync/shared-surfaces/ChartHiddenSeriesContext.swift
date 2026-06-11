//
//  ChartHiddenSeriesContext.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  The SwiftUI surface — the parity of components/charts/ChartHiddenSeriesContext.tsx. The web source
//  is a React context (`createContext<HiddenSeriesState | null>(null)`) plus a reader hook and a
//  provider; SwiftUI's idiomatic equivalent of a React context is an Environment value, so this file
//  exposes:
//
//    • EnvironmentValues.chartHiddenSeries — the parity of `useChartHiddenSeries()`. It resolves to the
//      active `HiddenSeriesState`, or `nil` outside a provider / when the chart did not opt into legend
//      toggling (web `useContext(ChartHiddenSeriesContext)` → `null`), so a non-toggling legend keeps
//      working unchanged.
//    • ChartHiddenSeriesProvider — the parity of `<ChartHiddenSeriesProvider chartKey>`. With no
//      `chartKey` (or an empty one) it provides `null` (web `if (!chartKey) return children(null)`);
//      with a `chartKey` it owns the per-chart `HiddenSeriesState`, injects it into the environment for
//      every descendant legend, and emits `view.opened` once. It does NOT clear on unmount — the web
//      hidden set lives in the URL and is meant to survive.
//    • ChartHiddenSeriesReader — the explicit parity of the web render-prop `children(state)`: it reads
//      the context from the environment and hands the resolved `HiddenSeriesState?` to a builder, so a
//      call site can branch on "inside vs. outside a provider" exactly as the web children do.
//    • .chartHiddenSeriesProvider(chartKey:) — the ergonomic, idiomatic-Swift spelling of the same
//      wrap (mirroring the sibling primitive's `.chartTimeRangeProvider(_:)` modifier).
//
//  No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9) and copy resolves
//  through P1/S10. The legend bridge that consumes the context lives in
//  ChartHiddenSeriesContext.Views.swift.
//

import SwiftUI

// MARK: - Environment (web React context `ChartHiddenSeriesContext`)

/// The environment slot carrying the active hidden-series context — the SwiftUI analog of the web
/// `createContext<HiddenSeriesState | null>(null)`. The default is `nil` so a legend outside any
/// provider (or under a chart that did not opt into toggling) resolves exactly as the web
/// `useChartHiddenSeries()` does (`null`).
private struct ChartHiddenSeriesEnvironmentKey: EnvironmentKey {
    static let defaultValue: HiddenSeriesState? = nil
}

public extension EnvironmentValues {
    /// The active hidden-series context (web `useChartHiddenSeries()`) — `nil` outside a
    /// ``ChartHiddenSeriesProvider`` or when the chart did not opt into legend toggling. Descendant
    /// legends read this to toggle a series (`state.toggle(key)`) and dim hidden ones
    /// (`state.isHidden(key)`).
    var chartHiddenSeries: HiddenSeriesState? {
        get { self[ChartHiddenSeriesEnvironmentKey.self] }
        set { self[ChartHiddenSeriesEnvironmentKey.self] = newValue }
    }
}

// MARK: - ChartHiddenSeriesProvider (web `<ChartHiddenSeriesProvider>`)

/// The hidden-series provider — the SwiftUI parity of `ChartHiddenSeriesProvider`. Wrap a chart and
/// its legend in one provider keyed by the chart's stable `chartKey`; every descendant legend then
/// reads the same context from the environment and shares one URL-persisted hidden set. With no
/// `chartKey` the provider injects `nil` (web `children(null)`), so a chart that did not opt into
/// toggling renders unchanged.
public struct ChartHiddenSeriesProvider<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ChartHiddenSeriesSurface.slug
    }

    @State private var model: HiddenSeriesState?
    private let content: Content

    /// Production initializer — the parity of `<ChartHiddenSeriesProvider chartKey>`. A `nil` or empty
    /// `chartKey` opts out (web `if (!chartKey)`), injecting `nil`; a non-empty `chartKey` builds the
    /// per-chart ``HiddenSeriesState`` over `store` (defaulting to the process-wide ``HiddenSeriesStore``).
    public init(
        chartKey: String?,
        store: HiddenSeriesStore = .shared,
        @ViewBuilder content: () -> Content
    ) {
        let resolvedKey = (chartKey?.isEmpty == false) ? chartKey : nil
        _model = State(initialValue: resolvedKey.map { HiddenSeriesState(chartKey: $0, store: store) })
        self.content = content()
    }

    /// Model-injecting initializer — used by previews + tests that drive a fresh ``HiddenSeriesStore``
    /// and want to assert against the bound model (or pass `nil` for the opted-out branch).
    public init(model: HiddenSeriesState?, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: model)
        self.content = content()
    }

    public var body: some View {
        content
            .environment(\.chartHiddenSeries, model)
            .onAppear { model?.start() }
            .onDisappear { model?.stop() }
    }
}

// MARK: - ChartHiddenSeriesReader (web render-prop `children(state)`)

/// Reads the active hidden-series context from the environment and hands the resolved
/// `HiddenSeriesState?` to a builder — the explicit native parity of the web provider's render-prop
/// `children(state)` (which receives the state, or `null`, so the caller can branch on it). Use it
/// when a call site wants the optional state in hand rather than reading `@Environment` directly.
public struct ChartHiddenSeriesReader<Content: View>: View {
    @Environment(\.chartHiddenSeries) private var state
    private let content: (HiddenSeriesState?) -> Content

    public init(@ViewBuilder content: @escaping (HiddenSeriesState?) -> Content) {
        self.content = content
    }

    public var body: some View {
        content(state)
    }
}

// MARK: - View modifier (idiomatic provider spelling)

public extension View {
    /// Wraps `self` in a ``ChartHiddenSeriesProvider`` — the ergonomic, idiomatic-Swift spelling of the
    /// web `<ChartHiddenSeriesProvider>` wrap, mirroring the sibling primitive's
    /// `.chartTimeRangeProvider(_:)` modifier. Every legend inside the receiver shares one
    /// URL-persisted hidden set keyed by `chartKey` (or opts out when `chartKey` is `nil`/empty).
    func chartHiddenSeriesProvider(
        chartKey: String?,
        store: HiddenSeriesStore = .shared
    ) -> some View {
        ChartHiddenSeriesProvider(chartKey: chartKey, store: store) { self }
    }
}
