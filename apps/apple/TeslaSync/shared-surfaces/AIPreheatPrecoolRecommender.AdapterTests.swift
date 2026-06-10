//
//  AIPreheatPrecoolRecommender.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  Adapter-level unit coverage (Foundation-only) for the SSE / stream core
//  (AIPreheatPrecoolRecommender.Adapter.swift): the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract). The request / vehicle-coercion /
//  gate coverage lives in the sibling `AIPreheatPrecoolRecommender.RequestTests.swift`.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class PreheatPrecoolSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(PreheatPrecoolSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(PreheatPrecoolSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"draft\"}"),
            .toolCall(id: "c1", name: "draft")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"draft\",\"ok\":true}"),
            .toolResult(id: "c1", name: "draft", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"apply\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "apply", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            PreheatPrecoolSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(PreheatPrecoolSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(PreheatPrecoolSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(PreheatPrecoolSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(PreheatPrecoolSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class PreheatPrecoolStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = PreheatPrecoolStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = PreheatPrecoolStreamReducer.start()
        snapshot = PreheatPrecoolStreamReducer.reduce(snapshot, .delta(text: "Preheat "))
        snapshot = PreheatPrecoolStreamReducer.reduce(snapshot, .delta(text: "07:38."))
        XCTAssertEqual(snapshot.text, "Preheat 07:38.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = PreheatPrecoolStreamReducer.reduce(
            PreheatPrecoolStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = PreheatPrecoolStreamReducer.reduce(
            PreheatPrecoolStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = PreheatPrecoolStreamReducer.reduce(
            PreheatPrecoolStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = PreheatPrecoolStreamReducer.start()
        XCTAssertEqual(PreheatPrecoolStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(PreheatPrecoolStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = PreheatPrecoolStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = PreheatPrecoolStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class PreheatPrecoolOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(PreheatPrecoolOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            PreheatPrecoolOutput.derive(PreheatPrecoolStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class PreheatPrecoolActionDeriveTests: XCTestCase {
    func testIdleWithInputsIsEnabled() {
        let action = PreheatPrecoolAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = PreheatPrecoolAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testMissingInputsIsDisabled() {
        XCTAssertTrue(PreheatPrecoolAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(PreheatPrecoolAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
