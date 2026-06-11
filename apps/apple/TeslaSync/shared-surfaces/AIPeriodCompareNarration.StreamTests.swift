//
//  AIPeriodCompareNarration.StreamTests.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  Stream-machinery unit coverage (Foundation-only) split out of the adapter tests for the lint
//  budget: the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`) and the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure). Exercises the exact web frame grammar + lifecycle.
//

import XCTest
@testable import TeslaSync

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class PeriodCompareNarrationSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"narrate\"}"),
            .toolCall(id: "c1", name: "narrate")
        )
    }

    func testParsesToolResult() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"narrate\",\"ok\":true}"
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse(frame),
            .toolResult(id: "c1", name: "narrate", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            PeriodCompareNarrationSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(PeriodCompareNarrationSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(PeriodCompareNarrationSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(PeriodCompareNarrationSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(PeriodCompareNarrationSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class PeriodCompareNarrationStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = PeriodCompareNarrationStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = PeriodCompareNarrationStreamReducer.start()
        snapshot = PeriodCompareNarrationStreamReducer.reduce(snapshot, .delta(text: "Period A "))
        snapshot = PeriodCompareNarrationStreamReducer.reduce(snapshot, .delta(text: "improved."))
        XCTAssertEqual(snapshot.text, "Period A improved.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = PeriodCompareNarrationStreamReducer.reduce(
            PeriodCompareNarrationStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = PeriodCompareNarrationStreamReducer.reduce(
            PeriodCompareNarrationStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = PeriodCompareNarrationStreamReducer.reduce(
            PeriodCompareNarrationStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = PeriodCompareNarrationStreamReducer.start()
        XCTAssertEqual(PeriodCompareNarrationStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            PeriodCompareNarrationStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = PeriodCompareNarrationStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = PeriodCompareNarrationStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}
