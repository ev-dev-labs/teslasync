//
//  LiveMotorStatus.Previews.swift
//  TeslaSync — P4 feature view · 0157 · LiveMotorStatus (Apple)
//
//  Xcode previews for each surface state (content / partial / °F / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum LiveMotorPreviewData {
        static let full = LiveMotorReading(
            shiftState: "D",
            source: "telemetry",
            powerKW: 142.6,
            regenKW: 12.4,
            rpmFront: 5230,
            rpmRear: 5280,
            torqueFrontNm: 210.5,
            torqueRearNm: 198,
            motorTempCFront: 49,
            motorTempCRear: 52,
            inverterTempC: 41,
            batteryTempC: 28,
            isolationResistanceKOhm: 650
        )

        /// Sparse reading: rear axle + torque + battery/inverter absent (→ em-dash), low isolation.
        static let partial = LiveMotorReading(
            shiftState: "P",
            source: "cache",
            powerKW: 0,
            rpmFront: 0,
            motorTempCFront: 38,
            isolationResistanceKOhm: 80
        )
    }

    @MainActor
    private func previewModel(_ update: LiveMotorUpdate) -> LiveMotorStatusModel {
        let source = InMemoryLiveMotorSource(initial: update)
        let model = LiveMotorStatusModel(source: source)
        model.start()
        return model
    }

    #Preview("Content") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(
            status: .loaded,
            reading: LiveMotorPreviewData.full
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Partial") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(
            status: .loaded,
            reading: LiveMotorPreviewData.partial
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · °F") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(
            status: .loaded,
            reading: LiveMotorPreviewData.full,
            units: LiveMotorUnitPrefs(temperature: .fahrenheit)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(status: .empty)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(
            status: .failed("Network request timed out")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(
            status: .loaded,
            connection: .stale,
            reading: LiveMotorPreviewData.full
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        LiveMotorStatus(model: previewModel(LiveMotorUpdate(
            status: .loaded,
            connection: .offline,
            reading: LiveMotorPreviewData.full
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
