//
//  FleetStatsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0051 · FleetStatsWidget (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error / stale /
//  offline) and each layout (standard 4×2 / wide 4×3 / compact 2×2). DEBUG-only;
//  skipped by the host compile + format gates.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// No-op telemetry sinks so previews don't emit diagnostics.
    private struct SilentFleetStatsWidgetTelemetry: FleetStatsWidgetTelemetry {
        func viewOpened(surface _: String) {}
    }

    private struct SilentFleetStatsBarTelemetry: FleetStatsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample inputs for the populated previews: a small fleet with 30-day totals plus a
    /// handful of recent drives / charges to exercise the two sparklines.
    private enum FleetStatsWidgetPreviewData {
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
    private func fleetStatsWidget(
        _ update: FleetStatsUpdate,
        size: DashboardWidgetSize,
        onOpen: (() -> Void)? = nil
    ) -> FleetStatsWidget {
        FleetStatsWidget(
            model: FleetStatsWidgetModel(
                source: InMemoryFleetStatsSource(initial: update),
                telemetry: SilentFleetStatsWidgetTelemetry(),
                barTelemetry: SilentFleetStatsBarTelemetry(),
                locale: Locale(identifier: "en_US")
            ),
            size: size,
            onOpen: onOpen
        )
    }

    #Preview("Standard (4×2)") {
        fleetStatsWidget(
            FleetStatsUpdate(status: .loaded, input: FleetStatsWidgetPreviewData.input, connection: .live),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 440, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×3)") {
        fleetStatsWidget(
            FleetStatsUpdate(status: .loaded, input: FleetStatsWidgetPreviewData.input, connection: .live),
            size: DashboardWidgetSize(cols: 4, rows: 3),
            onOpen: {}
        )
        .frame(width: 560, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (2×2)") {
        fleetStatsWidget(
            FleetStatsUpdate(status: .loaded, input: FleetStatsWidgetPreviewData.input, connection: .live),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        fleetStatsWidget(
            FleetStatsUpdate(status: .loading, input: FleetStatsInput(), connection: .live),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 440, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        fleetStatsWidget(
            FleetStatsUpdate(status: .loaded, input: FleetStatsInput(), connection: .live),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 440, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        fleetStatsWidget(
            FleetStatsUpdate(status: .failed("Request timed out"), input: FleetStatsInput(), connection: .live),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 440, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        fleetStatsWidget(
            FleetStatsUpdate(
                status: .loaded,
                input: FleetStatsWidgetPreviewData.input,
                connection: .stale,
                updatedAt: Date().addingTimeInterval(-180)
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 440, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        fleetStatsWidget(
            FleetStatsUpdate(
                status: .loaded,
                input: FleetStatsWidgetPreviewData.input,
                connection: .offline,
                updatedAt: Date().addingTimeInterval(-600)
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 440, height: 220)
        .padding()
        .background(Color.TS.bg)
    }
#endif
