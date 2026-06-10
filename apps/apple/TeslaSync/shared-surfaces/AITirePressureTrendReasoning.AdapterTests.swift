//
//  AITirePressureTrendReasoning.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0054 · AITirePressureTrendReasoning (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id` only, snake_case,
//  the /ai/tire-pressure/trends/explain path, the non-finite → 0 coercion), the `string | number`
//  vehicle coercion + the `isFinite && > 0` gate, the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Vehicle coercion (web `Number(vehicleId)` + `Number.isFinite`)

final class TirePressureTrendReasoningVehicleIDTests: XCTestCase {
    func testResolvesNumberAsIs() {
        XCTAssertEqual(TirePressureTrendReasoningVehicleID.resolve(.number(7)), 7)
    }

    func testResolvesNumericString() {
        XCTAssertEqual(TirePressureTrendReasoningVehicleID.resolve(.text("7")), 7)
    }

    func testResolvesNumericStringWithSurroundingWhitespace() {
        // JS Number("  12  ") === 12.
        XCTAssertEqual(TirePressureTrendReasoningVehicleID.resolve(.text("  12  ")), 12)
    }

    func testResolvesEmptyStringToZero() {
        // JS Number("") === 0 (the web `?? 0`-equivalent finite-but-zero case).
        XCTAssertEqual(TirePressureTrendReasoningVehicleID.resolve(.text("")), 0)
    }

    func testNonNumericStringIsNonFinite() {
        // JS Number("abc") === NaN → !Number.isFinite → nil.
        XCTAssertNil(TirePressureTrendReasoningVehicleID.resolve(.text("abc")))
    }

    func testAbsentIsNonFinite() {
        // JS Number(undefined) === NaN → !Number.isFinite → nil.
        XCTAssertNil(TirePressureTrendReasoningVehicleID.resolve(.absent))
    }

    func testNaNAndInfinityAreNonFinite() {
        XCTAssertNil(TirePressureTrendReasoningVehicleID.resolve(.number(.nan)))
        XCTAssertNil(TirePressureTrendReasoningVehicleID.resolve(.number(.infinity)))
        XCTAssertNil(TirePressureTrendReasoningVehicleID.resolve(.number(-.infinity)))
    }

    func testCanStartRequiresFiniteAndPositive() {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        XCTAssertTrue(TirePressureTrendReasoningVehicleID.canStart(7))
        XCTAssertFalse(TirePressureTrendReasoningVehicleID.canStart(0))
        XCTAssertFalse(TirePressureTrendReasoningVehicleID.canStart(-3))
        XCTAssertFalse(TirePressureTrendReasoningVehicleID.canStart(nil))
    }

    func testCanStartFromRawProp() {
        XCTAssertTrue(TirePressureTrendReasoningVehicleID.canStart(raw: .number(7)))
        XCTAssertTrue(TirePressureTrendReasoningVehicleID.canStart(raw: .text("7")))
        XCTAssertFalse(TirePressureTrendReasoningVehicleID.canStart(raw: .number(0)))
        XCTAssertFalse(TirePressureTrendReasoningVehicleID.canStart(raw: .text("abc")))
        XCTAssertFalse(TirePressureTrendReasoningVehicleID.canStart(raw: .absent))
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class TirePressureTrendReasoningRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(TirePressureTrendReasoningRequest.path, "/ai/tire-pressure/trends/explain")
    }

    func testBodyUsesSnakeCaseVehicleIdOnly() {
        let request = TirePressureTrendReasoningRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        // Parity: the web body is `{ vehicle_id }` only — there is NO `days` field.
        XCTAssertNil(request.body["days"])
        XCTAssertEqual(request.body.count, 1)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
        XCTAssertEqual(TirePressureTrendReasoningRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try TirePressureTrendReasoningRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try TirePressureTrendReasoningRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class TirePressureTrendReasoningSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"narrate\"}"),
            .toolCall(id: "c1", name: "narrate")
        )
    }

    func testParsesToolResult() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"narrate\",\"ok\":true}"
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse(frame),
            .toolResult(id: "c1", name: "narrate", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            TirePressureTrendReasoningSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(TirePressureTrendReasoningSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(TirePressureTrendReasoningSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(TirePressureTrendReasoningSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(TirePressureTrendReasoningSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class TirePressureTrendReasoningStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = TirePressureTrendReasoningStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = TirePressureTrendReasoningStreamReducer.start()
        snapshot = TirePressureTrendReasoningStreamReducer.reduce(snapshot, .delta(text: "Front-left "))
        snapshot = TirePressureTrendReasoningStreamReducer.reduce(snapshot, .delta(text: "is leaking."))
        XCTAssertEqual(snapshot.text, "Front-left is leaking.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = TirePressureTrendReasoningStreamReducer.reduce(
            TirePressureTrendReasoningStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = TirePressureTrendReasoningStreamReducer.reduce(
            TirePressureTrendReasoningStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = TirePressureTrendReasoningStreamReducer.reduce(
            TirePressureTrendReasoningStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = TirePressureTrendReasoningStreamReducer.start()
        XCTAssertEqual(
            TirePressureTrendReasoningStreamReducer.reduce(start, .toolCall(id: "1", name: "n")),
            start
        )
        XCTAssertEqual(
            TirePressureTrendReasoningStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = TirePressureTrendReasoningStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = TirePressureTrendReasoningStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class TirePressureTrendReasoningOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(TirePressureTrendReasoningOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .pausedConfirm)
            ),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .streaming, text: "")
            ),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .done, text: "final")
            ),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .done, text: "")
            ),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .error, text: "", error: "stream_http_500")
            ),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            TirePressureTrendReasoningOutput.derive(
                TirePressureTrendReasoningStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class TirePressureTrendReasoningActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = TirePressureTrendReasoningAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = TirePressureTrendReasoningAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(TirePressureTrendReasoningAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(TirePressureTrendReasoningAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
