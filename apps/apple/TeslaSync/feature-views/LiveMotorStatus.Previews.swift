//
//  LiveMotorStatus.Previews.swift
//  TeslaSync — P4 feature view · 0170 · LiveMotorStatus (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline)
//  plus the Fahrenheit unit variant. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LiveMotorUpdate) -> LiveMotorStatusModel {
        let source = InMemoryLiveMotorSource(initial: update)
        let model = LiveMotorStatusModel(source: source)
        model.start()
        return model
    }

    private func previewMotor() -> MotorSnapshotInput {
        MotorSnapshotInput(
            torqueFrontNm: 184.5,
            torqueRearNm: 312.0,
            rpmFront: 5230,
            motorTempCFront: 48.4,
            motorTempCRear: 51.2,
            shiftState: "D"
        )
    }

    private func loadedUpdate(
        connection: LiveMotorConnection = .live,
        units: LiveMotorUnitPrefs = LiveMotorUnitPrefs()
    ) -> LiveMotorUpdate {
        LiveMotorUpdate(
            status: .loaded,
            connection: connection,
            motor: previewMotor(),
            units: units,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: LiveMotorUpdate) -> some View {
        ScrollView {
            LiveMotorStatus(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (Fahrenheit)") {
        previewSurface(
            loadedUpdate(units: LiveMotorUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US"))
        )
    }

    #Preview("Awaiting temp (parked)") {
        previewSurface(
            LiveMotorUpdate(
                status: .loaded,
                motor: MotorSnapshotInput(
                    torqueFrontNm: 0,
                    torqueRearNm: 0,
                    rpmFront: 0,
                    motorTempCFront: nil,
                    motorTempCRear: nil,
                    shiftState: "P"
                ),
                updatedAt: Date()
            )
        )
    }

    #Preview("Empty") {
        previewSurface(LiveMotorUpdate(status: .empty, motor: nil))
    }

    #Preview("Loading") {
        previewSurface(LiveMotorUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(LiveMotorUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
