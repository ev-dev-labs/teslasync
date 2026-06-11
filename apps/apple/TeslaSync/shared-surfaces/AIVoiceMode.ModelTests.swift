//
//  AIVoiceMode.ModelTests.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  Coordinator coverage for `VoiceModeModel`: source wiring, the P1/S11 `view.opened` telemetry
//  (deferred past the gate, emitted once), the stale one-shot auto-refresh + re-arm, the send /
//  cancel / refresh / stop delegation, and the speech + transcript-draft coordination (dictation
//  start / result / error / end, the TTS mute, the Speak-to-Helix send with the trimmed message +
//  session id, the stop-all, the draft load / persist / clear, and the spoken-sentence flush off the
//  stream). Driven by the in-memory source + speech + draft doubles; no network, no microphone.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

/// Bundles the model with its in-memory doubles so a test can drive + assert on each seam.
@MainActor
private struct VoiceModeHarness {
    let model: VoiceModeModel
    let source: InMemoryVoiceModeSource
    let speech: InMemoryVoiceModeSpeechController
    let draft: InMemoryVoiceModeDraftStore
}

@MainActor
private func makeHarness(
    _ input: VoiceModeInput,
    speech: InMemoryVoiceModeSpeechController = InMemoryVoiceModeSpeechController(),
    draft: InMemoryVoiceModeDraftStore = InMemoryVoiceModeDraftStore(),
    telemetry: VoiceModeTelemetry = OSLogVoiceModeTelemetry()
) -> VoiceModeHarness {
    let source = InMemoryVoiceModeSource(initial: input)
    let model = VoiceModeModel(
        source: source,
        speech: speech,
        draftStore: draft,
        telemetry: telemetry,
        locale: enUS,
        sessionID: "voice_test_1"
    )
    return VoiceModeHarness(model: model, source: source, speech: speech, draft: draft)
}

private func enabled(
    connection: VoiceModeConnection = .live,
    stream: VoiceModeStreamSnapshot = .idle
) -> VoiceModeInput {
    VoiceModeInput(availability: .resolved(enabled: true), connection: connection, stream: stream)
}

// MARK: - Wiring + telemetry

@MainActor
final class VoiceModeModelWiringTests: XCTestCase {
    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyVoiceModeTelemetry()
        let harness = makeHarness(enabled(), telemetry: spy)
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIVoiceMode.surfaceSlug])
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyVoiceModeTelemetry()
        let harness = makeHarness(VoiceModeInput(availability: .resolved(enabled: false)), telemetry: spy)
        harness.model.start()
        XCTAssertTrue(harness.model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyVoiceModeTelemetry()
        let harness = makeHarness(VoiceModeInput(availability: .resolved(enabled: false)), telemetry: spy)
        harness.model.start()
        XCTAssertEqual(spy.surfaces, [])
        harness.source.push(enabled())
        XCTAssertFalse(harness.model.isGated)
        XCTAssertEqual(spy.surfaces, [AIVoiceMode.surfaceSlug])
        harness.source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIVoiceMode.surfaceSlug])
    }

    func testStopDelegatesAndReArms() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIVoiceMode.surfaceSlug, "AIVoiceMode")
    }
}

// MARK: - Connectivity auto-refresh

@MainActor
final class VoiceModeModelFreshnessTests: XCTestCase {
    func testStaleTransitionAutoRefreshesOnce() {
        let harness = makeHarness(enabled())
        harness.model.start()
        XCTAssertEqual(harness.source.refreshCount, 0)
        harness.source.push(enabled(connection: .stale))
        XCTAssertEqual(harness.model.connection, .stale)
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(enabled(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.source.push(enabled(connection: .offline))
        XCTAssertEqual(harness.model.connection, .offline)
        XCTAssertEqual(harness.source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.source.push(enabled(connection: .stale))
        harness.source.push(enabled(connection: .live))
        harness.source.push(enabled(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testManualRefreshDelegates() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 1)
    }
}

// MARK: - Dictation coordination (web SpeechRecognition)

@MainActor
final class VoiceModeModelDictationTests: XCTestCase {
    func testStartLoadsDraftIntoTranscript() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "saved question"))
        harness.model.start()
        XCTAssertEqual(harness.model.ready?.transcript.display, "saved question")
        XCTAssertEqual(harness.model.ready?.transcript.isHint, false)
        XCTAssertEqual(harness.model.ready?.canStart, true)
    }

    func testStartReadsSpeechSupportFromController() {
        let harness = makeHarness(enabled(), speech: InMemoryVoiceModeSpeechController(supported: false))
        harness.model.start()
        XCTAssertEqual(harness.model.ready?.mic.isDisabled, true)
        XCTAssertNotNil(harness.model.ready?.unsupportedHint)
    }

    func testToggleListeningStartsAndDelegates() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.toggleListening()
        XCTAssertEqual(harness.speech.startListeningCount, 1)
        XCTAssertEqual(harness.model.ready?.mic.isListening, true)
    }

