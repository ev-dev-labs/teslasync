//
//  BatteryGaugeWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0013 · BatteryGaugeWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and a
//  couple of grid sizes. DEBUG-only; skipped by the host compile + format gates outside DEBUG.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func batteryPreviewModel(_ update: BatteryGaugeWidgetUpdate) -> BatteryGaugeWidgetModel {
        let source = BatteryGaugeWidgetInMemorySource(initial: update)
        let model = BatteryGaugeWidgetModel(source: source)
        model.start()
        return model
    }

    private let batteryHighCharging = BatteryGaugeWidgetStateDTO(batteryLevel: 82, isCharging: true)
    private let batteryMedium = BatteryGaugeWidgetStateDTO(batteryLevel: 38, isCharging: false)
    private let batteryLow = BatteryGaugeWidgetStateDTO(batteryLevel: 14, isCharging: false)

    #Preview("Standard (1×2) — charging") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(
                BatteryGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    state: batteryHighCharging,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (2×2) — medium") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(
                BatteryGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    state: batteryMedium,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 420, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(BatteryGaugeWidgetUpdate(status: .loading, state: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(BatteryGaugeWidgetUpdate(status: .loaded, state: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(
                BatteryGaugeWidgetUpdate(status: .failed("Network unavailable"), state: nil)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(
                BatteryGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    state: batteryHighCharging,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BatteryGaugeWidget(
            model: batteryPreviewModel(
                BatteryGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: batteryLow,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
