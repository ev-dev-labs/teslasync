//
//  SpeedTrendChart.Previews.swift
//  TeslaSync — P4 feature view · 0092 · SpeedTrendChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  two-series line chart), empty (resolved, no months → web empty overlay),
//  loading (initial skeleton chrome), error (fetch failed → retry), and the
//  stale / offline freshness variants. Preview-only; excluded from release builds
//  via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSpeedTrendTelemetry: SpeedTrendChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample sessions across three months for the populated previews: a mix of
    /// DC (Supercharger / high-power) and AC (home) sessions so both lines render.
    private enum SpeedTrendPreviewData {
        static let sessions: [SpeedTrendSession] = [
            SpeedTrendSession(startedAt: "2026-04-03T08:00:00Z", peakPowerW: 120_000, chargerType: "Tesla"),
            SpeedTrendSession(startedAt: "2026-04-19T22:00:00Z", peakPowerW: 7400, chargerType: nil),
            SpeedTrendSession(startedAt: "2026-05-02T12:30:00Z", peakPowerW: 150_000, chargerType: "Tesla"),
            SpeedTrendSession(startedAt: "2026-05-11T19:15:00Z", peakPowerW: 11000, chargerType: nil),
            SpeedTrendSession(startedAt: "2026-05-27T07:45:00Z", peakPowerW: 95000, chargerType: "CCS"),
            SpeedTrendSession(startedAt: "2026-06-04T23:10:00Z", peakPowerW: 7400, chargerType: nil),
            SpeedTrendSession(startedAt: "2026-06-06T09:05:00Z", peakPowerW: 250_000, chargerType: "Tesla")
        ]
    }

    @MainActor
    private func speedTrendPreview(_ update: SpeedTrendUpdate) -> SpeedTrendChart {
        SpeedTrendChart(
            model: SpeedTrendChartModel(
                source: InMemorySpeedTrendSource(initial: update),
                telemetry: SilentSpeedTrendTelemetry()
            )
        )
    }

    #Preview("Content") {
        speedTrendPreview(
            SpeedTrendUpdate(status: .loaded, sessions: SpeedTrendPreviewData.sessions, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        speedTrendPreview(SpeedTrendUpdate(status: .loaded, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        speedTrendPreview(SpeedTrendUpdate(status: .loading, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        speedTrendPreview(
            SpeedTrendUpdate(status: .failed("Request timed out"), sessions: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        speedTrendPreview(
            SpeedTrendUpdate(status: .loaded, sessions: SpeedTrendPreviewData.sessions, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        speedTrendPreview(
            SpeedTrendUpdate(status: .loaded, sessions: SpeedTrendPreviewData.sessions, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
