//
//  SocChart.Previews.swift
//  TeslaSync — P4 feature view · 0148 · SocChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated SOC
//  area trace), empty (resolved, ≤ 1 sample → web "No telemetry data available"
//  overlay), loading (initial skeleton chrome), error (fetch failed → retry), and
//  the stale / offline freshness variants. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSocChartTelemetry: SocChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A descending state-of-charge trace across a drive (with a brief regen bump),
    /// so the populated previews show a representative SOC curve.
    private enum SocChartPreviewData {
        static let readings: [SocReading] = [
            SocReading(time: "12:00", battery: 82),
            SocReading(time: "12:06", battery: 80),
            SocReading(time: "12:12", battery: 77),
            SocReading(time: "12:18", battery: 74),
            SocReading(time: "12:24", battery: 72),
            SocReading(time: "12:30", battery: 73),
            SocReading(time: "12:36", battery: 70),
            SocReading(time: "12:42", battery: 67),
            SocReading(time: "12:48", battery: 64),
            SocReading(time: "12:54", battery: 61)
        ]
    }

    @MainActor
    private func socChartPreview(_ update: SocChartUpdate) -> SocChart {
        SocChart(
            model: SocChartModel(
                source: InMemorySocChartSource(initial: update),
                telemetry: SilentSocChartTelemetry()
            )
        )
    }

    #Preview("Content") {
        socChartPreview(
            SocChartUpdate(status: .loaded, readings: SocChartPreviewData.readings, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        socChartPreview(SocChartUpdate(status: .loaded, readings: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        socChartPreview(SocChartUpdate(status: .loading, readings: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        socChartPreview(
            SocChartUpdate(status: .failed("Request timed out"), readings: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        socChartPreview(
            SocChartUpdate(status: .loaded, readings: SocChartPreviewData.readings, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        socChartPreview(
            SocChartUpdate(status: .loaded, readings: SocChartPreviewData.readings, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
