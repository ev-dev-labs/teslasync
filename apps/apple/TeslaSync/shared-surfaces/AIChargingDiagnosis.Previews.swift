//
//  AIChargingDiagnosis.Previews.swift
//  TeslaSync — P4 shared surface · 0011 · AIChargingDiagnosis (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-session,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: ChargingDiagnosisInput) -> ChargingDiagnosisModel {
        let source = InMemoryChargingDiagnosisSource(initial: input)
        let model = ChargingDiagnosisModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleSessionID = "4821"

    private let sampleProse = """
    This session was flagged on two counts. It charged at a trickle for most of its length — the pack \
    sat near 1.4 kW on a 240 V circuit, so the 18% you added took just over four hours. It also lands \
    in your "expensive" bucket: the whole window fell inside peak tariff, pushing the effective rate \
    to about $0.41/kWh versus your $0.16 overnight baseline. Nothing was interrupted and power never \
    dropped out — the low-power reading is the wall circuit, not the car. Moving this session to your \
    off-peak schedule would clear both flags.
    """

    private func readyInput(
        stream: ChargingDiagnosisStreamSnapshot,
        sessionID: String? = sampleSessionID,
        connection: ChargingDiagnosisConnection = .live
    ) -> ChargingDiagnosisInput {
        ChargingDiagnosisInput(
            availability: .resolved(enabled: true),
            sessionID: sessionID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIChargingDiagnosis(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIChargingDiagnosis(model: previewModel(
            readyInput(stream: ChargingDiagnosisStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIChargingDiagnosis(model: previewModel(
            readyInput(stream: ChargingDiagnosisStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIChargingDiagnosis(model: previewModel(
            readyInput(stream: ChargingDiagnosisStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no session") {
        AIChargingDiagnosis(model: previewModel(readyInput(stream: .idle, sessionID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIChargingDiagnosis(model: previewModel(ChargingDiagnosisInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIChargingDiagnosis(model: previewModel(
            ChargingDiagnosisInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIChargingDiagnosis(model: previewModel(
            readyInput(stream: ChargingDiagnosisStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIChargingDiagnosis(model: previewModel(
            readyInput(stream: ChargingDiagnosisStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIChargingDiagnosis(model: previewModel(
            ChargingDiagnosisInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
