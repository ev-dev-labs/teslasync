//
//  CostPerKwhChart.Previews.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  trend), single-point (degenerate line), empty (resolved, no samples → web
//  `noData`), loading (initial skeleton chrome), error (fetch failed → retry), and
//  the stale / offline freshness variants. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentCostPerKwhTelemetry: CostPerKwhTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample trend rows for the populated previews (web `costPerKwhTrend`).
    private enum CostPerKwhPreviewData {
        static let trend: [CostPerKwhSample] = [
            CostPerKwhSample(date: "Jan 01", costPerKwh: 0.124),
            CostPerKwhSample(date: "Jan 08", costPerKwh: 0.131),
            CostPerKwhSample(date: "Jan 15", costPerKwh: 0.118),
            CostPerKwhSample(date: "Jan 22", costPerKwh: 0.142),
            CostPerKwhSample(date: "Jan 29", costPerKwh: 0.137),
            CostPerKwhSample(date: "Feb 05", costPerKwh: 0.129),
            CostPerKwhSample(date: "Feb 12", costPerKwh: 0.151),
            CostPerKwhSample(date: "Feb 19", costPerKwh: 0.146)
        ]

        static let single: [CostPerKwhSample] = [
            CostPerKwhSample(date: "Jan 01", costPerKwh: 0.133)
        ]
    }

    @MainActor
    private func costPerKwhPreview(_ update: CostPerKwhUpdate) -> CostPerKwhChart {
        CostPerKwhChart(
            model: CostPerKwhModel(
                source: InMemoryCostPerKwhSource(initial: update),
                telemetry: SilentCostPerKwhTelemetry()
            )
        )
    }

    #Preview("Content") {
        costPerKwhPreview(
            CostPerKwhUpdate(status: .loaded, samples: CostPerKwhPreviewData.trend, connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Single point") {
        costPerKwhPreview(
            CostPerKwhUpdate(status: .loaded, samples: CostPerKwhPreviewData.single, connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Empty") {
        costPerKwhPreview(CostPerKwhUpdate(status: .loaded, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Loading") {
        costPerKwhPreview(CostPerKwhUpdate(status: .loading, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Error") {
        costPerKwhPreview(
            CostPerKwhUpdate(status: .failed("Request timed out"), samples: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Stale") {
        costPerKwhPreview(
            CostPerKwhUpdate(status: .loaded, samples: CostPerKwhPreviewData.trend, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Offline") {
        costPerKwhPreview(
            CostPerKwhUpdate(status: .loaded, samples: CostPerKwhPreviewData.trend, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 560)
    }
#endif
