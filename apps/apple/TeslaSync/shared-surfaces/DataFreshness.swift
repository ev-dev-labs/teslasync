//
//  DataFreshness.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  The data-freshness chip — the SwiftUI parity of `components/data-display/DataFreshness.tsx`.
//  Renders a tiny status dot + icon + relative-time string ("3m ago", "updating…", "error") that
//  surfaces the health of a query fetch, binding through `DataFreshnessModel` (P1/S8); no networking
//  lives in the view. The chip is always present (the web has no skeleton): every freshness state —
//  fresh / fetching (loading) / refetching / stale / error / offline (errored with a cached value) /
//  empty (never updated) — renders as a variant of the one chip. A periodic timer re-derives the
//  relative label every 30s (the web `setInterval` re-render); Reduce Motion is honoured throughout.
//
//  For per-datum freshness (the timestamp of a specific reading) use `FreshnessIndicator` instead —
//  the same distinction the web source documents between `<DataFreshness>` and `<FreshnessIndicator>`.
//

import Combine
import SwiftUI

// MARK: - DataFreshness (the shared surface)

/// The data-freshness chip — the SwiftUI parity of `components/data-display/DataFreshness.tsx`.
/// Renders every freshness state, binding through `DataFreshnessModel` and re-deriving the
/// relative-time label on a 30s cadence.
public struct DataFreshness: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DataFreshnessMeta.surfaceSlug

    @State private var model: DataFreshnessModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web component re-renders every 30s (a `setInterval`) so the relative label ("3m ago")
    /// stays current. The native parity ticks the model off a main-run-loop timer; `.onReceive`'s
    /// action is a main-actor, non-`@Sendable` closure, so it can call the `@MainActor` model
    /// directly (unlike a `.task` loop, whose `@Sendable` body cannot cross into the actor under
    /// strict concurrency). The publisher only fires while the view is subscribed.
    private let ticker = Timer
        .publish(every: DataFreshnessMeta.tickIntervalSeconds, on: .main, in: .common)
        .autoconnect()

    public init(model: DataFreshnessModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production query-backed source — the parity of mounting
    /// `<DataFreshnessAuto query={…} />`. `input` is the host's current query snapshot (the web
    /// `dataUpdatedAt`/`isFetching`/`isStale`/`isError`); `config` carries the web non-data props
    /// (`compact`, `refetchable`, `forceStaleAfterMs`).
    public init(input: DataFreshnessInput, config: DataFreshnessConfig = .default) {
        _model = State(initialValue: DataFreshnessModel(
            source: LiveDataFreshnessSource(input: input),
            config: config
        ))
    }

    public var body: some View {
        DataFreshnessChip(
            readout: model.resolved,
            helpText: helpText,
            onRefresh: { model.refresh() }
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onReceive(ticker) { _ in model.tick() }
    }

    /// The tooltip — the web `title` with its reduce-motion branch applied at the view boundary:
    /// while a fetch is in flight and Reduce Motion is on (so the spinner/pulse are suppressed) the
    /// tooltip surfaces "Updating…" so pointer + screen-reader users still learn the in-flight state;
    /// otherwise it is the projection's "Last updated: …" / "Never updated" base title.
    private var helpText: String {
        let readout = model.resolved
        if readout.isFetching, reduceMotion {
            return DataFreshnessStrings.string("freshness.updatingTooltip", "Updating…")
        }
        return readout.baseTitle
    }
}
