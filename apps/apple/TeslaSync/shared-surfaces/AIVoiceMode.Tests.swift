//
//  AIVoiceMode.Tests.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  Projection coverage for the AIVoiceMode surface: gated / loading / error / ready phases, the
//  `canStart = transcript.trim() > 0 && !busy` rule, the header empty-hint flip, the Ask-Helix label
//  flip, the voice input slot (transcript box hint / text, mic start ⇆ stop + disabled rule, the
//  Mute ⇆ Unmute toggle, the in-flight Stop control, the dictation-error passthrough, the
//  unsupported hint), and every localized `AiOutputPanel` branch. The coordinator (state holder +
//  speech / draft delegation) is covered in AIVoiceMode.ModelTests.swift.
//
//  In the hosted test bundle the per-surface strings table resolves to the web English values, which
//  equal the code fallbacks, so these assertions check the parity copy directly.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func ready(
    transcript: String = "",
    listening: Bool = false,
    ttsEnabled: Bool = true,
    sttError: String? = nil,
    speechSupported: Bool = true,
    stream: VoiceModeStreamSnapshot = .idle
) -> VoiceModeReady {
    let ui = VoiceModeUIState(
        transcript: transcript,
        listening: listening,
        ttsEnabled: ttsEnabled,
        sttError: sttError,
        speechSupported: speechSupported
    )
    let input = VoiceModeInput(availability: .resolved(enabled: true), connection: .live, stream: stream)
    return VoiceModeProjection.resolve(input: input, ui: ui, locale: enUS).ready!
}

// MARK: - Projection phases

