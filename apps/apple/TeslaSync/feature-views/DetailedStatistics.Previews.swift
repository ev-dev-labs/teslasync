//
//  DetailedStatistics.Previews.swift
//  TeslaSync — P4 feature view · 0101 · DetailedStatistics (Apple)
//
//  Xcode previews — one per state the surface produces: content (the six populated tiles), empty
//  (resolved, no sessions), loading (initial skeleton chrome), error (fetch failed → retry), and
//  the stale / offline freshness variants, across USD + EUR currency / locale preferences.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentDetailedStatisticsTelemetry: DetailedStatisticsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Representative computed charging stats (web `computeStats` / `computeEnhancedStats` output):
    /// 47 sessions, ~48.6 kW mean peak power, ~$612 total cost, ~$0.143/kWh blended, ~46 min mean
    /// duration, most commonly a Tesla Supercharger (18 sessions).
    private enum DetailedStatisticsPreviewData {
        static let stats = DetailedStatisticsStats(
            count: 47,
            avgPower: 48.6,
            totalCost: 612.0,
            avgCostPerKwh: 0.1427
        )
        static let enhanced = DetailedStatisticsEnhanced(
            avgDuration: 46.4,
            mostCommonTypeName: "Tesla Supercharger",
            mostCommonTypeCount: 18
        )
    }

    @MainActor
    private func detailedStatisticsModel(_ update: DetailedStatisticsUpdate) -> DetailedStatisticsModel {
        let model = DetailedStatisticsModel(
            source: InMemoryDetailedStatisticsSource(initial: update),
            telemetry: SilentDetailedStatisticsTelemetry()
        )
        model.start()
        return model
    }

    @MainActor
    private func detailedStatisticsSurface(_ update: DetailedStatisticsUpdate) -> some View {
        ScrollView {
            DetailedStatistics(model: detailedStatisticsModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private func loaded(
        currencySymbol: String = "$",
        locale: String? = "en-US",
        connection: DetailedStatisticsConnection = .live
    ) -> DetailedStatisticsUpdate {
        DetailedStatisticsUpdate(
            status: .loaded,
            stats: DetailedStatisticsPreviewData.stats,
            enhanced: DetailedStatisticsPreviewData.enhanced,
            currencySymbol: currencySymbol,
            precision: 2,
            locale: locale,
            connection: connection,
            updatedAt: Date()
        )
    }

    #Preview("Content · USD") {
        detailedStatisticsSurface(loaded())
    }

    #Preview("Content · EUR") {
        detailedStatisticsSurface(loaded(currencySymbol: "€", locale: "de-DE"))
    }

    #Preview("Empty") {
        detailedStatisticsSurface(DetailedStatisticsUpdate(status: .empty, stats: nil, enhanced: nil))
    }

    #Preview("Loading") {
        detailedStatisticsSurface(DetailedStatisticsUpdate(status: .loading, stats: nil, enhanced: nil))
    }

    #Preview("Error") {
        detailedStatisticsSurface(
            DetailedStatisticsUpdate(status: .failed("Request timed out"), stats: nil, enhanced: nil)
        )
    }

    #Preview("Stale (cached)") {
        detailedStatisticsSurface(loaded(connection: .stale))
    }

    #Preview("Offline (cached)") {
        detailedStatisticsSurface(loaded(connection: .offline))
    }
#endif
