//
//  LifetimeStatsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0055 · LifetimeStatsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / content) and
//  each layout (compact / standard / wide). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func lifetimePreviewModel(_ update: LifetimeStatsUpdate) -> LifetimeStatsModel {
        let source = InMemoryLifetimeStatsSource(initial: update)
        let model = LifetimeStatsModel(source: source)
        model.start()
        return model
    }

    private let lifetimeSampleStats = LifetimeStatsDTO(
        totalDrives: 1234,
        totalDistanceKm: 50000,
        totalEnergyKwh: 8765.4,
        co2OffsetKg: 4321.6,
        totalChargingCost: 1234.56,
        ownershipDays: 365
    )

    private let lifetimeSampleUnits = LifetimeUnitPrefs(
        distance: .miles,
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US"
    )

    #Preview("Standard (2×2)") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(
                LifetimeStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: lifetimeSampleStats,
                    units: lifetimeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×3)") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(
                LifetimeStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: lifetimeSampleStats,
                    units: lifetimeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3),
            onOpen: {}
        )
        .frame(width: 560, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(
                LifetimeStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: lifetimeSampleStats,
                    units: lifetimeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 160, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(LifetimeStatsUpdate(status: .loading, stats: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(LifetimeStatsUpdate(status: .loaded, stats: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(
                LifetimeStatsUpdate(status: .failed("Network unavailable"), stats: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        LifetimeStatsWidget(
            model: lifetimePreviewModel(
                LifetimeStatsUpdate(
                    status: .loaded,
                    connection: .offline,
                    stats: lifetimeSampleStats,
                    units: lifetimeSampleUnits,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
