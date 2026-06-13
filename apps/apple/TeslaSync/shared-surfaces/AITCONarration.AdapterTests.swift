//
//  AITCONarration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0052 · AITCONarration (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  snake_case, the /ai/analytics/tco/narrate path, and — unlike 0013's cost-forecast narrate — NO
//  `months` horizon), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class TCONarrationRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(TCONarrateRequest.path, "/ai/analytics/tco/narrate")
    }

    func testBodyUsesSnakeCaseVehicleId() {
        let request = TCONarrateRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
    }

    func testBodyHasOnlyVehicleIdKey() {
        // Web `body = { vehicle_id: numericVehicleId }` — no months, no other fields.
        let request = TCONarrateRequest(vehicleID: 7)
        XCTAssertEqual(request.body.count, 1)
        XCTAssertNil(request.body["months"])
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0`.
        XCTAssertEqual(TCONarrateRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try TCONarrateRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try TCONarrateRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class TCONarrationSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            TCONarrationSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(TCONarrationSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            TCONarrationSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            TCONarrationSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(TCONarrationSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            TCONarrationSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"tco\"}"),
            .toolCall(id: "c1", name: "tco")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            TCONarrationSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"tco\",\"ok\":true}"),
            .toolResult(id: "c1", name: "tco", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            TCONarrationSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            TCONarrationSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            TCONarrationSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(TCONarrationSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(TCONarrationSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(TCONarrationSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(TCONarrationSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class TCONarrationStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = TCONarrationStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = TCONarrationStreamReducer.start()
        snapshot = TCONarrationStreamReducer.reduce(snapshot, .delta(text: "Cost "))
        snapshot = TCONarrationStreamReducer.reduce(snapshot, .delta(text: "is flat."))
        XCTAssertEqual(snapshot.text, "Cost is flat.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = TCONarrationStreamReducer.reduce(
            TCONarrationStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = TCONarrationStreamReducer.reduce(
            TCONarrationStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = TCONarrationStreamReducer.reduce(
            TCONarrationStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = TCONarrationStreamReducer.start()
        XCTAssertEqual(TCONarrationStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(TCONarrationStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = TCONarrationStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = TCONarrationStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class TCONarrationOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(TCONarrationOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(TCONarrationOutput.derive(TCONarrationStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            TCONarrationOutput.derive(TCONarrationStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            TCONarrationOutput.derive(TCONarrationStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            TCONarrationOutput.derive(TCONarrationStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            TCONarrationOutput.derive(TCONarrationStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            TCONarrationOutput.derive(TCONarrationStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            TCONarrationOutput.derive(TCONarrationStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class TCONarrationActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = TCONarrationAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = TCONarrationAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(TCONarrationAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(TCONarrationAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
