//
//  SavingsCalculator.Previews.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  Xcode previews for each surface state (content / stale / empty / loading /
//  offline-cached / offline-no-data / error). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SavingsCalculatorPreviewData {
        static let rich = SavingsCalculatorData(
            energyKwh: 412,
            costDollars: 280,
            displayDistance: 9000,
            distanceUnit: "mi",
            monthsCount: 12
        )
        static let modest = SavingsCalculatorData(
            energyKwh: 96,
            costDollars: 64,
            displayDistance: 1800,
            distanceUnit: "mi",
            monthsCount: 3
        )
    }

    @MainActor
    private func previewModel(_ state: SavingsCalculatorLoadState<SavingsCalculatorData>) -> SavingsCalculatorModel {
        SavingsCalculatorModel(previewState: state)
    }

    #Preview("Content · live") {
        SavingsCalculator(model: previewModel(.loaded(SavingsCalculatorPreviewData.rich, stale: false)))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Content · modest") {
        SavingsCalculator(model: previewModel(.loaded(SavingsCalculatorPreviewData.modest, stale: false)))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Content · stale") {
        SavingsCalculator(model: previewModel(.loaded(SavingsCalculatorPreviewData.rich, stale: true)))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Empty") {
        SavingsCalculator(model: previewModel(.empty(stale: false)))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Loading") {
        SavingsCalculator(model: previewModel(.idle))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Offline · cached") {
        SavingsCalculator(
            model: previewModel(.failed(.offline, cached: SavingsCalculatorPreviewData.rich, stale: true))
        )
        .frame(width: 560, height: 360)
        .padding()
    }

    #Preview("Offline · no data") {
        SavingsCalculator(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Error") {
        SavingsCalculator(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 560, height: 360)
            .padding()
    }

    #Preview("Compact · stacked") {
        SavingsCalculator(model: previewModel(.loaded(SavingsCalculatorPreviewData.rich, stale: false)))
            .frame(width: 360, height: 640)
            .padding()
    }
#endif
