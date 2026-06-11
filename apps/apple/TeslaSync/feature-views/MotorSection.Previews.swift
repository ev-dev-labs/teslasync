//
//  MotorSection.Previews.swift
//  TeslaSync — P4 feature view · 0293 · MotorSection (Apple)
//
//  Xcode previews for each surface state (loading / data / data·imperial / partial /
//  empty / error / stale / offline). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: MotorSectionInput) -> MotorSectionModel {
        let source = InMemoryMotorSectionSource(initial: input)
        let model = MotorSectionModel(source: source)
        model.start()
        return model
    }

    private let fullReading = MotorSectionReading(
        shiftState: "D",
        vbatFront: 388.4,
        vbatRear: 389.1,
        motorCurrentFront: 142.5,
        torqueNmFront: 210.0,
        torqueNmRear: 340.5,
        motorRpmFront: 4200,
        motorRpmRear: 6850,
        motorTempCFront: 64.0,
        motorTempCRear: 78.5
    )

    private let partialReading = MotorSectionReading(
        shiftState: "P",
        vbatFront: nil,
        vbatRear: 390.0,
        motorCurrentFront: nil,
        torqueNmFront: 0.0,
        torqueNmRear: nil,
        motorRpmFront: 0,
        motorRpmRear: nil,
        motorTempCFront: 41.0,
        motorTempCRear: nil
    )

    #Preview("Loading") {
        MotorSection(model: previewModel(MotorSectionInput(isLoading: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        MotorSection(model: previewModel(MotorSectionInput(reading: fullReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · imperial") {
        MotorSection(model: previewModel(MotorSectionInput(reading: fullReading, units: .imperial)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · partial") {
        MotorSection(model: previewModel(MotorSectionInput(reading: partialReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MotorSection(model: previewModel(MotorSectionInput(reading: nil)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MotorSection(model: previewModel(
            MotorSectionInput(errorMessage: "Motor request returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        MotorSection(model: previewModel(
            MotorSectionInput(reading: fullReading, connection: .stale)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        MotorSection(model: previewModel(
            MotorSectionInput(reading: fullReading, connection: .offline)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
