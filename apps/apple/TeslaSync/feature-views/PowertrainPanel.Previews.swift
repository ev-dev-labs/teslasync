//
//  PowertrainPanel.Previews.swift
//  TeslaSync — P4 feature view · 0283 · PowertrainPanel (Apple)
//
//  Xcode previews for each surface state (data / data-regen / data-imperial / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum PowertrainPreviewData {
        /// A driving reading (SI inputs): D, ~142 kW drive, 4 200 / 4 180 rpm,
        /// 210 / 260 Nm, 58 / 61 °C motors, 44 °C inverter, no regen.
        static let driving = PowertrainReading(
            shiftState: PowertrainShiftBadge.driveValue,
            powerKw: 142,
            motorRpmFront: 4200,
            motorRpmRear: 4180,
            torqueNmFront: 210,
            torqueNmRear: 260,
            motorTempCFront: 58,
            motorTempCRear: 61,
            inverterTempC: 44,
            regenKw: 0
        )

        /// A regen reading: D, −38 kW (pack-side reverse flow), hot rear motor (84 °C
        /// → red branch), 12 kW regen.
        static let regen = PowertrainReading(
            shiftState: PowertrainShiftBadge.driveValue,
            powerKw: -38,
            motorRpmFront: 1850,
            motorRpmRear: 1860,
            torqueNmFront: -60,
            torqueNmRear: -90,
            motorTempCFront: 79,
            motorTempCRear: 84,
            inverterTempC: 52,
            regenKw: 12
        )
    }

    @MainActor
    private func powertrainPreviewModel(_ input: PowertrainInput) -> PowertrainModel {
        let source = InMemoryPowertrainSource(initial: input)
        let model = PowertrainModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — driving") {
        PowertrainPanel(model: powertrainPreviewModel(
            PowertrainInput(reading: PowertrainPreviewData.driving)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — regen (imperial)") {
        PowertrainPanel(model: powertrainPreviewModel(
            PowertrainInput(reading: PowertrainPreviewData.regen, units: .imperial)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        PowertrainPanel(model: powertrainPreviewModel(PowertrainInput(reading: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        PowertrainPanel(model: powertrainPreviewModel(PowertrainInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        PowertrainPanel(model: powertrainPreviewModel(
            PowertrainInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        PowertrainPanel(model: powertrainPreviewModel(
            PowertrainInput(reading: PowertrainPreviewData.driving, connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        PowertrainPanel(model: powertrainPreviewModel(
            PowertrainInput(reading: PowertrainPreviewData.driving, connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
