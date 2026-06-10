//
//  AISafetySettingExplainer.Previews.swift
//  TeslaSync — P4 shared surface · 0045 · AISafetySettingExplainer (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  paused-confirm, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SafetySettingExplainerInput) -> SafetySettingExplainerModel {
        let source = InMemorySafetySettingExplainerSource(initial: input)
        let model = SafetySettingExplainerModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleProse = """
    Your safety settings are mostly at their defaults. Quiet hours are off, so critical alerts can \
    reach you at any time; the alert digest is set to "immediate", meaning each alert is delivered as \
    it happens rather than batched. Critical-flash signalling and the tab badge are both on. The \
    api_suspended operational gate is off, so commands are enabled. These are the current values from \
    your install — Helix only explains them; use the controls on this page to change anything.
    """

    private func readyInput(
        stream: SafetySettingExplainerStreamSnapshot,
        connection: SafetySettingExplainerConnection = .live
    ) -> SafetySettingExplainerInput {
        SafetySettingExplainerInput(
            availability: .resolved(enabled: true),
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AISafetySettingExplainer(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AISafetySettingExplainer(model: previewModel(
            readyInput(stream: SafetySettingExplainerStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AISafetySettingExplainer(model: previewModel(
            readyInput(stream: SafetySettingExplainerStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AISafetySettingExplainer(model: previewModel(
            readyInput(stream: SafetySettingExplainerStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · paused-confirm") {
        // canStart is false (web `state !== 'paused-confirm'`) so the action is disabled; the
        // accumulated prose stays visible.
        AISafetySettingExplainer(model: previewModel(
            readyInput(stream: SafetySettingExplainerStreamSnapshot(state: .pausedConfirm, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AISafetySettingExplainer(model: previewModel(
            SafetySettingExplainerInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AISafetySettingExplainer(model: previewModel(
            SafetySettingExplainerInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISafetySettingExplainer(model: previewModel(
            readyInput(
                stream: SafetySettingExplainerStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISafetySettingExplainer(model: previewModel(
            readyInput(
                stream: SafetySettingExplainerStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AISafetySettingExplainer(model: previewModel(
            SafetySettingExplainerInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
