//
//  AIVoiceMode.StreamTests.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  Stream-port unit coverage (Foundation-only): the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract). Split from
//  AIVoiceMode.AdapterTests.swift to keep each test file within the project's length budget.
//

import XCTest
@testable import TeslaSync

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class VoiceModeSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            VoiceModeSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(VoiceModeSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            VoiceModeSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            VoiceModeSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(VoiceModeSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            VoiceModeSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"chat\"}"),
            .toolCall(id: "c1", name: "chat")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            VoiceModeSSEFrame.parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"chat\",\"ok\":true}"),
            .toolResult(id: "c1", name: "chat", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            VoiceModeSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            VoiceModeSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(VoiceModeSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"), .delta(text: "y"))
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(VoiceModeSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(VoiceModeSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(VoiceModeSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(VoiceModeSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class VoiceModeStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = VoiceModeStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = VoiceModeStreamReducer.start()
        snapshot = VoiceModeStreamReducer.reduce(snapshot, .delta(text: "You drove "))
        snapshot = VoiceModeStreamReducer.reduce(snapshot, .delta(text: "214 miles."))
        XCTAssertEqual(snapshot.text, "You drove 214 miles.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = VoiceModeStreamReducer.reduce(
            VoiceModeStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = VoiceModeStreamReducer.reduce(VoiceModeStreamReducer.start(), .failure(message: "rate_limited"))
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = VoiceModeStreamReducer.reduce(
            VoiceModeStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
        XCTAssertTrue(snapshot.isBusy)
    }

    func testToolEventsDoNotMutateState() {
        let start = VoiceModeStreamReducer.start()
        XCTAssertEqual(VoiceModeStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(VoiceModeStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = VoiceModeStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = VoiceModeStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class VoiceModeOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(VoiceModeOutput.derive(.idle), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            VoiceModeOutput.derive(VoiceModeStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            VoiceModeOutput.derive(VoiceModeStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            VoiceModeOutput.derive(VoiceModeStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            VoiceModeOutput.derive(VoiceModeStreamSnapshot(state: .error, text: "", error: "stream_http_500")),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            VoiceModeOutput.derive(VoiceModeStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class VoiceModeActionDeriveTests: XCTestCase {
    func testCanStartIdleIsEnabled() {
        let action = VoiceModeAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = VoiceModeAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoTranscriptIsDisabled() {
        XCTAssertTrue(VoiceModeAction.derive(canStart: false, state: .idle).isDisabled)
    }
}
