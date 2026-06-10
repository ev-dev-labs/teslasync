//
//  AILearnedAnomalyBaselines.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0023 · AILearnedAnomalyBaselines (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  snake_case, the /ai/ml/anomaly-baselines/train path, the 14-day learning window), the SSE frame
//  parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port
//  of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and the output /
//  action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class BaselineTrainRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(BaselineTrainRequest.path, "/ai/ml/anomaly-baselines/train")
    }

    func testBodyUsesSnakeCaseVehicleIdAndFourteenDays() {
        let request = BaselineTrainRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        XCTAssertEqual(request.body["days"], 14)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: vehicleId ?? 0`.
        XCTAssertEqual(BaselineTrainRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testDaysWindowIsConfigurable() {
        XCTAssertEqual(BaselineTrainRequest(vehicleID: 1, days: 30).body["days"], 30)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try BaselineTrainRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"days\":14,\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class BaselineSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            BaselineSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(BaselineSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            BaselineSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            BaselineSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(BaselineSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            BaselineSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"train\"}"),
            .toolCall(id: "c1", name: "train")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            BaselineSSEFrame.parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"train\",\"ok\":true}"),
            .toolResult(id: "c1", name: "train", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            BaselineSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            BaselineSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            BaselineSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(BaselineSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(BaselineSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(BaselineSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(BaselineSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class BaselineStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = BaselineStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = BaselineStreamReducer.start()
        snapshot = BaselineStreamReducer.reduce(snapshot, .delta(text: "Pack "))
        snapshot = BaselineStreamReducer.reduce(snapshot, .delta(text: "voltage."))
        XCTAssertEqual(snapshot.text, "Pack voltage.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = BaselineStreamReducer.reduce(
            BaselineStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = BaselineStreamReducer.reduce(BaselineStreamReducer.start(), .failure(message: "rate_limited"))
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = BaselineStreamReducer.reduce(
            BaselineStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = BaselineStreamReducer.start()
        XCTAssertEqual(BaselineStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(BaselineStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = BaselineStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = BaselineStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class BaselineOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(BaselineOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(BaselineOutput.derive(BaselineStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(BaselineOutput.derive(BaselineStreamSnapshot(state: .streaming, text: "")), .thinking)
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            BaselineOutput.derive(BaselineStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            BaselineOutput.derive(BaselineStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(BaselineOutput.derive(BaselineStreamSnapshot(state: .done, text: "")), .prose(""))
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            BaselineOutput.derive(BaselineStreamSnapshot(state: .error, text: "", error: "stream_http_500")),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            BaselineOutput.derive(BaselineStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class BaselineActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = BaselineAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = BaselineAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(BaselineAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(BaselineAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
