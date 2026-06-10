//
//  AIMLChargingCurveClustering.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0027 · AIMLChargingCurveClustering (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  `lookback_days: 90`, snake_case, the /ai/ml/charging-curves/cluster path), the SSE frame parsing
//  (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of
//  `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and the output /
//  action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class MLChargeCurveRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(MLChargeCurveRequest.path, "/ai/ml/charging-curves/cluster")
    }

    func testBodyUsesSnakeCaseVehicleIdAndNinetyDayLookback() {
        let request = MLChargeCurveRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        XCTAssertEqual(request.body["lookback_days"], 90)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: vehicleId ?? 0`.
        XCTAssertEqual(MLChargeCurveRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testLookbackWindowIsConfigurable() {
        XCTAssertEqual(MLChargeCurveRequest(vehicleID: 1, lookbackDays: 30).body["lookback_days"], 30)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try MLChargeCurveRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"lookback_days\":90,\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class MLChargeCurveSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(MLChargeCurveSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(MLChargeCurveSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"cluster\"}"),
            .toolCall(id: "c1", name: "cluster")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"cluster\",\"ok\":true}"),
            .toolResult(id: "c1", name: "cluster", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"train\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "train", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            MLChargeCurveSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(MLChargeCurveSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(MLChargeCurveSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(MLChargeCurveSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(MLChargeCurveSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class MLChargeCurveStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = MLChargeCurveStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = MLChargeCurveStreamReducer.start()
        snapshot = MLChargeCurveStreamReducer.reduce(snapshot, .delta(text: "L1 "))
        snapshot = MLChargeCurveStreamReducer.reduce(snapshot, .delta(text: "cluster."))
        XCTAssertEqual(snapshot.text, "L1 cluster.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = MLChargeCurveStreamReducer.reduce(
            MLChargeCurveStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = MLChargeCurveStreamReducer.reduce(
            MLChargeCurveStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = MLChargeCurveStreamReducer.reduce(
            MLChargeCurveStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = MLChargeCurveStreamReducer.start()
        XCTAssertEqual(MLChargeCurveStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(MLChargeCurveStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = MLChargeCurveStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = MLChargeCurveStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class MLChargeCurveOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(MLChargeCurveOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .done, text: "")), .prose(""))
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .error, text: "", error: "stream_http_500")),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            MLChargeCurveOutput.derive(MLChargeCurveStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class MLChargeCurveActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = MLChargeCurveAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = MLChargeCurveAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(MLChargeCurveAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(MLChargeCurveAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
