//
//  SentryModeChart.Previews.swift
//  TeslaSync — P4 feature view · 0047 · SentryModeChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  stacked chart), empty (resolved, no days → web `EmptyState`), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSentryModeTelemetry: SentryModeChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample week of day buckets for the populated previews.
    private enum SentryModePreviewData {
        static let buckets: [SentryDayBucket] = [
            SentryDayBucket(date: "2026-05-31", sentryOn: 8, sentryOff: 2),
            SentryDayBucket(date: "2026-06-01", sentryOn: 12, sentryOff: 4),
            SentryDayBucket(date: "2026-06-02", sentryOn: 6, sentryOff: 9),
            SentryDayBucket(date: "2026-06-03", sentryOn: 15, sentryOff: 1),
            SentryDayBucket(date: "2026-06-04", sentryOn: 10, sentryOff: 5),
            SentryDayBucket(date: "2026-06-05", sentryOn: 13, sentryOff: 3),
            SentryDayBucket(date: "2026-06-06", sentryOn: 4, sentryOff: 7)
        ]
    }

    @MainActor
    private func sentryModePreview(_ update: SentryModeUpdate) -> SentryModeChart {
        SentryModeChart(
            model: SentryModeChartModel(
                source: InMemorySentryModeSource(initial: update),
                telemetry: SilentSentryModeTelemetry()
            )
        )
    }

    #Preview("Content") {
        sentryModePreview(
            SentryModeUpdate(status: .loaded, buckets: SentryModePreviewData.buckets, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        sentryModePreview(SentryModeUpdate(status: .loaded, buckets: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        sentryModePreview(SentryModeUpdate(status: .loading, buckets: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        sentryModePreview(
            SentryModeUpdate(status: .failed("Request timed out"), buckets: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        sentryModePreview(
            SentryModeUpdate(status: .loaded, buckets: SentryModePreviewData.buckets, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        sentryModePreview(
            SentryModeUpdate(status: .loaded, buckets: SentryModePreviewData.buckets, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
