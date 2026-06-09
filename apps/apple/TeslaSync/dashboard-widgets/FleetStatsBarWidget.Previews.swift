//
//  FleetStatsBarWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0050 · FleetStatsBarWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content)
//  and the responsive layouts (wide 4-up bar / narrow 2-up). DEBUG-only; skipped by the host
//  compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func fleetStatsBarPreviewModel(_ update: FleetStatsBarUpdate) -> FleetStatsBarModel {
        let source = InMemoryFleetStatsBarSource(initial: update)
        let model = FleetStatsBarModel(source: source)
        model.start()
        return model
    }

    private let fleetStatsBarSampleStats = FleetStatsBarDTO(
        vehicleCount: 4,
        onlineCount: 3,
        totalDistanceKm: 12345.6,
        totalEnergyKwh: 2345.67,
        hasVehicles: true,
        hasAnalytics: true
    )

    #Preview("Bar (4×2)") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(
                FleetStatsBarUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: fleetStatsBarSampleStats,
                    units: FleetStatsBarUnitPrefs(distance: .kilometers),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 560, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Narrow (3×2)") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(
                FleetStatsBarUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: fleetStatsBarSampleStats,
                    units: FleetStatsBarUnitPrefs(distance: .miles),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 2),
            onOpen: {}
        )
        .frame(width: 360, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(FleetStatsBarUpdate(status: .loading, stats: nil)),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 560, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(
                FleetStatsBarUpdate(status: .loaded, stats: FleetStatsBarDTO())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 560, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(
                FleetStatsBarUpdate(status: .failed("Network unavailable"), stats: nil)
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2)
        )
        .frame(width: 560, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(
                FleetStatsBarUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    stats: fleetStatsBarSampleStats,
                    units: FleetStatsBarUnitPrefs(distance: .kilometers),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 560, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        FleetStatsBarWidget(
            model: fleetStatsBarPreviewModel(
                FleetStatsBarUpdate(
                    status: .loaded,
                    connection: .offline,
                    stats: fleetStatsBarSampleStats,
                    units: FleetStatsBarUnitPrefs(distance: .kilometers),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 560, height: 220)
        .padding()
        .background(Color.TS.bg)
    }
#endif
