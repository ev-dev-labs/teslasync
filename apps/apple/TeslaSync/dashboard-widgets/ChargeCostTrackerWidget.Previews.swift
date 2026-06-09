//
//  ChargeCostTrackerWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and
//  each layout (standard / wide). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func chargeCostPreviewModel(_ update: ChargeCostUpdate) -> ChargeCostModel {
        let source = InMemoryChargeCostSource(initial: update)
        let model = ChargeCostModel(source: source)
        model.start()
        return model
    }

    private let chargeCostSampleSessions: [ChargeCostSession] = [
        ChargeCostSession(totalEnergyAddedWh: 40000, cost: nil),
        ChargeCostSession(totalEnergyAddedWh: 35000, cost: 7.5),
        ChargeCostSession(totalEnergyAddedWh: 25000, cost: nil),
        ChargeCostSession(totalEnergyAddedWh: 18000, cost: 3.2)
    ]

    private let chargeCostSamplePrefs = ChargeCostPrefs(
        distance: .miles,
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US",
        costPerKwh: 0.14,
        gasEfficiencyMpg: 30,
        gasPricePerUnit: 4.25,
        gasUnit: .gallon
    )

    #Preview("Standard (2×2)") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(
                ChargeCostUpdate(
                    status: .loaded,
                    connection: .live,
                    sessions: chargeCostSampleSessions,
                    prefs: chargeCostSamplePrefs,
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
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(
                ChargeCostUpdate(
                    status: .loaded,
                    connection: .live,
                    sessions: chargeCostSampleSessions,
                    prefs: chargeCostSamplePrefs,
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

    #Preview("Narrow (1×2)") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(
                ChargeCostUpdate(
                    status: .loaded,
                    connection: .live,
                    sessions: chargeCostSampleSessions,
                    prefs: ChargeCostPrefs(distance: .kilometers, costPerKwh: 0.14),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(ChargeCostUpdate(status: .loading, sessions: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(ChargeCostUpdate(status: .loaded, sessions: [])),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(
                ChargeCostUpdate(status: .failed("Network unavailable"), sessions: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(
                ChargeCostUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    sessions: chargeCostSampleSessions,
                    prefs: chargeCostSamplePrefs,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargeCostTrackerWidget(
            model: chargeCostPreviewModel(
                ChargeCostUpdate(
                    status: .loaded,
                    connection: .offline,
                    sessions: chargeCostSampleSessions,
                    prefs: chargeCostSamplePrefs,
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
