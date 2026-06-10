//
//  AIBatteryHealthForecastNarrative.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0008 · AIBatteryHealthForecastNarrative (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  snake_case, the /ai/battery/health/narrate path, NO `days` window — unlike 0005's explain), the
//  SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream
//  reducer (port of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and
//  the output / action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard`
//  button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class BatteryNarrativeRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(BatteryNarrateRequest.path, "/ai/battery/health/narrate")
    }

    func testBodyUsesSnakeCaseVehicleId() {
        let request = BatteryNarrateRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
    }

    func testBodyHasNoDaysWindow() {
        // The narrate body carries only vehicle_id (web `{ vehicle_id }`); unlike 0005's explain it
        // has no `days` field.
        let request = BatteryNarrateRequest(vehicleID: 7)
        XCTAssertNil(request.body["days"])
        XCTAssertEqual(request.body.count, 1)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
        XCTAssertEqual(BatteryNarrateRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try BatteryNarrateRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try BatteryNarrateRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class BatteryNarrativeSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(BatteryNarrativeSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(BatteryNarrativeSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"forecast\"}"),
            .toolCall(id: "c1", name: "forecast")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"forecast\",\"ok\":true}"),
            .toolResult(id: "c1", name: "forecast", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            BatteryNarrativeSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(BatteryNarrativeSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(BatteryNarrativeSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(BatteryNarrativeSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(BatteryNarrativeSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class BatteryNarrativeStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = BatteryNarrativeStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = BatteryNarrativeStreamReducer.start()
        snapshot = BatteryNarrativeStreamReducer.reduce(snapshot, .delta(text: "Pack "))
        snapshot = BatteryNarrativeStreamReducer.reduce(snapshot, .delta(text: "nominal."))
        XCTAssertEqual(snapshot.text, "Pack nominal.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = BatteryNarrativeStreamReducer.reduce(
            BatteryNarrativeStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = BatteryNarrativeStreamReducer.reduce(
            BatteryNarrativeStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = BatteryNarrativeStreamReducer.reduce(
            BatteryNarrativeStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = BatteryNarrativeStreamReducer.start()
        XCTAssertEqual(BatteryNarrativeStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(BatteryNarrativeStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = BatteryNarrativeStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = BatteryNarrativeStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class BatteryNarrativeOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(BatteryNarrativeOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            BatteryNarrativeOutput.derive(BatteryNarrativeStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class BatteryNarrativeActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = BatteryNarrativeAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = BatteryNarrativeAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(BatteryNarrativeAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(BatteryNarrativeAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
