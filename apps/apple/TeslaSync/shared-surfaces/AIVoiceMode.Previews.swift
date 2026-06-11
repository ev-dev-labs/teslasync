//
//  AIVoiceMode.Previews.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  Xcode previews for each surface state (ready · idle / transcript / listening / thinking / prose /
//  stream-error / muted / unsupported, loading, gate error, stale, offline, gated). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. All previews use the
//  in-memory speech + draft doubles, so no microphone or synthesizer is touched.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: VoiceModeInput,
        draft: String = "",
        supported: Bool = true,
        listening: Bool = false,
        muted: Bool = false
    ) -> VoiceModeModel {
        let source = InMemoryVoiceModeSource(initial: input)
        let speech = InMemoryVoiceModeSpeechController(supported: supported)
        let store = InMemoryVoiceModeDraftStore(value: draft)
        let model = VoiceModeModel(
            source: source,
            speech: speech,
            draftStore: store,
            locale: Locale(identifier: "en_US")
        )
        model.start()
        if listening { model.startListening() }
        if muted { model.toggleTts() }
        return model
    }

    private let sampleQuestion = "How efficient was my last road trip?"

    private let sampleProse = """
    Your last road trip covered 214 miles at an average of 268 watt-hours per mile, a touch better \
    than your lifetime average. Regen recovered about 31 miles of range on the descents, and the \
    cabin pre-conditioning before each leg cost roughly 4 percent of the pack. Overall it was one of \
    your more efficient long drives this year.
    """

    private func readyInput(
        stream: VoiceModeStreamSnapshot,
        connection: VoiceModeConnection = .live
    ) -> VoiceModeInput {
        VoiceModeInput(availability: .resolved(enabled: true), connection: connection, stream: stream)
    }

    #Preview("Ready · idle") {
        AIVoiceMode(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · transcript") {
        AIVoiceMode(model: previewModel(readyInput(stream: .idle), draft: sampleQuestion))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · listening") {
        AIVoiceMode(model: previewModel(readyInput(stream: .idle), listening: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIVoiceMode(model: previewModel(
            readyInput(stream: VoiceModeStreamSnapshot(state: .streaming, text: "")),
            draft: sampleQuestion
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIVoiceMode(model: previewModel(
            readyInput(stream: VoiceModeStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIVoiceMode(model: previewModel(
            readyInput(stream: VoiceModeStreamSnapshot(state: .error, text: "", error: "stream_http_429")),
            draft: sampleQuestion
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · muted") {
        AIVoiceMode(model: previewModel(readyInput(stream: .idle), draft: sampleQuestion, muted: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · dictation unsupported") {
        AIVoiceMode(model: previewModel(readyInput(stream: .idle), supported: false))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIVoiceMode(model: previewModel(VoiceModeInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIVoiceMode(model: previewModel(VoiceModeInput(availability: .failed("Network request timed out"))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIVoiceMode(model: previewModel(
            readyInput(stream: VoiceModeStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIVoiceMode(model: previewModel(
            readyInput(stream: VoiceModeStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIVoiceMode(model: previewModel(VoiceModeInput(availability: .resolved(enabled: false))))
            .padding()
            .background(Color.TS.bg)
    }
#endif