final class VoiceModeProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = VoiceModeProjection.resolve(
            input: VoiceModeInput(availability: .resolved(enabled: false)),
            ui: VoiceModeUIState(),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = VoiceModeProjection.resolve(
            input: VoiceModeInput(availability: .loading),
            ui: VoiceModeUIState(),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = VoiceModeProjection.resolve(
            input: VoiceModeInput(availability: .failed("boom")),
            ui: VoiceModeUIState(),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testReadyWhenEnabled() {
        let resolved = VoiceModeProjection.resolve(
            input: VoiceModeInput(availability: .resolved(enabled: true)),
            ui: VoiceModeUIState(),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Ready card header + action

final class VoiceModeProjectionReadyTests: XCTestCase {
    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Voice mode")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertEqual(card.buttonContext, "Speak to Helix")
        XCTAssertTrue(card.description.contains("stay on this device"))
        XCTAssertTrue(card.description.contains("never the raw audio"))
    }

    func testCanStartRequiresTranscriptAndNotBusy() {
        XCTAssertTrue(ready(transcript: "how far can I go?").canStart)
        XCTAssertFalse(ready(transcript: "").canStart)
        XCTAssertFalse(ready(transcript: "   ").canStart)
        XCTAssertFalse(ready(transcript: "hi", stream: VoiceModeStreamSnapshot(state: .streaming)).canStart)
        XCTAssertFalse(ready(transcript: "hi", stream: VoiceModeStreamSnapshot(state: .pausedConfirm)).canStart)
    }

    func testEmptyHintShownOnlyWhenNoTranscript() {
        XCTAssertEqual(ready(transcript: "").emptyHint, "Tap the mic and dictate a question first.")
        XCTAssertNil(ready(transcript: "hello").emptyHint)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(transcript: "hi", stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
        XCTAssertFalse(card.action.isDisabled)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(transcript: "hi", stream: VoiceModeStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
        XCTAssertTrue(card.action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready(transcript: "hi").actionAccessibilityLabel, "Ask Helix · Speak to Helix")
    }
}

// MARK: - Transcript box

final class VoiceModeProjectionTranscriptTests: XCTestCase {
    func testIdleHintWhenEmptyAndNotListening() {
        let view = ready(transcript: "").transcript
        XCTAssertTrue(view.isHint)
        XCTAssertEqual(view.display, "Tap the mic and ask Helix anything about your Tesla.")
    }

    func testListeningHintWhenEmptyAndListening() {
        let view = ready(transcript: "", listening: true).transcript
        XCTAssertTrue(view.isHint)
        XCTAssertEqual(view.display, "Listening \u{2014} speak now\u{2026}")
    }

    func testShowsTranscriptWhenPresent() {
        let view = ready(transcript: "How far can I drive?").transcript
        XCTAssertFalse(view.isHint)
        XCTAssertEqual(view.display, "How far can I drive?")
        XCTAssertTrue(view.accessibilityLabel.contains("Voice transcript"))
    }
}

// MARK: - Mic / TTS / stop controls

final class VoiceModeProjectionControlsTests: XCTestCase {
    func testMicStartFormWhenIdle() {
        let mic = ready(transcript: "hi").mic
        XCTAssertFalse(mic.isListening)
        XCTAssertEqual(mic.title, "Speak")
        XCTAssertEqual(mic.accessibilityLabel, "Start listening")
        XCTAssertFalse(mic.isDisabled)
    }

    func testMicStopFormWhenListening() {
        let mic = ready(listening: true).mic
        XCTAssertTrue(mic.isListening)
        XCTAssertEqual(mic.title, "Stop mic")
        XCTAssertEqual(mic.accessibilityLabel, "Stop listening")
        XCTAssertFalse(mic.isDisabled)
    }

    func testMicDisabledWhenUnsupportedOrBusy() {
        XCTAssertTrue(ready(speechSupported: false).mic.isDisabled)
        XCTAssertTrue(ready(transcript: "hi", stream: VoiceModeStreamSnapshot(state: .streaming)).mic.isDisabled)
    }

    func testTtsToggleLabels() {
        let muted = ready(ttsEnabled: false).tts
        XCTAssertFalse(muted.isEnabled)
        XCTAssertEqual(muted.title, "Unmute Helix")
        XCTAssertEqual(muted.accessibilityLabel, "Unmute spoken replies")

        let enabled = ready(ttsEnabled: true).tts
        XCTAssertTrue(enabled.isEnabled)
        XCTAssertEqual(enabled.title, "Mute Helix")
        XCTAssertEqual(enabled.accessibilityLabel, "Mute spoken replies")
    }

    func testStopControlOnlyWhenBusy() {
        XCTAssertNil(ready(transcript: "hi", stream: .idle).stop)
        let stop = ready(transcript: "hi", stream: VoiceModeStreamSnapshot(state: .streaming)).stop
        XCTAssertEqual(stop?.title, "Stop")
        XCTAssertEqual(stop?.accessibilityLabel, "Stop Helix")
    }

    func testSttErrorPassThrough() {
        XCTAssertEqual(ready(sttError: "Voice input failed: no-speech").sttError, "Voice input failed: no-speech")
        XCTAssertNil(ready().sttError)
    }

    func testUnsupportedHintOnlyWhenUnsupportedAndNoError() {
        XCTAssertNotNil(ready(speechSupported: false).unsupportedHint)
        XCTAssertEqual(
            ready(speechSupported: false).unsupportedHint?.contains("isn\u{2019}t available"),
            true
        )
        XCTAssertNil(ready(speechSupported: true).unsupportedHint)
        XCTAssertNil(ready(sttError: "boom", speechSupported: false).unsupportedHint)
    }
}

// MARK: - Output branches

final class VoiceModeProjectionOutputTests: XCTestCase {
    private func output(transcript: String = "", stream: VoiceModeStreamSnapshot) -> VoiceModeResolvedOutput {
        ready(transcript: transcript, stream: stream).output
    }

    func testEmptyHintWhenIdleWithTranscript() {
        let out = output(transcript: "hi", stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No reply yet"))
    }

    func testNoTranscriptHintWhenIdleWithoutTranscript() {
        let out = output(transcript: "", stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Dictate or type"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(transcript: "hi", stream: VoiceModeStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: VoiceModeStreamSnapshot(state: .streaming, text: "You drove 214 miles."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "You drove 214 miles.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: VoiceModeStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: VoiceModeStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}
