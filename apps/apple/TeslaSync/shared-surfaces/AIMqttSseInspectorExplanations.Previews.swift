//
//  AIMqttSseInspectorExplanations.Previews.swift
//  TeslaSync — P4 shared surface · 0028 · AIMqttSseInspectorExplanations (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-window, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: MqttSseExplainerInput) -> MqttSseExplainerModel {
        let source = InMemoryMqttSseExplainerSource(initial: input)
        let model = MqttSseExplainerModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    // A valid 30-minute window: now-30min → now (the parent MQTTInspectorPage default).
    private let sampleFromUnix = 1_717_000_000
    private let sampleToUnix = 1_717_001_800

    private let sampleProse = """
    The MQTT broker is connected with 8 of 8 vehicles streaming; the busiest stream is the drive-state \
    telemetry topic at roughly 42 messages per second. The SSE hub has 3 connected dashboard clients and \
    has fanned out 1,204 events in the window with no dropped subscriptions. All four background jobs \
    (signal_log flusher, drive reconciler, charge reconciler, geocoder) reported fresh within the last \
    15 seconds. Nothing in the envelope indicates backpressure or a stalled consumer. This explanation \
    only restates the deterministic broker-status snapshot above; it does not infer a fault that the \
    metrics do not show.
    """

    private func readyInput(
        stream: MqttSseExplainerStreamSnapshot,
        fromUnix: Int? = sampleFromUnix,
        toUnix: Int? = sampleToUnix,
        connection: MqttSseExplainerConnection = .live
    ) -> MqttSseExplainerInput {
        MqttSseExplainerInput(
            availability: .resolved(enabled: true),
            fromUnix: fromUnix,
            toUnix: toUnix,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIMqttSseInspectorExplanations(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIMqttSseInspectorExplanations(model: previewModel(
            readyInput(stream: MqttSseExplainerStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIMqttSseInspectorExplanations(model: previewModel(
            readyInput(stream: MqttSseExplainerStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIMqttSseInspectorExplanations(model: previewModel(
            readyInput(stream: MqttSseExplainerStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no window") {
        AIMqttSseInspectorExplanations(model: previewModel(
            readyInput(stream: .idle, fromUnix: nil, toUnix: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIMqttSseInspectorExplanations(model: previewModel(MqttSseExplainerInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIMqttSseInspectorExplanations(model: previewModel(
            MqttSseExplainerInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIMqttSseInspectorExplanations(model: previewModel(
            readyInput(
                stream: MqttSseExplainerStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIMqttSseInspectorExplanations(model: previewModel(
            readyInput(
                stream: MqttSseExplainerStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIMqttSseInspectorExplanations(model: previewModel(
            MqttSseExplainerInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
