//
//  SpeedHistogramChart.Previews.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  histogram + data table), empty (resolved, no buckets → web empty branch), loading
//  (initial skeleton chrome), error (fetch failed → retry), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSpeedHistogramTelemetry: SpeedHistogramChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A realistic city+highway speed trace, bucketed through the same canonical
    /// projection the drive-detail hook (`useDriveDetailData`) uses, so the populated
    /// previews carry true `{ range, pct }` buckets.
    private enum SpeedHistogramPreviewData {
        static let speeds: [Double] = {
            var samples: [Double] = []
            samples += Array(repeating: 12, count: 8) // 0–20
            samples += Array(repeating: 30, count: 14) // 20–40
            samples += Array(repeating: 52, count: 26) // 40–60
            samples += Array(repeating: 68, count: 22) // 60–80
            samples += Array(repeating: 92, count: 12) // 80–100
            samples += Array(repeating: 110, count: 6) // 100–120
            samples += Array(repeating: 128, count: 2) // 120+
            return samples
        }()

        static var buckets: [SpeedHistogramBucketInput] {
            SpeedHistogramChartProjection.buckets(fromSamples: speeds, locale: Locale(identifier: "en_US"))
        }
    }

    @MainActor
    private func speedHistogramPreview(_ update: SpeedHistogramChartUpdate) -> SpeedHistogramChart {
        SpeedHistogramChart(
            model: SpeedHistogramChartModel(
                source: SpeedHistogramChartInMemorySource(initial: update),
                telemetry: SilentSpeedHistogramTelemetry()
            )
        )
    }

    #Preview("Content") {
        speedHistogramPreview(
            SpeedHistogramChartUpdate(status: .loaded, buckets: SpeedHistogramPreviewData.buckets, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        speedHistogramPreview(SpeedHistogramChartUpdate(status: .loaded, buckets: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        speedHistogramPreview(SpeedHistogramChartUpdate(status: .loading, buckets: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        speedHistogramPreview(
            SpeedHistogramChartUpdate(status: .failed("Request timed out"), buckets: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        speedHistogramPreview(
            SpeedHistogramChartUpdate(status: .loaded, buckets: SpeedHistogramPreviewData.buckets, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        speedHistogramPreview(
            SpeedHistogramChartUpdate(status: .loaded, buckets: SpeedHistogramPreviewData.buckets, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
