//
//  AIBatteryHealthForecastNarrative.Previews.swift
//  TeslaSync — P4 shared surface · 0008 · AIBatteryHealthForecastNarrative (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: BatteryNarrativeInput) -> BatteryNarrativeModel {
        let source = InMemoryBatteryNarrativeSource(initial: input)
        let model = BatteryNarrativeModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Your pack is tracking ~3% below the fleet median for its age, and two habits explain most of it. \
    First, you charge to 100% on most days; holding a high state of charge accelerates calendar \
    ageing. Second, four DC fast-charge sessions last week added heat the cabin pre-conditioning \
    didn't fully offset. The forecast is unchanged — this only narrates the drivers behind it.
    """

    private func readyInput(
        stream: BatteryNarrativeStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: BatteryNarrativeConnection = .live
    ) -> BatteryNarrativeInput {
        BatteryNarrativeInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIBatteryHealthForecastNarrative(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            readyInput(stream: BatteryNarrativeStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            readyInput(stream: BatteryNarrativeStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            readyInput(stream: BatteryNarrativeStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIBatteryHealthForecastNarrative(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIBatteryHealthForecastNarrative(model: previewModel(BatteryNarrativeInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            BatteryNarrativeInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            readyInput(stream: BatteryNarrativeStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            readyInput(stream: BatteryNarrativeStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIBatteryHealthForecastNarrative(model: previewModel(
            BatteryNarrativeInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
