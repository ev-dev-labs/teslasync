//
//  AIRangePrediction.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0043 · AIRangePrediction (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  `days: 14`, snake_case, the bare /ai/ml/range/train path — the id lives in the BODY, not the
//  path), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating
//  stream reducer (port of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP
//  failure), and the output / action derivations (port of the `AiOutputPanel` branches + the
//  `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class RangePredictionRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(RangePredictionRequest.path, "/ai/ml/range/train")
    }

    func testBodyUsesSnakeCaseVehicleIdAndFourteenDayWindow() {
        let request = RangePredictionRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        XCTAssertEqual(request.body["days"], 14)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: vehicleId ?? 0`.
        XCTAssertEqual(RangePredictionRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testBodyKeepsZeroVehicleAsZero() {
        // A selected vehicle of 0 is a valid `vehicleId != null` selection; the body sends 0 as-is.
        XCTAssertEqual(RangePredictionRequest(vehicleID: 0).body["vehicle_id"], 0)
    }

    func testLearningWindowIsConfigurable() {
        XCTAssertEqual(RangePredictionRequest(vehicleID: 1, days: 30).body["days"], 30)
    }

    func testDefaultDaysIsFourteen() {
        XCTAssertEqual(RangePredictionRequest.defaultDays, 14)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try RangePredictionRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"days\":14,\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class RangePredictionSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            RangePredictionSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(RangePredictionSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            RangePredictionSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            RangePredictionSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(RangePredictionSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            RangePredictionSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"train\"}"),
            .toolCall(id: "c1", name: "train")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            RangePredictionSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"train\",\"ok\":true}"),
            .toolResult(id: "c1", name: "train", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            RangePredictionSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            RangePredictionSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            RangePredictionSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(RangePredictionSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(RangePredictionSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(RangePredictionSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(RangePredictionSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class RangePredictionStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = RangePredictionStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = RangePredictionStreamReducer.start()
        snapshot = RangePredictionStreamReducer.reduce(snapshot, .delta(text: "Learned "))
        snapshot = RangePredictionStreamReducer.reduce(snapshot, .delta(text: "envelope."))
        XCTAssertEqual(snapshot.text, "Learned envelope.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = RangePredictionStreamReducer.reduce(
            RangePredictionStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = RangePredictionStreamReducer.reduce(
            RangePredictionStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = RangePredictionStreamReducer.reduce(
            RangePredictionStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = RangePredictionStreamReducer.start()
        XCTAssertEqual(RangePredictionStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(RangePredictionStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = RangePredictionStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = RangePredictionStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class RangePredictionOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(RangePredictionOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(RangePredictionOutput.derive(RangePredictionStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            RangePredictionOutput.derive(RangePredictionStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            RangePredictionOutput.derive(RangePredictionStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            RangePredictionOutput.derive(RangePredictionStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            RangePredictionOutput.derive(RangePredictionStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            RangePredictionOutput.derive(RangePredictionStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            RangePredictionOutput.derive(RangePredictionStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class RangePredictionActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = RangePredictionAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = RangePredictionAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(RangePredictionAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(RangePredictionAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
