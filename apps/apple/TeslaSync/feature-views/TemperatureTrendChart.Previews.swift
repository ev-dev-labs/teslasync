//
//  TemperatureTrendChart.Previews.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated trend
//  line with the Warm Zone / Freezing rules), empty (≤ 1 drive → web `null`, surfaced
//  as the friendly empty state), loading (initial skeleton chrome), error (fetch
//  failed → retry), and the stale / offline freshness variants, plus a Fahrenheit
//  content variant to exercise the display-unit conversion. Preview-only; excluded
//  from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTemperatureTrendTelemetry: TemperatureTrendChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample drives across two weeks for the populated previews: a descending ambient
    /// trend with one missing reading (rendered as a gap) so the line, dots, gap, and
    /// both reference rules are all exercised.
    private enum TemperatureTrendPreviewData {
        static let samples: [TemperatureTrendSample] = [
            TemperatureTrendSample(date: "Jun 1", outsideTempC: 31.5),
            TemperatureTrendSample(date: "Jun 3", outsideTempC: 27.0),
            TemperatureTrendSample(date: "Jun 5", outsideTempC: 22.4),
            TemperatureTrendSample(date: "Jun 7", outsideTempC: nil),
            TemperatureTrendSample(date: "Jun 9", outsideTempC: 14.8),
            TemperatureTrendSample(date: "Jun 11", outsideTempC: 6.2),
            TemperatureTrendSample(date: "Jun 13", outsideTempC: -3.1)
        ]
    }

    @MainActor
    private func temperatureTrendPreview(_ update: TemperatureTrendUpdate) -> TemperatureTrendChart {
        TemperatureTrendChart(
            model: TemperatureTrendChartModel(
                source: InMemoryTemperatureTrendSource(initial: update),
                telemetry: SilentTemperatureTrendTelemetry()
            )
        )
    }

    #Preview("Content") {
        temperatureTrendPreview(
            TemperatureTrendUpdate(status: .loaded, samples: TemperatureTrendPreviewData.samples, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Content °F") {
        temperatureTrendPreview(
            TemperatureTrendUpdate(
                status: .loaded,
                samples: TemperatureTrendPreviewData.samples,
                units: TemperatureTrendUnitPrefs(temperature: .fahrenheit),
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        temperatureTrendPreview(
            TemperatureTrendUpdate(
                status: .loaded,
                samples: [TemperatureTrendSample(date: "Jun 13", outsideTempC: 18.0)],
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        temperatureTrendPreview(TemperatureTrendUpdate(status: .loading, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        temperatureTrendPreview(
            TemperatureTrendUpdate(status: .failed("Request timed out"), samples: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        temperatureTrendPreview(
            TemperatureTrendUpdate(status: .loaded, samples: TemperatureTrendPreviewData.samples, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        temperatureTrendPreview(
            TemperatureTrendUpdate(status: .loaded, samples: TemperatureTrendPreviewData.samples, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
