//
//  AICostForecastNarration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0013 · AICostForecastNarration (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  snake_case, the /ai/charging/costs/forecast/narrate path, and the OPTIONAL `months` horizon — sent
//  only when > 0, omitted otherwise, mirroring the web `if (typeof months === 'number' && … &&
//  months > 0)` guard), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class CostNarrationRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(CostNarrateRequest.path, "/ai/charging/costs/forecast/narrate")
    }

    func testBodyUsesSnakeCaseVehicleId() {
        let request = CostNarrateRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
    }

    func testBodyOmitsMonthsWhenAbsent() {
        // Web `out` starts with only vehicle_id; months is added conditionally.
        let request = CostNarrateRequest(vehicleID: 7, months: nil)
        XCTAssertNil(request.body["months"])
        XCTAssertEqual(request.body.count, 1)
    }

    func testBodyIncludesMonthsWhenPositive() {
        // Web `if (typeof months === 'number' && Number.isFinite(months) && months > 0) out.months`.
        let request = CostNarrateRequest(vehicleID: 7, months: 6)
        XCTAssertEqual(request.body["months"], 6)
        XCTAssertEqual(request.body.count, 2)
    }

    func testBodyOmitsMonthsWhenZeroOrNegative() {
        // Web guard is strictly `months > 0`.
        XCTAssertNil(CostNarrateRequest(vehicleID: 7, months: 0).body["months"])
        XCTAssertNil(CostNarrateRequest(vehicleID: 7, months: -3).body["months"])
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
        XCTAssertEqual(CostNarrateRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try CostNarrateRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7}")
    }

    func testEncodedBodyWithMonthsIsDeterministicSortedJSON() throws {
        let data = try CostNarrateRequest(vehicleID: 7, months: 6).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        // Sorted keys: "months" precedes "vehicle_id".
        XCTAssertEqual(json, "{\"months\":6,\"vehicle_id\":7}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try CostNarrateRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class CostNarrationSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            CostNarrationSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(CostNarrationSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            CostNarrationSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            CostNarrationSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(CostNarrationSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            CostNarrationSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"forecast\"}"),
            .toolCall(id: "c1", name: "forecast")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            CostNarrationSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"forecast\",\"ok\":true}"),
            .toolResult(id: "c1", name: "forecast", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            CostNarrationSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            CostNarrationSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            CostNarrationSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(CostNarrationSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(CostNarrationSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(CostNarrationSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(CostNarrationSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class CostNarrationStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = CostNarrationStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = CostNarrationStreamReducer.start()
        snapshot = CostNarrationStreamReducer.reduce(snapshot, .delta(text: "Cost "))
        snapshot = CostNarrationStreamReducer.reduce(snapshot, .delta(text: "is flat."))
        XCTAssertEqual(snapshot.text, "Cost is flat.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = CostNarrationStreamReducer.reduce(
            CostNarrationStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = CostNarrationStreamReducer.reduce(
            CostNarrationStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = CostNarrationStreamReducer.reduce(
            CostNarrationStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = CostNarrationStreamReducer.start()
        XCTAssertEqual(CostNarrationStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(CostNarrationStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = CostNarrationStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = CostNarrationStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class CostNarrationOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(CostNarrationOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(CostNarrationOutput.derive(CostNarrationStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            CostNarrationOutput.derive(CostNarrationStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            CostNarrationOutput.derive(CostNarrationStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            CostNarrationOutput.derive(CostNarrationStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            CostNarrationOutput.derive(CostNarrationStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            CostNarrationOutput.derive(CostNarrationStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            CostNarrationOutput.derive(CostNarrationStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class CostNarrationActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = CostNarrationAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = CostNarrationAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(CostNarrationAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(CostNarrationAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
