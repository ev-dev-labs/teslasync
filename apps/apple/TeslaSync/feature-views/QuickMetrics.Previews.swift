//
//  QuickMetrics.Previews.swift
//  TeslaSync — P4 feature view · 0105 · QuickMetrics (Apple)
//
//  Xcode previews — one per state the surface produces: content (the six populated tiles),
//  empty (resolved, no stats → web `EmptyState`), loading (initial skeleton chrome), error
//  (fetch failed → retry), and the stale / offline freshness variants, across USD + EUR
//  currency / locale preferences. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentQuickMetricsTelemetry: QuickMetricsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Representative computed charging stats (web `computeStats` output): 47 sessions split
    /// across home / Supercharger / DC, ~36 h total, ~$612 total cost, ~1,180 kWh added.
    private enum QuickMetricsPreviewData {
        static let stats = QuickMetricsStats(
            totalEnergy: 1180.4,
            totalCost: 612.0,
            totalDuration: 2186,
            homeCount: 31,
            scCount: 12,
            dcCount: 4,
            count: 47
        )
    }

    @MainActor
    private func quickMetricsModel(_ update: QuickMetricsUpdate) -> QuickMetricsModel {
        let model = QuickMetricsModel(
            source: InMemoryQuickMetricsSource(initial: update),
            telemetry: SilentQuickMetricsTelemetry()
        )
        model.start()
        return model
    }

    @MainActor
    private func quickMetricsSurface(_ update: QuickMetricsUpdate) -> some View {
        ScrollView {
            QuickMetrics(model: quickMetricsModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private func loaded(
        currencySymbol: String = "$",
        locale: String? = "en-US",
        connection: QuickMetricsConnection = .live
    ) -> QuickMetricsUpdate {
        QuickMetricsUpdate(
            status: .loaded,
            stats: QuickMetricsPreviewData.stats,
            currencySymbol: currencySymbol,
            precision: 2,
            locale: locale,
            connection: connection,
            updatedAt: Date()
        )
    }

    #Preview("Content · USD") {
        quickMetricsSurface(loaded())
    }

    #Preview("Content · EUR") {
        quickMetricsSurface(loaded(currencySymbol: "€", locale: "de-DE"))
    }

    #Preview("Empty") {
        quickMetricsSurface(QuickMetricsUpdate(status: .empty, stats: nil))
    }

    #Preview("Loading") {
        quickMetricsSurface(QuickMetricsUpdate(status: .loading, stats: nil))
    }

    #Preview("Error") {
        quickMetricsSurface(QuickMetricsUpdate(status: .failed("Request timed out"), stats: nil))
    }

    #Preview("Stale (cached)") {
        quickMetricsSurface(loaded(connection: .stale))
    }

    #Preview("Offline (cached)") {
        quickMetricsSurface(loaded(connection: .offline))
    }
#endif
