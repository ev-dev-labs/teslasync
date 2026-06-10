//
//  AIDataRepairSuggestions.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0015 · AIDataRepairSuggestions (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request (empty `{}` body, the
//  /ai/system/data-repair/draft path), the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class DataRepairRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(DataRepairDraftRequest.path, "/ai/system/data-repair/draft")
    }

    func testBodyIsEmpty() {
        // Web `body = useMemo(() => ({}), [])`: no vehicle_id / window param.
        XCTAssertTrue(DataRepairDraftRequest().body.isEmpty)
    }

    func testEncodedBodyIsEmptyObject() throws {
        let data = try DataRepairDraftRequest().encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class DataRepairSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(DataRepairSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(DataRepairSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"close\"}"),
            .toolCall(id: "c1", name: "close")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"close\",\"ok\":true}"),
            .toolResult(id: "c1", name: "close", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"close\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            DataRepairSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "close", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            DataRepairSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(DataRepairSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(DataRepairSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(DataRepairSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(DataRepairSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class DataRepairStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = DataRepairStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = DataRepairStreamReducer.start()
        snapshot = DataRepairStreamReducer.reduce(snapshot, .delta(text: "Close "))
        snapshot = DataRepairStreamReducer.reduce(snapshot, .delta(text: "session."))
        XCTAssertEqual(snapshot.text, "Close session.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = DataRepairStreamReducer.reduce(
            DataRepairStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = DataRepairStreamReducer.reduce(
            DataRepairStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = DataRepairStreamReducer.reduce(
            DataRepairStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = DataRepairStreamReducer.start()
        XCTAssertEqual(DataRepairStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(DataRepairStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = DataRepairStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = DataRepairStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class DataRepairOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(DataRepairOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(DataRepairOutput.derive(DataRepairStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(DataRepairOutput.derive(DataRepairStreamSnapshot(state: .streaming, text: "")), .thinking)
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            DataRepairOutput.derive(DataRepairStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            DataRepairOutput.derive(DataRepairStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(DataRepairOutput.derive(DataRepairStreamSnapshot(state: .done, text: "")), .prose(""))
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            DataRepairOutput.derive(DataRepairStreamSnapshot(state: .error, text: "", error: "stream_http_500")),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            DataRepairOutput.derive(DataRepairStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class DataRepairActionDeriveTests: XCTestCase {
    func testIdleWhenCanStartIsEnabled() {
        let action = DataRepairAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        // Web `canStart = state !== 'streaming'` → canStart is false while streaming.
        let action = DataRepairAction.derive(canStart: false, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testDoneAndErrorAreEnabled() {
        XCTAssertFalse(DataRepairAction.derive(canStart: true, state: .done).isDisabled)
        XCTAssertFalse(DataRepairAction.derive(canStart: true, state: .error).isDisabled)
    }

    func testNotCanStartIsDisabledEvenWhenIdle() {
        XCTAssertTrue(DataRepairAction.derive(canStart: false, state: .idle).isDisabled)
    }
}
