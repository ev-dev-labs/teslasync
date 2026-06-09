//
//  FleetStatsBar.Previews.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  Xcode previews — one per state the surface produces: content (five cards), empty
//  (resolved, nothing to show → friendly state), loading (skeleton chrome), error
//  (fetch failed → retry), and the stale / offline freshness variants (cached cards
//  under the connectivity banner). Preview-only; excluded from release builds via
//  `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFleetStatsTelemetry: FleetStatsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample inputs for the populated previews: a small fleet with 30-day totals plus
    /// a handful of recent drives / charges to exercise the two sparklines.
    private enum FleetStatsPreviewData {
        static let input = FleetStatsInput(
            vehicleCount: 4,
            onlineCount: 3,
            unreadAlerts: 2,
            analytics: FleetAnalyticsSnapshot(
                totalDistanceSI: 1_234_000,
                totalEnergyKwh: 312.5,
                avgEfficiencyWhKm: 158
            ),
            recentDriveDistancesM: [42000, 38000, 51000, 33000, 47000],
            recentChargeEnergiesWh: [42000, 18000, 55000, 30000],
            unit: .km
        )
    }

    @MainActor
    private func fleetStatsPreview(_ update: FleetStatsUpdate) -> FleetStatsBar {
        FleetStatsBar(
            model: FleetStatsBarViewModel(
                source: InMemoryFleetStatsSource(initial: update),
                telemetry: SilentFleetStatsTelemetry(),
                locale: Locale(identifier: "en_US")
            )
        )
    }

    #Preview("Content") {
        fleetStatsPreview(
            FleetStatsUpdate(status: .loaded, input: FleetStatsPreviewData.input, connection: .live)
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        fleetStatsPreview(FleetStatsUpdate(status: .loaded, input: FleetStatsInput(), connection: .live))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        fleetStatsPreview(FleetStatsUpdate(status: .loading, input: FleetStatsInput(), connection: .live))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        fleetStatsPreview(
            FleetStatsUpdate(status: .failed("Request timed out"), input: FleetStatsInput(), connection: .live)
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        fleetStatsPreview(
            FleetStatsUpdate(status: .loaded, input: FleetStatsPreviewData.input, connection: .stale)
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        fleetStatsPreview(
            FleetStatsUpdate(status: .loaded, input: FleetStatsPreviewData.input, connection: .offline)
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
