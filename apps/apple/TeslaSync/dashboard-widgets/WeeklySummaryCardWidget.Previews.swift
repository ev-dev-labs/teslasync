//
//  WeeklySummaryCardWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  content) and each layout (compact / standard / wide). DEBUG-only; skipped by
//  the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func weeklyPreviewModel(_ update: WeeklySummaryUpdate) -> WeeklySummaryModel {
        let source = InMemoryWeeklySummarySource(initial: update)
        let model = WeeklySummaryModel(source: source)
        model.start()
        return model
    }

    private let weeklySampleDigest = WeeklySummaryCardWidgetDigestDTO(
        drives: 8,
        distanceKm: 5000,
        energyKwh: 20,
        cost: 12.5,
        efficiency: 180,
        prevDrives: 6,
        prevDistanceKm: 4000,
        prevEnergyKwh: 25,
        prevCost: 10,
        prevEfficiency: 200
    )

    private let weeklySampleUnits = WeeklyUnitPrefs(
        distance: .miles,
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US"
    )

    private func weeklyContentUpdate(
        connection: WeeklyConnection = .live,
        updatedAt: Date? = Date()
    ) -> WeeklySummaryUpdate {
        WeeklySummaryUpdate(
            status: .loaded,
            connection: connection,
            digest: weeklySampleDigest,
            units: weeklySampleUnits,
            vehicle: WeeklyVehicleRef(id: 1, displayName: "Model 3"),
            updatedAt: updatedAt
        )
    }

    #Preview("Standard (2×2)") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(weeklyContentUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×2)") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(weeklyContentUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 600, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×1)") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(weeklyContentUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 160, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(WeeklySummaryUpdate(status: .loading, digest: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(WeeklySummaryUpdate(status: .loaded, digest: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(
                WeeklySummaryUpdate(status: .failed("Network unavailable"), digest: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        WeeklySummaryCardWidget(
            model: weeklyPreviewModel(
                weeklyContentUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-900))
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
