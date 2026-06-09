//
//  TimeOfUseAnalysis.Previews.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  Xcode previews — one per state the surface produces: content (a full 24-hour
//  profile), insights-empty (hours present but no sessions → web `noInsights`), empty
//  (resolved, no hours → web `noData`), loading (initial skeleton chrome), error
//  (fetch failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTimeOfUseTelemetry: TimeOfUseTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample hourly buckets for the populated previews (web `hourlyData`).
    private enum TimeOfUsePreviewData {
        private static let sessions: [Int] = [
            3, 2, 1, 0, 1, 2,
            4, 6, 5, 4, 3, 4,
            5, 6, 8, 7, 9, 10,
            8, 6, 5, 7, 9, 6
        ]
        private static let avgCosts: [Double] = [
            0.092, 0.090, 0.085, 0.084, 0.101, 0.112,
            0.140, 0.151, 0.163, 0.172, 0.181, 0.194,
            0.221, 0.243, 0.312, 0.331, 0.352, 0.344,
            0.212, 0.164, 0.142, 0.121, 0.103, 0.099
        ]

        static func label(_ hour: Int) -> String {
            String(format: "%02d:00", hour)
        }

        static let hours: [TimeOfUseHourSample] = (0 ..< 24).map { hour in
            TimeOfUseHourSample(
                hour: hour,
                label: label(hour),
                sessions: sessions[hour],
                avgCost: avgCosts[hour],
                totalEnergy: Double(sessions[hour]) * 11.5
            )
        }

        /// Hours present but every count is zero — exercises the `noInsights` branch.
        static let zeroSessionHours: [TimeOfUseHourSample] = (0 ..< 24).map { hour in
            TimeOfUseHourSample(hour: hour, label: label(hour), sessions: 0, avgCost: 0, totalEnergy: 0)
        }
    }

    @MainActor
    private func timeOfUsePreview(_ update: TimeOfUseUpdate) -> TimeOfUseAnalysis {
        TimeOfUseAnalysis(
            model: TimeOfUseModel(
                source: InMemoryTimeOfUseSource(initial: update),
                telemetry: SilentTimeOfUseTelemetry()
            )
        )
    }

    #Preview("Content") {
        timeOfUsePreview(
            TimeOfUseUpdate(status: .loaded, hours: TimeOfUsePreviewData.hours, connection: .live)
        )
        .padding()
        .frame(maxWidth: 720)
    }

    #Preview("No insights") {
        timeOfUsePreview(
            TimeOfUseUpdate(status: .loaded, hours: TimeOfUsePreviewData.zeroSessionHours, connection: .live)
        )
        .padding()
        .frame(maxWidth: 720)
    }

    #Preview("Empty") {
        timeOfUsePreview(TimeOfUseUpdate(status: .loaded, hours: [], connection: .live))
            .padding()
            .frame(maxWidth: 720)
    }

    #Preview("Loading") {
        timeOfUsePreview(TimeOfUseUpdate(status: .loading, hours: [], connection: .live))
            .padding()
            .frame(maxWidth: 720)
    }

    #Preview("Error") {
        timeOfUsePreview(
            TimeOfUseUpdate(status: .failed("Request timed out"), hours: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 720)
    }

    #Preview("Stale") {
        timeOfUsePreview(
            TimeOfUseUpdate(status: .loaded, hours: TimeOfUsePreviewData.hours, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 720)
    }

    #Preview("Offline") {
        timeOfUsePreview(
            TimeOfUseUpdate(status: .loaded, hours: TimeOfUsePreviewData.hours, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 720)
    }
#endif
