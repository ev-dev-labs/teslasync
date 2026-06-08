//
//  BatteryLevelChart.Previews.swift
//  TeslaSync — P4 feature view · 0097 · BatteryLevelChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  decile histogram), empty (resolved, no sessions → web `EmptyState`), loading
//  (initial skeleton chrome), error (fetch failed → retry), and the stale /
//  offline freshness variants. Preview-only; excluded from release builds via
//  `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentBatteryLevelTelemetry: BatteryLevelChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A realistic spread of start-of-charge levels: most sessions plug in low-to-mid
    /// (20–60%), a long tail of top-ups, and a couple of near-full sessions.
    private enum BatteryLevelPreviewData {
        static let sessions: [BatteryStartLevelSession] = {
            let perDecile = [1, 4, 9, 14, 17, 12, 8, 5, 3, 1]
            return perDecile.enumerated().flatMap { index, count in
                Array(repeating: BatteryStartLevelSession(startSocPct: Double(index * 10 + 5)), count: count)
            }
        }()
    }

    @MainActor
    private func batteryLevelPreview(_ update: BatteryLevelUpdate) -> BatteryLevelChart {
        BatteryLevelChart(
            model: BatteryLevelChartModel(
                source: InMemoryBatteryLevelSource(initial: update),
                telemetry: SilentBatteryLevelTelemetry()
            )
        )
    }

    #Preview("Content") {
        batteryLevelPreview(
            BatteryLevelUpdate(status: .loaded, sessions: BatteryLevelPreviewData.sessions, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        batteryLevelPreview(BatteryLevelUpdate(status: .loaded, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        batteryLevelPreview(BatteryLevelUpdate(status: .loading, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        batteryLevelPreview(
            BatteryLevelUpdate(status: .failed("Request timed out"), sessions: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        batteryLevelPreview(
            BatteryLevelUpdate(status: .loaded, sessions: BatteryLevelPreviewData.sessions, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        batteryLevelPreview(
            BatteryLevelUpdate(status: .loaded, sessions: BatteryLevelPreviewData.sessions, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
