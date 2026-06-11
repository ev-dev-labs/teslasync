//
//  TripReplayCharts.Previews.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated speed &
//  power timeline with the playhead mid-trip), empty (resolved, no samples → web "No
//  telemetry data available" overlay), loading (initial skeleton chrome), error (fetch
//  failed → retry), and the stale / offline freshness variants. Preview-only; excluded
//  from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTripReplayChartsTelemetry: TripReplayChartsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A representative trip: accelerate out, cruise, then regen-brake to a stop (so the
    /// power series dips below zero and the dual axes both exercise their ranges).
    private enum TripReplayChartsPreviewData {
        static let points: [TripReplayPoint] = (0 ..< 24).map { step in
            let time = Double(step) * 0.5
            let phase = Double(step) / 23.0
            let speed = 12 + 56 * sin(phase * .pi)
            let power = step < 16 ? 30 + 60 * sin(phase * .pi) : -45 * (phase - 0.66)
            return TripReplayPoint(originIndex: step, time: time, speed: max(0, speed), power: power)
        }
    }

    @MainActor
    private func tripReplayPreview(_ update: TripReplayChartsUpdate) -> TripReplayCharts {
        TripReplayCharts(
            model: TripReplayChartsModel(
                source: InMemoryTripReplayChartsSource(initial: update),
                telemetry: SilentTripReplayChartsTelemetry()
            )
        )
    }

    private let previewContent = TripReplayChartsUpdate(
        status: .loaded,
        points: TripReplayChartsPreviewData.points,
        speedUnit: "mph",
        currentIndex: 10,
        connection: .live
    )

    #Preview("Content") {
        tripReplayPreview(previewContent)
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        tripReplayPreview(TripReplayChartsUpdate(status: .loaded, points: [], connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        tripReplayPreview(TripReplayChartsUpdate(status: .loading, points: [], connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        tripReplayPreview(
            TripReplayChartsUpdate(status: .failed("Request timed out"), points: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        tripReplayPreview(
            TripReplayChartsUpdate(
                status: .loaded,
                points: TripReplayChartsPreviewData.points,
                speedUnit: "mph",
                currentIndex: 10,
                connection: .stale
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        tripReplayPreview(
            TripReplayChartsUpdate(
                status: .loaded,
                points: TripReplayChartsPreviewData.points,
                speedUnit: "mph",
                currentIndex: 10,
                connection: .offline
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }
#endif
