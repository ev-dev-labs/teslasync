//
//  ChartHiddenSeriesContext.Model.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  chart hidden-series bridge. Two observable holders live here:
//
//    • HiddenSeriesStore — the native peer of the web URL store. Where the web persists the hidden set
//      per chart in the query string via `useHiddenSeries(chartKey)` → `useUrlArray` (read through
//      react-router's `useSearchParams`), the native store is an `@Observable` map keyed by `chartKey`.
//      SwiftUI's observation tracking replaces the router subscription: any view that reads
//      `hidden(for:)` re-renders when that chart's set changes — and only then, because the mutators
//      skip the write when the set is unchanged (the parity of `useUrlState`'s stable-identity guard)
//      and DROP the entry when the set goes empty (the parity of `omitDefault` clearing the param).
//      The shareable deep-link is preserved by `queryValue(for:)` / `apply(queryValue:for:)`, the
//      round-trip through the same `?hidden_{chartKey}=…` representation the web URL carries.
//
//    • HiddenSeriesState — the per-provider value bound by `ChartHiddenSeriesProvider`, the native peer
//      of the web `HiddenSeriesState` (what `useHiddenSeries` returns and the context stores). It pins
//      one `chartKey`, exposes the hidden set + `isHidden` / `toggle` / `reset` over the store, and
//      emits `view.opened` once. Unlike the cursor-sync sibling it does NOT clear on unmount: the web
//      hidden set lives in the URL precisely so it survives a reload and is carried by a shared link,
//      so the native `stop()` only ends the provider — it never drops the set. No networking lives in
//      the view; the store is the only seam and it is purely in-process.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The web source is an anonymous, transparent provider — it carries no user-facing
/// copy of its own — so the only entries back the legend chip the DEBUG sample + the view-composition
/// tests render; production callers wrap their own already-localized legends. Keys live in the
/// "ChartHiddenSeriesContext" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the projection deterministic.
public enum ChartHiddenSeriesStrings {
    public static let table = "ChartHiddenSeriesContext"

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
public protocol ChartHiddenSeriesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogChartHiddenSeriesTelemetry: ChartHiddenSeriesTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - HiddenSeriesStore (P1/S8) — web useHiddenSeries URL store

/// The hidden-series store keyed by `chartKey` — the native peer of the web URL-backed store. An
/// `@Observable` map stands in for the query string: SwiftUI observation is the subscription, every
/// mutator skips an unchanged write (no spurious invalidation), and an empty set drops the entry (the
/// parity of `omitDefault` removing `?hidden_{chartKey}` from the URL).
///
/// `shared` is the process-wide instance — the parity of the single browser URL; previews + tests
/// inject a fresh instance instead so they never touch global state.
@MainActor
@Observable
public final class HiddenSeriesStore {
    /// The process-wide store (web singular browser URL).
    public static let shared = HiddenSeriesStore()

    /// The hidden set per `chartKey`. A missing key means "nothing hidden" (web param absent).
    public private(set) var hiddenByKey: [String: Set<String>] = [:]

    public init() {}

    /// Reads the hidden set for a chart — web `useHiddenSeries(chartKey).hidden`. A chart with no
    /// stored entry reads the empty set (web param absent → `new Set([])`).
    public func hidden(for chartKey: String) -> Set<String> {
        hiddenByKey[chartKey] ?? []
    }

    /// Whether a series is hidden for a chart — web `isHidden(seriesKey)`.
    public func isHidden(_ seriesKey: String, for chartKey: String) -> Bool {
        HiddenSeriesReducer.isHidden(hidden(for: chartKey), seriesKey)
    }

    /// Replaces the hidden set for a chart. Assigns only when the set actually changes so no observer
    /// is invalidated spuriously, and DROPS the entry when the set is empty so the chart's "no hidden
    /// series" state matches the web dropped-param canonical form (`omitDefault`).
    public func setHidden(_ hidden: Set<String>, for chartKey: String) {
        let current = hiddenByKey[chartKey] ?? []
        guard current != hidden else { return }
        if hidden.isEmpty {
            hiddenByKey.removeValue(forKey: chartKey)
        } else {
            hiddenByKey[chartKey] = hidden
        }
    }

    /// Toggles one series for a chart — web `toggle(seriesKey)`. Routes through the shared set algebra
    /// then stores, so toggling the last hidden series back on drops the entry.
    public func toggle(_ seriesKey: String, for chartKey: String) {
        setHidden(HiddenSeriesReducer.toggle(hidden(for: chartKey), seriesKey), for: chartKey)
    }

