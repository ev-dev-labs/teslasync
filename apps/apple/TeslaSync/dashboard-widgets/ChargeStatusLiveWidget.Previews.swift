//
//  ChargeStatusLiveWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0020 · ChargeStatusLiveWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / charging / idle) and
//  each layout (compact / full). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func chargePreviewModel(_ update: ChargeStatusUpdate) -> ChargeStatusLiveModel {
        let source = InMemoryChargeStatusLiveSource(initial: update)
        let model = ChargeStatusLiveModel(source: source)
        model.start()
        return model
    }

    private let chargeSampleUnits = ChargeUnitPrefs(distance: .miles, localeIdentifier: "en_US")

    private let chargeSampleChargingState = ChargeStateDTO(
        isCharging: true,
        chargerPowerKw: 11.2,
        voltage: nil,
        amps: nil,
        timeToFullHours: 2.5,
        chargeRateMeters: 64000,
        batteryLevelPercent: 64
    )

    private let chargeSampleIdleState = ChargeStateDTO(
        isCharging: false,
        chargerPowerKw: 0,
        batteryLevelPercent: 78
    )

    private let chargeSampleSession = ChargeSessionDTO(totalEnergyAddedWh: 41500)

    private let chargeSampleChargingProjection = ChargeStatusProjector.project(
        state: chargeSampleChargingState,
        session: chargeSampleSession,
        units: chargeSampleUnits
    )

    private let chargeSampleIdleProjection = ChargeStatusProjector.project(
        state: chargeSampleIdleState,
        session: chargeSampleSession,
        units: chargeSampleUnits
    )

    #Preview("Charging (2×2)") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .live,
                    state: chargeSampleChargingState,
                    latestSession: chargeSampleSession,
                    units: chargeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Charging (3×4)") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .live,
                    state: chargeSampleChargingState,
                    latestSession: chargeSampleSession,
                    units: ChargeUnitPrefs(distance: .kilometers, localeIdentifier: "en_US"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 4),
            onOpen: {}
        )
        .frame(width: 460, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Idle (2×2)") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .live,
                    state: chargeSampleIdleState,
                    latestSession: chargeSampleSession,
                    units: chargeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(ChargeStatusUpdate(status: .loading, state: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(ChargeStatusUpdate(status: .loaded, state: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(status: .failed("Network unavailable"), state: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargeStatusLiveWidget(
            model: chargePreviewModel(
                ChargeStatusUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: chargeSampleChargingState,
                    latestSession: chargeSampleSession,
                    units: chargeSampleUnits,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact charging") {
        ChargeStatusCompactChargingView(projection: chargeSampleChargingProjection)
            .frame(width: 150, height: 150)
            .padding()
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Compact idle") {
        ChargeStatusCompactIdleView(projection: chargeSampleIdleProjection)
            .frame(width: 150, height: 150)
            .padding()
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .padding()
            .background(Color.TS.bg)
    }
#endif
