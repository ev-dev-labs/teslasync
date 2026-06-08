//
//  VehicleHeroWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  Xcode previews for each surface state (driving / charging / idle / asleep /
//  loading / empty / error / stale / offline). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: VehicleHeroUpdate) -> VehicleHeroModel {
        let source = InMemoryVehicleHeroSource(initial: update)
        let model = VehicleHeroModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = VehicleInput(
        id: 1, vin: "5YJ3E1EA7KF000111", displayName: "Bolt",
        model: "Model 3", trimBadging: "Long Range", updatedAt: Date()
    )

    private let previewPrefs = UnitDisplayPrefs(
        distanceUnit: "km", speedUnit: "km/h", tempUnit: "°C",
        isFahrenheit: false, locale: "en_US", precision: 2
    )

    private let drivingState = VehicleStateInput(
        state: "driving", speedMps: 29.06, powerKw: 121, batteryLevel: 72,
        ratedRangeM: 382_000, idealRangeM: 401_000, odometerM: 42_350_000,
        insideTempC: 21, outsideTempC: 14, isLocked: true, sentryMode: true,
        softwareVersion: "2026.8.1"
    )

    private let chargingState = VehicleStateInput(
        state: "charging", speedMps: 0, powerKw: -2, batteryLevel: 46,
        ratedRangeM: 212_000, idealRangeM: 231_000, odometerM: 42_350_000,
        insideTempC: 20, outsideTempC: 9, isCharging: true, chargerPowerKw: 48,
        chargeRateMph: 48000, timeToFullChargeH: 1.4, isLocked: true, softwareVersion: "2026.8.1"
    )

    private let idleState = VehicleStateInput(
        state: "online", batteryLevel: 84, ratedRangeM: 441_000, idealRangeM: 463_000,
        odometerM: 42_350_000, insideTempC: 22.5, outsideTempC: 12.3,
        isLocked: true, sentryMode: true, softwareVersion: "2026.8.1"
    )

    private func update(
        _ state: VehicleStateInput?,
        status: VehicleHeroLoadStatus = .loaded,
        connection: VehicleHeroConnection = .live
    ) -> VehicleHeroUpdate {
        VehicleHeroUpdate(
            status: status, connection: connection, vehicle: previewVehicle, state: state,
            liveVersion: state?.softwareVersion, prefs: previewPrefs, updatedAt: Date()
        )
    }

    private func frame(_ view: some View) -> some View {
        view.frame(width: 320, height: 520).padding().background(Color.TS.bg)
    }

    #Preview("Driving") {
        frame(VehicleHeroWidget(
            model: previewModel(update(drivingState)),
            size: DashboardWidgetSize(cols: 2, rows: 9),
            onNavigate: { _ in }
        ))
    }

    #Preview("Charging") {
        frame(VehicleHeroWidget(model: previewModel(update(chargingState)), onNavigate: { _ in }))
    }

    #Preview("Idle") {
        frame(VehicleHeroWidget(model: previewModel(update(idleState)), onNavigate: { _ in }))
    }

    #Preview("Asleep (no state)") {
        frame(VehicleHeroWidget(model: previewModel(update(nil)), onNavigate: { _ in }))
    }

    #Preview("Loading") {
        frame(VehicleHeroWidget(model: previewModel(
            VehicleHeroUpdate(status: .loading, vehicle: nil, prefs: previewPrefs)
        )))
    }

    #Preview("Empty (no vehicle)") {
        frame(VehicleHeroWidget(model: previewModel(
            VehicleHeroUpdate(status: .empty, vehicle: nil, prefs: previewPrefs)
        )))
    }

    #Preview("Error") {
        frame(VehicleHeroWidget(model: previewModel(
            VehicleHeroUpdate(status: .failed("Network unavailable"), vehicle: nil, prefs: previewPrefs)
        )))
    }

    #Preview("Stale") {
        frame(VehicleHeroWidget(model: previewModel(update(idleState, connection: .stale)), onNavigate: { _ in }))
    }

    #Preview("Offline (cached)") {
        frame(VehicleHeroWidget(model: previewModel(update(idleState, connection: .offline)), onNavigate: { _ in }))
    }
#endif