    /// Clears every hidden flag for a chart — web `reset()` (drops `?hidden_{chartKey}`). No-op (no
    /// invalidation) when the chart already has nothing hidden.
    public func reset(_ chartKey: String) {
        setHidden([], for: chartKey)
    }

    /// The shareable deep-link value for a chart (`nil` when nothing is hidden) — the URL value the
    /// web carries. Pair with ``apply(queryValue:for:)`` to round-trip a pasted link.
    public func queryValue(for chartKey: String) -> String? {
        HiddenSeriesParam.encode(hidden(for: chartKey))
    }

    /// Restores a chart's hidden set from a deep-link value — the parity of opening a shared URL with
    /// `?hidden_{chartKey}=…` already set. A `nil` / empty value clears the chart.
    public func apply(queryValue raw: String?, for chartKey: String) {
        setHidden(HiddenSeriesParam.decode(raw), for: chartKey)
    }

    /// The resolved read-model for a chart (projection of the cached set).
    public func resolved(for chartKey: String) -> HiddenSeriesResolved {
        ChartHiddenSeriesProjection.resolve(chartKey: chartKey, hidden: hidden(for: chartKey))
    }

    /// Fully resets the store — a test/preview helper. No-op (no invalidation) when already empty.
    public func resetAll() {
        guard !hiddenByKey.isEmpty else { return }
        hiddenByKey = [:]
    }
}

// MARK: - HiddenSeriesState (P1/S8) — web `HiddenSeriesState` (useHiddenSeries return + context value)

/// The per-provider value — the native peer of the web `HiddenSeriesState` that `useHiddenSeries`
/// returns and `ChartHiddenSeriesContext` stores. It pins one `chartKey`, exposes the hidden set and
/// the `isHidden` / `toggle` / `reset` operations over the shared store, surfaces the canonical
/// ordering + deep-link value, and emits `view.opened` once. Reading `hidden` (or `isHidden`) inside a
/// view body registers an observation dependency on the store, so a legend redraws when a sibling
/// toggles a series (the native parity of the URL re-render).
@MainActor
@Observable
public final class HiddenSeriesState {
    /// The chart this state is bound to (web `chartKey`).
    public let chartKey: String

    @ObservationIgnored private let store: HiddenSeriesStore
    @ObservationIgnored private let telemetry: any ChartHiddenSeriesTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        chartKey: String,
        store: HiddenSeriesStore = .shared,
        telemetry: any ChartHiddenSeriesTelemetry = OSLogChartHiddenSeriesTelemetry()
    ) {
        self.chartKey = chartKey
        self.store = store
        self.telemetry = telemetry
    }

    /// The set of series `dataKey`s currently hidden for this chart (web `HiddenSeriesState.hidden`).
    public var hidden: Set<String> {
        store.hidden(for: chartKey)
    }

    /// Whether a given series is hidden (web `HiddenSeriesState.isHidden`).
    public func isHidden(_ seriesKey: String) -> Bool {
        store.isHidden(seriesKey, for: chartKey)
    }

    /// Toggles a series' visibility (web `HiddenSeriesState.toggle`).
    public func toggle(_ seriesKey: String) {
        store.toggle(seriesKey, for: chartKey)
    }

    /// Clears every hidden flag (web `HiddenSeriesState.reset` — drops `?hidden_{chartKey}`).
    public func reset() {
        store.reset(chartKey)
    }

    /// The canonical, sorted hidden keys (the URL ordering).
    public var sortedHidden: [String] {
        HiddenSeriesParam.canonical(hidden)
    }

    /// The shareable deep-link value for this chart (`nil` when nothing is hidden).
    public var queryValue: String? {
        store.queryValue(for: chartKey)
    }

    /// The full resolved read-model (projection of the cached set + this chartKey).
    public var resolved: HiddenSeriesResolved {
        store.resolved(for: chartKey)
    }

    /// Begins providing the context and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per provider instance, never again on a
    /// later re-appear (matching the sibling coordination primitives' once-only contract).
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ChartHiddenSeriesSurface.slug)
        }
    }

    /// Ends the provider. Deliberately does NOT clear the hidden set: the web state lives in the URL
    /// so it survives a reload and is carried by a shared deep-link, so navigating away must leave the
    /// toggle intact for the next mount of the same chart (the faithful difference from the cursor-sync
    /// sibling, which clears its transient cursor on unmount).
    public func stop() {
        started = false
    }
}
