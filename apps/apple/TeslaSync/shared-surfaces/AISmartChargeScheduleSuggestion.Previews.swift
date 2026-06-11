//
//  AISmartChargeScheduleSuggestion.Previews.swift
//  TeslaSync — P4 shared surface · 0047 · AISmartChargeScheduleSuggestion (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  missing-inputs, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SmartChargeScheduleInput) -> SmartChargeScheduleModel {
        let source = InMemorySmartChargeScheduleSource(initial: input)
        let model = SmartChargeScheduleModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7
    private let sampleRatePlan = "pge-ev2a"

    private let sampleProse = """
    Proposed charge window: 00:30–05:10 tonight. Charging is deferred to the EV2-A off-peak band \
    (midnight–06:00) where energy is roughly $0.24/kWh versus $0.51/kWh on-peak, so the session adds \
    the ~38 kWh needed to reach 80% at the cheapest rate while still finishing about 50 minutes before \
    your 06:00 departure. The schedule assumes a 240 V supply at 32 A. Nothing is applied yet — review \
    the window and tap Schedule to apply it, or adjust the rate plan and target SOC above and re-draft.
    """

    private func readyInput(
        stream: SmartChargeScheduleStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        ratePlanID: String? = sampleRatePlan,
        connection: SmartChargeScheduleConnection = .live
    ) -> SmartChargeScheduleInput {
        SmartChargeScheduleInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            ratePlanID: ratePlanID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AISmartChargeScheduleSuggestion(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            readyInput(stream: SmartChargeScheduleStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            readyInput(stream: SmartChargeScheduleStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            readyInput(stream: SmartChargeScheduleStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · missing inputs") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            readyInput(stream: .idle, vehicleID: nil, ratePlanID: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            SmartChargeScheduleInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            SmartChargeScheduleInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            readyInput(
                stream: SmartChargeScheduleStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            readyInput(
                stream: SmartChargeScheduleStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AISmartChargeScheduleSuggestion(model: previewModel(
            SmartChargeScheduleInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
