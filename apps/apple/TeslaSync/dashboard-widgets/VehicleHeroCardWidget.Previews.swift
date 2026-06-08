//
//  VehicleHeroCardWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0107 · VehicleHeroCardWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / content) and each
//  layout (compact 1×1 / standard 2×2 / wide 4×2 / tall). DEBUG-only; skipped by the host compile
//  + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func heroPreviewModel(_ update: VehicleHeroUpdate) -> VehicleHeroModel {
        let source = InMemoryVehicleHeroSource(initial: update)
        let model = VehicleHeroModel(source: source)
        model.start()
        return model
    }

    private let heroSampleVehicle = VehicleHeroVehicleDTO(
        displayName: "Bluebird",
        vin: "5YJ3E1EA7KF000000",
        model: "Model 3",
        trimBadging: "Long Range"
    )

    private let heroSampleState = VehicleHeroStateDTO(
        statusRaw: "online",
        batteryLevel: 84,
        idealRangeMeters: 450_000,
        insideTempCelsius: 21,
        outsideTempCelsius: 14,
        isCharging: false,
        chargerPowerKilowatts: nil
    )

    private let heroChargingState = VehicleHeroStateDTO(
        statusRaw: "charging",
        batteryLevel: 47,
        idealRangeMeters: 320_000,
        insideTempCelsius: 22,
        outsideTempCelsius: 9,
        isCharging: true,
        chargerPowerKilowatts: 11
    )

    private let heroImperial = VehicleHeroUnitPrefs(
        distance: .miles, temperature: .fahrenheit, localeIdentifier: "en_US"
    )

    #Preview("Standard (2×2)") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(
                VehicleHeroUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: heroSampleVehicle,
                    state: heroSampleState,
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

    #Preview("Wide (4×2) — charging, imperial") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(
                VehicleHeroUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: heroSampleVehicle,
                    state: heroChargingState,
                    units: heroImperial,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 560, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×1)") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(
                VehicleHeroUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: heroSampleVehicle,
                    state: heroSampleState,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 160, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(VehicleHeroUpdate(status: .loading, vehicle: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no vehicle)") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(VehicleHeroUpdate(status: .loaded, vehicle: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(
                VehicleHeroUpdate(status: .failed("Network unavailable"), vehicle: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        VehicleHeroCardWidget(
            model: heroPreviewModel(
                VehicleHeroUpdate(
                    status: .loaded,
                    connection: .offline,
                    vehicle: heroSampleVehicle,
                    state: heroSampleState,
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
