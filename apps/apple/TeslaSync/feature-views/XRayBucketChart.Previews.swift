//
//  XRayBucketChart.Previews.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated bucket
//  histogram), empty (resolved, no buckets → web empty branch), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentXRayBucketTelemetry: XRayBucketChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A realistic 30-second-bucketed ingest window (counts ramping up over ~4 minutes),
    /// so the populated previews carry true `{ bucket_start, count }` buckets.
    private enum XRayBucketPreviewData {
        static var buckets: [XRayBucketInput] {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            let base = Date(timeIntervalSince1970: 1_700_000_000)
            let counts = [142, 318, 276, 503, 689, 471, 392, 188]
            return counts.enumerated().map { offset, count in
                let start = base.addingTimeInterval(Double(offset) * 30)
                return XRayBucketInput(bucketStart: formatter.string(from: start), count: count)
            }
        }
    }

    @MainActor
    private func xrayBucketPreview(_ update: XRayBucketChartUpdate) -> XRayBucketChart {
        XRayBucketChart(
            model: XRayBucketChartModel(
                source: XRayBucketChartInMemorySource(initial: update),
                telemetry: SilentXRayBucketTelemetry()
            )
        )
    }

    #Preview("Content") {
        xrayBucketPreview(
            XRayBucketChartUpdate(status: .loaded, buckets: XRayBucketPreviewData.buckets, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        xrayBucketPreview(XRayBucketChartUpdate(status: .loaded, buckets: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        xrayBucketPreview(XRayBucketChartUpdate(status: .loading, buckets: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        xrayBucketPreview(
            XRayBucketChartUpdate(status: .failed("Request timed out"), buckets: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        xrayBucketPreview(
            XRayBucketChartUpdate(status: .loaded, buckets: XRayBucketPreviewData.buckets, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        xrayBucketPreview(
            XRayBucketChartUpdate(status: .loaded, buckets: XRayBucketPreviewData.buckets, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }
#endif
