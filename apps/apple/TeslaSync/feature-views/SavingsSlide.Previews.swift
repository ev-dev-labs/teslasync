//
//  SavingsSlide.Previews.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  Xcode previews for each surface state (content / stale / empty / loading /
//  offline-cached / offline-no-data / error). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SavingsSlidePreviewData {
        static let savings = YearReviewSavings(gasSavings: 1850, totalChargingCost: 412)
        static let modest = YearReviewSavings(gasSavings: 240, totalChargingCost: 96)
    }

    @MainActor
    private func previewModel(_ state: SavingsSlideLoadState<YearReviewSavings>) -> SavingsSlideModel {
        SavingsSlideModel(previewState: state)
    }

    #Preview("Content · live") {
        SavingsSlide(model: previewModel(.loaded(SavingsSlidePreviewData.savings, stale: false)))
            .frame(width: 480, height: 680)
    }

    #Preview("Content · modest") {
        SavingsSlide(model: previewModel(.loaded(SavingsSlidePreviewData.modest, stale: false)))
            .frame(width: 480, height: 680)
    }

    #Preview("Content · stale") {
        SavingsSlide(model: previewModel(.loaded(SavingsSlidePreviewData.savings, stale: true)))
            .frame(width: 480, height: 680)
    }

    #Preview("Empty") {
        SavingsSlide(model: previewModel(.empty(stale: false)))
            .frame(width: 480, height: 680)
    }

    #Preview("Loading") {
        SavingsSlide(model: previewModel(.idle))
            .frame(width: 480, height: 680)
    }

    #Preview("Offline · cached") {
        SavingsSlide(model: previewModel(.failed(.offline, cached: SavingsSlidePreviewData.savings, stale: true)))
            .frame(width: 480, height: 680)
    }

    #Preview("Offline · no data") {
        SavingsSlide(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 480, height: 680)
    }

    #Preview("Error") {
        SavingsSlide(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 480, height: 680)
    }
#endif
