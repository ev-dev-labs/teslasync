//
//  AIVampireDrainExplanation.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0057 · AIVampireDrainExplanation (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id: vehicleId ?? 0`,
//  snake_case, the /ai/charging/vampire-drain/explain path, and the OPTIONAL `lookback_days` horizon
//  — sent only when > 0, omitted otherwise, mirroring the web `if (typeof lookbackDays === 'number'
//  && … && lookbackDays > 0)` guard), the `string | number` vehicle coercion + the `isFinite && > 0`
//  gate, the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating
//  stream reducer (port of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP
//  failure), and the output / action derivations (port of the `AiOutputPanel` branches + the
//  `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Vehicle coercion (web `Number(vehicleId)` + `Number.isFinite`)

final class VampireDrainExplainVehicleIDTests: XCTestCase {
    func testResolvesNumberAsIs() {
        XCTAssertEqual(VampireDrainExplainVehicleID.resolve(.number(7)), 7)
    }

    func testResolvesNumericString() {
        XCTAssertEqual(VampireDrainExplainVehicleID.resolve(.text("7")), 7)
    }

    func testResolvesNumericStringWithSurroundingWhitespace() {
        // JS Number("  12  ") === 12.
        XCTAssertEqual(VampireDrainExplainVehicleID.resolve(.text("  12  ")), 12)
    }

    func testResolvesEmptyStringToZero() {
        // JS Number("") === 0 (the web `?? 0`-equivalent finite-but-zero case).
        XCTAssertEqual(VampireDrainExplainVehicleID.resolve(.text("")), 0)
    }

    func testNonNumericStringIsNonFinite() {
        // JS Number("abc") === NaN → !Number.isFinite → nil.
        XCTAssertNil(VampireDrainExplainVehicleID.resolve(.text("abc")))
    }

    func testAbsentIsNonFinite() {
        // JS Number(undefined) === NaN → !Number.isFinite → nil.
        XCTAssertNil(VampireDrainExplainVehicleID.resolve(.absent))
    }

    func testNaNAndInfinityAreNonFinite() {
        XCTAssertNil(VampireDrainExplainVehicleID.resolve(.number(.nan)))
        XCTAssertNil(VampireDrainExplainVehicleID.resolve(.number(.infinity)))
        XCTAssertNil(VampireDrainExplainVehicleID.resolve(.number(-.infinity)))
    }

    func testCanStartRequiresFiniteAndPositive() {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        XCTAssertTrue(VampireDrainExplainVehicleID.canStart(7))
        XCTAssertFalse(VampireDrainExplainVehicleID.canStart(0))
        XCTAssertFalse(VampireDrainExplainVehicleID.canStart(-3))
        XCTAssertFalse(VampireDrainExplainVehicleID.canStart(nil))
    }

    func testCanStartFromRawProp() {
        XCTAssertTrue(VampireDrainExplainVehicleID.canStart(raw: .number(7)))
        XCTAssertTrue(VampireDrainExplainVehicleID.canStart(raw: .text("7")))
        XCTAssertFalse(VampireDrainExplainVehicleID.canStart(raw: .number(0)))
        XCTAssertFalse(VampireDrainExplainVehicleID.canStart(raw: .text("abc")))
        XCTAssertFalse(VampireDrainExplainVehicleID.canStart(raw: .absent))
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class VampireDrainExplainRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(VampireDrainExplainRequest.path, "/ai/charging/vampire-drain/explain")
    }

    func testBodyUsesSnakeCaseVehicleId() {
        let request = VampireDrainExplainRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
    }

    func testBodyOmitsLookbackWhenAbsent() {
        // Web `out` starts with only vehicle_id; lookback_days is added conditionally.
        let request = VampireDrainExplainRequest(vehicleID: 7, lookbackDays: nil)
        XCTAssertNil(request.body["lookback_days"])
        XCTAssertEqual(request.body.count, 1)
    }

    func testBodyIncludesLookbackWhenPositive() {
        // Web `if (typeof lookbackDays === 'number' && Number.isFinite(lookbackDays) &&
        // lookbackDays > 0) out.lookback_days = lookbackDays`.
        let request = VampireDrainExplainRequest(vehicleID: 7, lookbackDays: 30)
        XCTAssertEqual(request.body["lookback_days"], 30)
        XCTAssertEqual(request.body.count, 2)
    }

    func testBodyOmitsLookbackWhenZeroOrNegative() {
        // Web guard is strictly `lookbackDays > 0`.
        XCTAssertNil(VampireDrainExplainRequest(vehicleID: 7, lookbackDays: 0).body["lookback_days"])
        XCTAssertNil(VampireDrainExplainRequest(vehicleID: 7, lookbackDays: -14).body["lookback_days"])
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
        XCTAssertEqual(VampireDrainExplainRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try VampireDrainExplainRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7}")
    }

    func testEncodedBodyWithLookbackIsDeterministicSortedJSON() throws {
        let data = try VampireDrainExplainRequest(vehicleID: 7, lookbackDays: 30).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        // Sorted keys: "lookback_days" precedes "vehicle_id".
        XCTAssertEqual(json, "{\"lookback_days\":30,\"vehicle_id\":7}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try VampireDrainExplainRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class VampireDrainExplainSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"explain\"}"),
            .toolCall(id: "c1", name: "explain")
        )
    }

    func testParsesToolResult() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"explain\",\"ok\":true}"
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse(frame),
            .toolResult(id: "c1", name: "explain", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            VampireDrainExplainSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(VampireDrainExplainSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(VampireDrainExplainSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(VampireDrainExplainSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(VampireDrainExplainSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class VampireDrainExplainStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = VampireDrainExplainStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = VampireDrainExplainStreamReducer.start()
        snapshot = VampireDrainExplainStreamReducer.reduce(snapshot, .delta(text: "Sentry "))
        snapshot = VampireDrainExplainStreamReducer.reduce(snapshot, .delta(text: "drains."))
        XCTAssertEqual(snapshot.text, "Sentry drains.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = VampireDrainExplainStreamReducer.reduce(
            VampireDrainExplainStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = VampireDrainExplainStreamReducer.reduce(
            VampireDrainExplainStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = VampireDrainExplainStreamReducer.reduce(
            VampireDrainExplainStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = VampireDrainExplainStreamReducer.start()
        XCTAssertEqual(VampireDrainExplainStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            VampireDrainExplainStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = VampireDrainExplainStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = VampireDrainExplainStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class VampireDrainExplainOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(VampireDrainExplainOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(VampireDrainExplainStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(VampireDrainExplainStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(
                VampireDrainExplainStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(VampireDrainExplainStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(VampireDrainExplainStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(
                VampireDrainExplainStreamSnapshot(state: .error, text: "", error: "stream_http_500")
            ),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            VampireDrainExplainOutput.derive(
                VampireDrainExplainStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class VampireDrainExplainActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = VampireDrainExplainAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = VampireDrainExplainAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(VampireDrainExplainAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(VampireDrainExplainAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
