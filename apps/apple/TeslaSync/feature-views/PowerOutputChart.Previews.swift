//
//  PowerOutputChart.Previews.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (overlaid peak/regen
//  areas), empty (≤1 drive → friendly state), loading (initial skeleton chrome), error
//  (fetch failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentPowerOutputTelemetry: PowerOutputTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample drives for the populated previews: a fortnight of drives with a varying peak
    /// (kW ↑) and a modest regen recovery (kW ↓), exercising both overlaid traces and the
    /// y=0 reference line.
    private enum PowerOutputPreviewData {
        static func date(_ month: Int, _ day: Int) -> Date {
            var components = DateComponents()
            components.year = 2026
            components.month = month
            components.day = day
            components.hour = 9
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
            return calendar.date(from: components) ?? Date()
        }

        /// One sample drive: peak watts (positive) + regen watts (negative).
        private struct Sample {
            let day: Int
            let peakW: Double
            let regenW: Double
        }

        private static let samples: [Sample] = [
            Sample(day: 1, peakW: 82000, regenW: -28000),
            Sample(day: 2, peakW: 94500, regenW: -31000),
            Sample(day: 3, peakW: 110_000, regenW: -22500),
            Sample(day: 4, peakW: 76000, regenW: -36000),
            Sample(day: 5, peakW: 132_000, regenW: -19000),
            Sample(day: 6, peakW: 98000, regenW: -41000),
            Sample(day: 7, peakW: 121_000, regenW: -27000),
            Sample(day: 8, peakW: 145_000, regenW: -33500),
            Sample(day: 9, peakW: 88000, regenW: -24000),
            Sample(day: 10, peakW: 156_000, regenW: -38000),
            Sample(day: 11, peakW: 102_000, regenW: -29500),
            Sample(day: 12, peakW: 134_000, regenW: -21000)
        ]

        static let points: [PowerOutputPoint] = samples.enumerated().map { index, sample in
            PowerOutputPoint(
                id: index + 1,
                date: date(6, sample.day),
                peakPowerW: sample.peakW,
                regenPowerW: sample.regenW
            )
        }

        /// A single drive — the web `data.length <= 1` empty trigger.
        static let single: [PowerOutputPoint] = [points[0]]
    }

    @MainActor
    private func powerOutputPreview(_ update: PowerOutputUpdate) -> PowerOutputChart {
        PowerOutputChart(
            model: PowerOutputChartModel(
                source: InMemoryPowerOutputSource(initial: update),
                telemetry: SilentPowerOutputTelemetry(),
                locale: Locale(identifier: "en_US_POSIX"),
                timeZone: TimeZone(identifier: "UTC") ?? .current
            )
        )
    }

    #Preview("Content") {
        powerOutputPreview(
            PowerOutputUpdate(status: .loaded, points: PowerOutputPreviewData.points, connection: .live)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        powerOutputPreview(
            PowerOutputUpdate(status: .loaded, points: PowerOutputPreviewData.single, connection: .live)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        powerOutputPreview(PowerOutputUpdate(status: .loading, points: [], connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        powerOutputPreview(
            PowerOutputUpdate(status: .failed("Request timed out"), points: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        powerOutputPreview(
            PowerOutputUpdate(status: .loaded, points: PowerOutputPreviewData.points, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        powerOutputPreview(
            PowerOutputUpdate(status: .loaded, points: PowerOutputPreviewData.points, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 520)
    }
#endif
