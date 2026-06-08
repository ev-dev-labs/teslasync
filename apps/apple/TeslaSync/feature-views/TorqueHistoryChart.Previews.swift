//
//  TorqueHistoryChart.Previews.swift
//  TeslaSync — P4 feature view · 0164 · TorqueHistoryChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  torque area chart), empty (resolved, ≤1 row / all-null → web `return null`
//  widened to an empty surface), loading (initial skeleton chrome), error (fetch
//  failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTorqueHistoryTelemetry: TorqueHistoryChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample motor snapshots for the populated previews: a torque sweep with a
    /// couple of gaps (null) so the `connectNulls` bridging is exercised.
    private enum TorqueHistoryPreviewData {
        static let samples: [TorqueHistorySample] = [
            TorqueHistorySample(time: "08:00", torque: 0),
            TorqueHistorySample(time: "08:05", torque: 140),
            TorqueHistorySample(time: "08:10", torque: 320),
            TorqueHistorySample(time: "08:15", torque: nil),
            TorqueHistorySample(time: "08:20", torque: 210),
            TorqueHistorySample(time: "08:25", torque: -45),
            TorqueHistorySample(time: "08:30", torque: 95),
            TorqueHistorySample(time: "08:35", torque: 180)
        ]
    }

    @MainActor
    private func torqueHistoryPreview(_ update: TorqueHistoryUpdate) -> TorqueHistoryChart {
        TorqueHistoryChart(
            model: TorqueHistoryChartModel(
                source: InMemoryTorqueHistorySource(initial: update),
                telemetry: SilentTorqueHistoryTelemetry()
            )
        )
    }

    #Preview("Content") {
        torqueHistoryPreview(
            TorqueHistoryUpdate(status: .loaded, samples: TorqueHistoryPreviewData.samples, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        torqueHistoryPreview(TorqueHistoryUpdate(status: .loaded, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        torqueHistoryPreview(TorqueHistoryUpdate(status: .loading, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        torqueHistoryPreview(
            TorqueHistoryUpdate(status: .failed("Request timed out"), samples: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        torqueHistoryPreview(
            TorqueHistoryUpdate(status: .loaded, samples: TorqueHistoryPreviewData.samples, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        torqueHistoryPreview(
            TorqueHistoryUpdate(status: .loaded, samples: TorqueHistoryPreviewData.samples, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
