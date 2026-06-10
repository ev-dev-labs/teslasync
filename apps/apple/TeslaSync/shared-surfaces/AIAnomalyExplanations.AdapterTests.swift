//
//  AIAnomalyExplanations.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0005 · AIAnomalyExplanations (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  snake_case, the /ai/anomalies/explain path, the 30-day window), the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` +
//  `finalizeError` + the `stream_http_{status}` HTTP failure), and the output / action derivations
//  (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class AnomalyRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(AnomalyExplainRequest.path, "/ai/anomalies/explain")
    }

    func testBodyUsesSnakeCaseVehicleIdAndThirtyDays() {
        let request = AnomalyExplainRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        XCTAssertEqual(request.body["days"], 30)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: vehicleId ?? 0`.
        XCTAssertEqual(AnomalyExplainRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testDaysWindowIsConfigurable() {
        XCTAssertEqual(AnomalyExplainRequest(vehicleID: 1, days: 7).body["days"], 7)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try AnomalyExplainRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"days\":30,\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class AnomalySSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            AnomalySSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(AnomalySSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            AnomalySSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            AnomalySSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(AnomalySSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            AnomalySSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"detect\"}"),
            .toolCall(id: "c1", name: "detect")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            AnomalySSEFrame.parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"detect\",\"ok\":true}"),
            .toolResult(id: "c1", name: "detect", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            AnomalySSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            AnomalySSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            AnomalySSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(AnomalySSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(AnomalySSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(AnomalySSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(AnomalySSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class AnomalyStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = AnomalyStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = AnomalyStreamReducer.start()
        snapshot = AnomalyStreamReducer.reduce(snapshot, .delta(text: "Cell "))
        snapshot = AnomalyStreamReducer.reduce(snapshot, .delta(text: "drift."))
        XCTAssertEqual(snapshot.text, "Cell drift.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = AnomalyStreamReducer.reduce(
            AnomalyStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = AnomalyStreamReducer.reduce(AnomalyStreamReducer.start(), .failure(message: "rate_limited"))
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = AnomalyStreamReducer.reduce(
            AnomalyStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = AnomalyStreamReducer.start()
        XCTAssertEqual(AnomalyStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(AnomalyStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = AnomalyStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = AnomalyStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class AnomalyOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(AnomalyOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(AnomalyOutput.derive(AnomalyStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(AnomalyOutput.derive(AnomalyStreamSnapshot(state: .streaming, text: "")), .thinking)
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            AnomalyOutput.derive(AnomalyStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            AnomalyOutput.derive(AnomalyStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(AnomalyOutput.derive(AnomalyStreamSnapshot(state: .done, text: "")), .prose(""))
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            AnomalyOutput.derive(AnomalyStreamSnapshot(state: .error, text: "", error: "stream_http_500")),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            AnomalyOutput.derive(AnomalyStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class AnomalyActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = AnomalyAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = AnomalyAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(AnomalyAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(AnomalyAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
