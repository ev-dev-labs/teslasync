//
//  BatteryHealthAnalyticsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0014 · BatteryHealthAnalyticsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and a
//  couple of grid sizes. DEBUG-only; skipped by the host compile + format gates outside DEBUG.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func batteryHealthPreviewModel(
        _ update: BatteryHealthAnalyticsWidgetUpdate
    ) -> BatteryHealthAnalyticsWidgetModel {
        let source = BatteryHealthAnalyticsWidgetInMemorySource(initial: update)
        let model = BatteryHealthAnalyticsWidgetModel(source: source)
        model.start()
        return model
    }

    private let batteryHealthGood = BatteryHealthAnalyticsWidgetDTO(
        currentSoh: 92,
        totalCycles: 412,
        fullChargePct: 78,
        avgDepthOfDischarge: 46,
        fastChargePct: 23,
        tempExposureScore: 88,
        chargeHabitsScore: 81
    )

    private let batteryHealthFair = BatteryHealthAnalyticsWidgetDTO(
        currentSoh: 64,
        totalCycles: 1287,
        fullChargePct: 91,
        avgDepthOfDischarge: 63,
        fastChargePct: 58,
        tempExposureScore: 52,
        chargeHabitsScore: 47
    )

    #Preview("Standard (2×4)") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(
                BatteryHealthAnalyticsWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    data: batteryHealthGood,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4) — fair") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(
                BatteryHealthAnalyticsWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    data: batteryHealthFair,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 520, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(
                BatteryHealthAnalyticsWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    data: batteryHealthGood,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(BatteryHealthAnalyticsWidgetUpdate(status: .loading, data: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(BatteryHealthAnalyticsWidgetUpdate(status: .loaded, data: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(
                BatteryHealthAnalyticsWidgetUpdate(status: .failed("Network unavailable"), data: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(
                BatteryHealthAnalyticsWidgetUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    data: batteryHealthGood,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BatteryHealthAnalyticsWidget(
            model: batteryHealthPreviewModel(
                BatteryHealthAnalyticsWidgetUpdate(
                    status: .loaded,
                    connection: .offline,
                    data: batteryHealthFair,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }
#endif
