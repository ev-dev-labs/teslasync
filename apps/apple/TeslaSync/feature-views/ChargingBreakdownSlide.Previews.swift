//
//  ChargingBreakdownSlide.Previews.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  Xcode previews for each surface state (content / stale / offline-cached / loading
//  / empty / offline-no-data / error). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ChargingBreakdownSlidePreviewData {
        static func recap() -> ChargingBreakdownSlideData {
            ChargingBreakdownSlideData(
                superchargerPct: 58,
                dcFastPct: 17,
                acOtherPct: 25,
                totalChargeSessions: 184,
                avgChargeStartSoc: 38
            )
        }
    }

    @MainActor
    private func previewModel(
        _ state: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>
    ) -> ChargingBreakdownSlideModel {
        ChargingBreakdownSlideModel(previewState: state)
    }

    #Preview("Content · live") {
        ChargingBreakdownSlide(model: previewModel(.loaded(ChargingBreakdownSlidePreviewData.recap(), stale: false)))
            .frame(width: 560, height: 560)
            .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        ChargingBreakdownSlide(model: previewModel(.loaded(ChargingBreakdownSlidePreviewData.recap(), stale: true)))
            .frame(width: 560, height: 560)
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        ChargingBreakdownSlide(model: previewModel(
            .failed(.offline, cached: ChargingBreakdownSlidePreviewData.recap(), stale: true)
        ))
        .frame(width: 560, height: 560)
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargingBreakdownSlide(model: previewModel(.idle))
            .frame(width: 560, height: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargingBreakdownSlide(model: previewModel(.empty(stale: false)))
            .frame(width: 560, height: 560)
            .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        ChargingBreakdownSlide(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 560, height: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargingBreakdownSlide(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 560, height: 560)
            .background(Color.TS.bg)
    }
#endif