    func testStartListeningUnsupportedSetsError() {
        let harness = makeHarness(enabled(), speech: InMemoryVoiceModeSpeechController(supported: false))
        harness.model.start()
        harness.model.startListening()
        XCTAssertEqual(harness.speech.startListeningCount, 0)
        XCTAssertNotNil(harness.model.ready?.sttError)
    }

    func testSttResultAppendsToTranscript() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.startListening()
        harness.speech.emitResult("hello world")
        XCTAssertEqual(harness.model.ready?.transcript.display, "hello world")
        XCTAssertEqual(harness.model.ready?.canStart, true)
    }

    func testSttResultAppendsToExistingBase() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "first"))
        harness.model.start()
        harness.model.startListening()
        harness.speech.emitResult("second")
        XCTAssertEqual(harness.model.ready?.transcript.display, "first second")
    }

    func testSttErrorSurfacesAndStopsListening() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.startListening()
        harness.speech.emitError("no-speech")
        XCTAssertEqual(harness.model.ready?.mic.isListening, false)
        XCTAssertEqual(harness.model.ready?.sttError, "Voice input failed: no-speech")
    }

    func testSttEndStopsListening() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.startListening()
        harness.speech.emitEnd()
        XCTAssertEqual(harness.model.ready?.mic.isListening, false)
    }

    func testStopListeningDelegates() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.startListening()
        harness.model.stopListening()
        XCTAssertEqual(harness.speech.stopListeningCount, 1)
        XCTAssertEqual(harness.model.ready?.mic.isListening, false)
    }
}

// MARK: - Playback + send + draft (web speechSynthesis / AIFeatureCard action / localStorage)

@MainActor
final class VoiceModeModelPlaybackTests: XCTestCase {
    func testToggleTtsMutesAndCancelsSpeech() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.toggleTts()
        XCTAssertEqual(harness.model.ready?.tts.isEnabled, false)
        XCTAssertEqual(harness.speech.cancelSpeechCount, 1)
    }

    func testHandleActionSendsTrimmedMessageAndSession() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "  ask me  "))
        harness.model.start()
        harness.model.handleAction()
        XCTAssertEqual(harness.source.sendCount, 1)
        XCTAssertEqual(harness.source.lastSentMessage, "ask me")
        XCTAssertEqual(harness.source.lastSentSessionID, "voice_test_1")
    }

    func testHandleActionNoopWithoutTranscript() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.handleAction()
        XCTAssertEqual(harness.source.sendCount, 0)
    }

    func testHandleStopAllDelegates() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.startListening()
        harness.model.handleStopAll()
        XCTAssertEqual(harness.source.cancelCount, 1)
        XCTAssertGreaterThanOrEqual(harness.speech.stopListeningCount, 1)
        XCTAssertGreaterThanOrEqual(harness.speech.cancelSpeechCount, 1)
    }

    func testStreamDeltaSpeaksSentencesWhenEnabled() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "q"))
        harness.model.start()
        harness.source.push(enabled(stream: VoiceModeStreamSnapshot(state: .streaming, text: "Hello there. ")))
        XCTAssertEqual(harness.speech.spokenSentences, ["Hello there."])
    }

    func testStreamDeltaDoesNotSpeakWhenMuted() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "q"))
        harness.model.start()
        harness.model.toggleTts()
        harness.source.push(enabled(stream: VoiceModeStreamSnapshot(state: .streaming, text: "Hello there. ")))
        XCTAssertEqual(harness.speech.spokenSentences, [])
    }

    func testDoneClearsTranscriptAndDraft() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "q"))
        harness.model.start()
        harness.source.push(enabled(stream: VoiceModeStreamSnapshot(state: .done, text: "Reply.")))
        XCTAssertEqual(harness.model.ready?.transcript.isHint, true)
        XCTAssertEqual(harness.draft.value, "")
    }

    func testSttResultPersistsDraft() {
        let harness = makeHarness(enabled())
        harness.model.start()
        harness.model.startListening()
        harness.speech.emitResult("hi")
        XCTAssertEqual(harness.draft.value, "hi")
    }

    func testStopClearsDraft() {
        let harness = makeHarness(enabled(), draft: InMemoryVoiceModeDraftStore(value: "q"))
        harness.model.start()
        harness.model.stop()
        XCTAssertGreaterThanOrEqual(harness.draft.clearCount, 1)
        XCTAssertEqual(harness.draft.value, "")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVoiceModeTelemetry: VoiceModeTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
