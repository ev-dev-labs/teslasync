//
//  AICabinTemperatureImpactNarrative.Previews.swift
//  TeslaSync — P4 shared surface · 0009 · AICabinTemperatureImpactNarrative (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: CabinTempNarrativeInput) -> CabinTempNarrativeModel {
        let source = InMemoryCabinTempNarrativeSource(initial: input)
        let model = CabinTempNarrativeModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Mild months (15–25 °C) are this car's most efficient — about 152 Wh/km on recent drives. \
    Cold-weather months run ~28% higher (≈195 Wh/km) because cabin heating and a cold battery \
    add fixed overhead that short trips can't amortise. The seasonal dip you see in the chart \
    tracks ambient temperature, not driving style. These are descriptive aggregates of your \
    recent drives, not a forecast.
    """

    private func readyInput(
        stream: CabinTempNarrativeStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: CabinTempNarrativeConnection = .live
    ) -> CabinTempNarrativeInput {
        CabinTempNarrativeInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AICabinTemperatureImpactNarrative(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            readyInput(stream: CabinTempNarrativeStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            readyInput(stream: CabinTempNarrativeStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            readyInput(stream: CabinTempNarrativeStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AICabinTemperatureImpactNarrative(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            CabinTempNarrativeInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            CabinTempNarrativeInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            readyInput(
                stream: CabinTempNarrativeStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            readyInput(
                stream: CabinTempNarrativeStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AICabinTemperatureImpactNarrative(model: previewModel(
            CabinTempNarrativeInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
