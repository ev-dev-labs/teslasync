//
//  AIVoiceMode.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL (fixed `/ai/voice/chat`) + body
//  (`{ "message": <trimmed>, "session_id": <id> }`), the voice session-id minting, the SSE frame
//  parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer, the
//  output / action derivations, the TTS sentence chunker (port of `popCompleteSentences`), and the
//  TTS feed coordinator (port of the `handleEvent` delta → speech buffering).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class VoiceModeChatRequestTests: XCTestCase {
    func testPathIsFixedVoiceChatRoute() {
        XCTAssertEqual(VoiceModeChatRequest.path, "/ai/voice/chat")
        XCTAssertEqual(
            VoiceModeChatRequest(transcript: "hi", sessionID: "voice_1_ab").path,
            "/ai/voice/chat"
        )
    }

    func testMessageIsTrimmed() {
        // Web `transcript.trim()`.
        let request = VoiceModeChatRequest(transcript: "  how far can I drive?\n", sessionID: "s")
        XCTAssertEqual(request.message, "how far can I drive?")
    }

    func testBodyCarriesMessageAndSessionID() {
        let request = VoiceModeChatRequest(transcript: " hello ", sessionID: "voice_9_zz")
        XCTAssertEqual(request.body, ["message": "hello", "session_id": "voice_9_zz"])
    }

    func testEncodedBodyHasSortedKeys() throws {
        let data = try VoiceModeChatRequest(transcript: "hey", sessionID: "voice_2_qq").encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"message\":\"hey\",\"session_id\":\"voice_2_qq\"}")
    }
}

// MARK: - Voice session id (web `newVoiceSessionId`)

final class VoiceModeSessionTests: XCTestCase {
    func testIDComposesPrefixMillisSuffix() {
        XCTAssertEqual(
            VoiceModeSession.id(millis: 1_700_000_000_000, suffix: "abcd1234"),
            "voice_1700000000000_abcd1234"
        )
    }

    func testNewIDUsesPrefixAndInjectedSuffix() {
        let id = VoiceModeSession.newID(now: Date(timeIntervalSince1970: 1), random: { "deadbeef" })
        XCTAssertEqual(id, "voice_1000_deadbeef")
        XCTAssertTrue(id.hasPrefix(VoiceModeSession.prefix))
    }

    func testRandomSuffixIsEightBase36Chars() {
        let suffix = VoiceModeSession.randomSuffix()
        XCTAssertEqual(suffix.count, 8)
        XCTAssertTrue(suffix.allSatisfy { $0.isNumber || ($0.isLetter && $0.isLowercase) })
    }
}

// MARK: - TTS sentence chunker (web `popCompleteSentences`)

final class VoiceModeSentenceChunkerTests: XCTestCase {
    func testTwoSentencesEmptyRemainder() {
        let result = VoiceModeSentenceChunker.pop("Hello there. How are you? ")
        XCTAssertEqual(result.spoken, ["Hello there.", "How are you?"])
        XCTAssertEqual(result.remainder, "")
    }

    func testNoTerminatorKeepsRemainder() {
        let result = VoiceModeSentenceChunker.pop("an unfinished thought")
        XCTAssertEqual(result.spoken, [])
        XCTAssertEqual(result.remainder, "an unfinished thought")
    }

    func testTerminatorWithoutWhitespaceStaysInRemainder() {
        // Web boundary requires `\s+` after the terminator; "2024.20" has no whitespace after the dot.
        let result = VoiceModeSentenceChunker.pop("version 2024.20")
        XCTAssertEqual(result.spoken, [])
        XCTAssertEqual(result.remainder, "version 2024.20")
    }

    func testAllTerminatorKinds() {
        let result = VoiceModeSentenceChunker.pop("Stop! Wait? Go. ")
        XCTAssertEqual(result.spoken, ["Stop!", "Wait?", "Go."])
        XCTAssertEqual(result.remainder, "")
    }

    func testTrailingUnterminatedRemainderKept() {
        let result = VoiceModeSentenceChunker.pop("Done. Now the tail")
        XCTAssertEqual(result.spoken, ["Done."])
        XCTAssertEqual(result.remainder, "Now the tail")
    }
}

