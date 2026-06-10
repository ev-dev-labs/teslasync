//
//  AICabinTemperatureImpactNarrative.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0009 · AICabinTemperatureImpactNarrative (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id` only, snake_case,
//  the /ai/climate/temperature-impact/narrate path, the non-finite → 0 coercion), the `string |
//  number` vehicle coercion + the `isFinite && > 0` gate, the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` +
//  `finalizeError` + the `stream_http_{status}` HTTP failure), and the output / action derivations
//  (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Vehicle coercion (web `Number(vehicleId)` + `Number.isFinite`)

final class CabinTempNarrativeVehicleIDTests: XCTestCase {
    func testResolvesNumberAsIs() {
        XCTAssertEqual(CabinTempNarrativeVehicleID.resolve(.number(7)), 7)
    }

    func testResolvesNumericString() {
        XCTAssertEqual(CabinTempNarrativeVehicleID.resolve(.text("7")), 7)
    }

    func testResolvesNumericStringWithSurroundingWhitespace() {
        // JS Number("  12  ") === 12.
        XCTAssertEqual(CabinTempNarrativeVehicleID.resolve(.text("  12  ")), 12)
    }

    func testResolvesEmptyStringToZero() {
        // JS Number("") === 0 (the web `?? 0`-equivalent finite-but-zero case).
        XCTAssertEqual(CabinTempNarrativeVehicleID.resolve(.text("")), 0)
    }

    func testNonNumericStringIsNonFinite() {
        // JS Number("abc") === NaN → !Number.isFinite → nil.
        XCTAssertNil(CabinTempNarrativeVehicleID.resolve(.text("abc")))
    }

    func testAbsentIsNonFinite() {
        // JS Number(undefined) === NaN → !Number.isFinite → nil.
        XCTAssertNil(CabinTempNarrativeVehicleID.resolve(.absent))
    }

    func testNaNAndInfinityAreNonFinite() {
        XCTAssertNil(CabinTempNarrativeVehicleID.resolve(.number(.nan)))
        XCTAssertNil(CabinTempNarrativeVehicleID.resolve(.number(.infinity)))
        XCTAssertNil(CabinTempNarrativeVehicleID.resolve(.number(-.infinity)))
    }

    func testCanStartRequiresFiniteAndPositive() {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        XCTAssertTrue(CabinTempNarrativeVehicleID.canStart(7))
        XCTAssertFalse(CabinTempNarrativeVehicleID.canStart(0))
        XCTAssertFalse(CabinTempNarrativeVehicleID.canStart(-3))
        XCTAssertFalse(CabinTempNarrativeVehicleID.canStart(nil))
    }

    func testCanStartFromRawProp() {
        XCTAssertTrue(CabinTempNarrativeVehicleID.canStart(raw: .number(7)))
        XCTAssertTrue(CabinTempNarrativeVehicleID.canStart(raw: .text("7")))
        XCTAssertFalse(CabinTempNarrativeVehicleID.canStart(raw: .number(0)))
        XCTAssertFalse(CabinTempNarrativeVehicleID.canStart(raw: .text("abc")))
        XCTAssertFalse(CabinTempNarrativeVehicleID.canStart(raw: .absent))
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class CabinTempNarrativeRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(CabinTempNarrativeRequest.path, "/ai/climate/temperature-impact/narrate")
    }

    func testBodyUsesSnakeCaseVehicleIdOnly() {
        let request = CabinTempNarrativeRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        // Parity: the web body is `{ vehicle_id }` only — there is NO `days` field.
        XCTAssertNil(request.body["days"])
        XCTAssertEqual(request.body.count, 1)
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
        XCTAssertEqual(CabinTempNarrativeRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try CabinTempNarrativeRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try CabinTempNarrativeRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class CabinTempNarrativeSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"narrate\"}"),
            .toolCall(id: "c1", name: "narrate")
        )
    }

    func testParsesToolResult() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"narrate\",\"ok\":true}"
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse(frame),
            .toolResult(id: "c1", name: "narrate", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            CabinTempNarrativeSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(CabinTempNarrativeSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(CabinTempNarrativeSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(CabinTempNarrativeSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(CabinTempNarrativeSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class CabinTempNarrativeStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = CabinTempNarrativeStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = CabinTempNarrativeStreamReducer.start()
        snapshot = CabinTempNarrativeStreamReducer.reduce(snapshot, .delta(text: "Cold "))
        snapshot = CabinTempNarrativeStreamReducer.reduce(snapshot, .delta(text: "months."))
        XCTAssertEqual(snapshot.text, "Cold months.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = CabinTempNarrativeStreamReducer.reduce(
            CabinTempNarrativeStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = CabinTempNarrativeStreamReducer.reduce(
            CabinTempNarrativeStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = CabinTempNarrativeStreamReducer.reduce(
            CabinTempNarrativeStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = CabinTempNarrativeStreamReducer.start()
        XCTAssertEqual(CabinTempNarrativeStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            CabinTempNarrativeStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = CabinTempNarrativeStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = CabinTempNarrativeStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class CabinTempNarrativeOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(CabinTempNarrativeOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(CabinTempNarrativeStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(CabinTempNarrativeStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(
                CabinTempNarrativeStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(CabinTempNarrativeStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(CabinTempNarrativeStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(
                CabinTempNarrativeStreamSnapshot(state: .error, text: "", error: "stream_http_500")
            ),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            CabinTempNarrativeOutput.derive(
                CabinTempNarrativeStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class CabinTempNarrativeActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = CabinTempNarrativeAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = CabinTempNarrativeAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(CabinTempNarrativeAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(CabinTempNarrativeAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
