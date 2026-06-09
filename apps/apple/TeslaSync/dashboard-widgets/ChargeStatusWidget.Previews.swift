//
//  ChargeStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0021 · ChargeStatusWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / charging /
//  idle) and each layout (compact / standard). DEBUG-only; skipped by the host compile +
//  format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func chargePreviewModel(_ update: ChargeStatusUpdate) -> ChargeStatusModel {
        let source = InMemoryChargeStatusSource(initial: update)
        let model = ChargeStatusModel(source: source)
        model.start()
        return model
    }

    private let chargingSampleState = ChargeStateDTO(
        isCharging: true,
        chargerPowerKw: 11,
        chargeRateMetersPerHour: 48000,
        batteryLevelPercent: 64,
        timeToFullChargeHours: 1.5,
        ratedRangeMeters: 360_000
    )

    private let idleSampleState = ChargeStateDTO(
        isCharging: false,
        batteryLevelPercent: 72,
        ratedRangeMeters: 405_000
    )

    private let chargeSampleUnits = ChargeUnitPrefs(distance: .miles, localeIdentifier: "en_US")

    #Preview("Charging (2×2)") {
        ChargeStatusWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .live,
                    state: chargingSampleState,
                    units: chargeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Charging compact (1×2)") {
        ChargeStatusWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .live,
                    state: chargingSampleState,
                    units: ChargeUnitPrefs(distance: .kilometers, localeIdentifier: "en_US"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Idle (2×2)") {
        ChargeStatusWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .live,
                    state: idleSampleState,
                    units: ChargeUnitPrefs(distance: .kilometers, localeIdentifier: "en_US"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargeStatusWidget(
            model: chargePreviewModel(ChargeStatusUpdate(status: .loading, state: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargeStatusWidget(
            model: chargePreviewModel(ChargeStatusUpdate(status: .loaded, state: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargeStatusWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(status: .failed("Network unavailable"), state: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached charging)") {
        ChargeStatusWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: chargingSampleState,
                    units: chargeSampleUnits,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
