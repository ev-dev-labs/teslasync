//
//  AIAlertTuningSuggestions.Previews.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / with-proposal /
//  stream-error / no-rule, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: AlertTuningInput) -> AlertTuningSuggestionsModel {
        let source = InMemoryAlertTuningSource(initial: input)
        let model = AlertTuningSuggestionsModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleRule = 42
    private let sampleVehicle = 7

    private let sampleProse = """
    Battery-low fired 14 times last week, 9 of them within the 30-minute cooldown of a prior firing. \
    Raising the threshold to 15% and the cooldown to 45 minutes would have suppressed 7 of those \
    duplicates while still catching every genuinely-low event — review the patch before saving.
    """

    private let samplePatch = AlertRuleDraftPatch(
        valueNum: 15,
        cooldownMin: 45,
        severity: "warn",
        triggerMode: "repeat",
        op: "<"
    )

    private func readyInput(
        stream: AlertTuningStreamSnapshot,
        ruleID: Int? = sampleRule,
        connection: AlertTuningConnection = .live
    ) -> AlertTuningInput {
        AlertTuningInput(
            availability: .resolved(enabled: true),
            ruleID: ruleID,
            vehicleID: sampleVehicle,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIAlertTuningSuggestions(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIAlertTuningSuggestions(model: previewModel(
            readyInput(stream: AlertTuningStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIAlertTuningSuggestions(model: previewModel(
            readyInput(stream: AlertTuningStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · with proposal") {
        AIAlertTuningSuggestions(model: previewModel(
            readyInput(stream: AlertTuningStreamSnapshot(state: .done, text: sampleProse, proposal: samplePatch))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIAlertTuningSuggestions(model: previewModel(
            readyInput(stream: AlertTuningStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no rule") {
        AIAlertTuningSuggestions(model: previewModel(readyInput(stream: .idle, ruleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIAlertTuningSuggestions(model: previewModel(AlertTuningInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIAlertTuningSuggestions(model: previewModel(
            AlertTuningInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIAlertTuningSuggestions(model: previewModel(
            readyInput(
                stream: AlertTuningStreamSnapshot(state: .done, text: sampleProse, proposal: samplePatch),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIAlertTuningSuggestions(model: previewModel(
            readyInput(
                stream: AlertTuningStreamSnapshot(state: .done, text: sampleProse, proposal: samplePatch),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIAlertTuningSuggestions(model: previewModel(
            AlertTuningInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
