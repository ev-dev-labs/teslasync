//
//  MonthlyCostChart.Previews.swift
//  TeslaSync — P4 feature view · 0116 · MonthlyCostChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  trend), annotated (content with a vehicle-annotation line), single-point
//  (degenerate area), empty (resolved, no buckets → web `noData`), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentMonthlyCostTelemetry: MonthlyCostTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample monthly buckets for the populated previews (web monthly `data`).
    private enum MonthlyCostPreviewData {
        static let trend: [MonthlyCostSample] = [
            MonthlyCostSample(month: "2025-08", cost: 84.20),
            MonthlyCostSample(month: "2025-09", cost: 102.55),
            MonthlyCostSample(month: "2025-10", cost: 76.90),
            MonthlyCostSample(month: "2025-11", cost: 118.40),
            MonthlyCostSample(month: "2025-12", cost: 134.05),
            MonthlyCostSample(month: "2026-01", cost: 97.30),
            MonthlyCostSample(month: "2026-02", cost: 88.75),
            MonthlyCostSample(month: "2026-03", cost: 109.60)
        ]

        static let single: [MonthlyCostSample] = [
            MonthlyCostSample(month: "2026-03", cost: 109.60)
        ]

        static let annotations: [MonthlyCostAnnotation] = [
            MonthlyCostAnnotation(month: "2025-11", label: "Rate change")
        ]
    }

    @MainActor
    private func monthlyCostPreview(_ update: MonthlyCostUpdate) -> MonthlyCostChart {
        MonthlyCostChart(
            model: MonthlyCostModel(
                source: InMemoryMonthlyCostSource(initial: update),
                telemetry: SilentMonthlyCostTelemetry()
            )
        )
    }

    #Preview("Content") {
        monthlyCostPreview(
            MonthlyCostUpdate(status: .loaded, samples: MonthlyCostPreviewData.trend, connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Annotated") {
        monthlyCostPreview(
            MonthlyCostUpdate(
                status: .loaded,
                samples: MonthlyCostPreviewData.trend,
                vehicleID: 1,
                annotations: MonthlyCostPreviewData.annotations,
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Single point") {
        monthlyCostPreview(
            MonthlyCostUpdate(status: .loaded, samples: MonthlyCostPreviewData.single, connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Empty") {
        monthlyCostPreview(MonthlyCostUpdate(status: .loaded, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Loading") {
        monthlyCostPreview(MonthlyCostUpdate(status: .loading, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Error") {
        monthlyCostPreview(
            MonthlyCostUpdate(status: .failed("Request timed out"), samples: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Stale") {
        monthlyCostPreview(
            MonthlyCostUpdate(status: .loaded, samples: MonthlyCostPreviewData.trend, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Offline") {
        monthlyCostPreview(
            MonthlyCostUpdate(status: .loaded, samples: MonthlyCostPreviewData.trend, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 560)
    }
#endif