// MARK: - TTS feed coordinator (web `handleEvent` delta → speech buffering)

final class VoiceModeTtsCoordinatorTests: XCTestCase {
    func testFlushesCompleteSentencesWhileEnabled() {
        let step = VoiceModeTtsCoordinator.step(
            feed: VoiceModeTtsFeed(),
            snapshot: VoiceModeStreamSnapshot(state: .streaming, text: "Hello there. More"),
            ttsEnabled: true
        )
        XCTAssertEqual(step.sentences, ["Hello there."])
        XCTAssertEqual(step.feed.buffer, "More")
        XCTAssertEqual(step.feed.consumedLength, "Hello there. More".count)
        XCTAssertFalse(step.cancelSpeech)
    }

    func testResetsBufferOnFreshStream() {
        let primed = VoiceModeTtsFeed(buffer: "stale", consumedLength: 99)
        let step = VoiceModeTtsCoordinator.step(
            feed: primed,
            snapshot: VoiceModeStreamSnapshot(state: .streaming, text: ""),
            ttsEnabled: true
        )
        XCTAssertEqual(step.feed.buffer, "")
        XCTAssertEqual(step.feed.consumedLength, 0)
        XCTAssertEqual(step.sentences, [])
    }

    func testMutedAdvancesCursorWithoutSpeaking() {
        let step = VoiceModeTtsCoordinator.step(
            feed: VoiceModeTtsFeed(),
            snapshot: VoiceModeStreamSnapshot(state: .streaming, text: "Quiet please. "),
            ttsEnabled: false
        )
        XCTAssertEqual(step.sentences, [])
        XCTAssertEqual(step.feed.buffer, "")
        XCTAssertEqual(step.feed.consumedLength, "Quiet please. ".count)
    }

    func testReEnableSpeaksOnlySubsequentDeltas() {
        // Muted through the first delta, then enabled — only the new text is spoken (web parity).
        let muted = VoiceModeTtsCoordinator.step(
            feed: VoiceModeTtsFeed(),
            snapshot: VoiceModeStreamSnapshot(state: .streaming, text: "First sentence. "),
            ttsEnabled: false
        )
        let enabled = VoiceModeTtsCoordinator.step(
            feed: muted.feed,
            snapshot: VoiceModeStreamSnapshot(state: .streaming, text: "First sentence. Second sentence. "),
            ttsEnabled: true
        )
        XCTAssertEqual(enabled.sentences, ["Second sentence."])
    }

    func testDoneSpeaksUnterminatedTail() {
        let priming = VoiceModeTtsCoordinator.step(
            feed: VoiceModeTtsFeed(),
            snapshot: VoiceModeStreamSnapshot(state: .streaming, text: "No terminator yet"),
            ttsEnabled: true
        )
        XCTAssertEqual(priming.sentences, [])
        let done = VoiceModeTtsCoordinator.step(
            feed: priming.feed,
            snapshot: VoiceModeStreamSnapshot(state: .done, text: "No terminator yet"),
            ttsEnabled: true
        )
        XCTAssertEqual(done.sentences, ["No terminator yet"])
        XCTAssertEqual(done.feed.buffer, "")
    }

    func testErrorClearsBufferAndSignalsCancel() {
        let step = VoiceModeTtsCoordinator.step(
            feed: VoiceModeTtsFeed(buffer: "partial", consumedLength: 3),
            snapshot: VoiceModeStreamSnapshot(state: .error, text: "partial", error: "boom"),
            ttsEnabled: true
        )
        XCTAssertTrue(step.cancelSpeech)
        XCTAssertEqual(step.feed.buffer, "")
        XCTAssertEqual(step.sentences, [])
    }
}

// MARK: - Accessibility

final class VoiceModeAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            VoiceModeAccessibility.actionLabel(ask: "Ask Helix", context: "Speak to Helix"),
            "Ask Helix · Speak to Helix"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            VoiceModeAccessibility.outputLabel("Helix voice reply", "You drove 214 miles."),
            "Helix voice reply: You drove 214 miles."
        )
    }
}
