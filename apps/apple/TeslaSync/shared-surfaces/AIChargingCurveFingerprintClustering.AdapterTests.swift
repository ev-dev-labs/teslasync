//
//  AIChargingCurveFingerprintClustering.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0010 · AIChargingCurveFingerprintClustering (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the vehicle-id coercion (port of `typeof vehicleId
//  === 'number' ? vehicleId : Number(vehicleId)` + `Number.isFinite` + `> 0`), the request URL (the
//  static `/ai/charging/curves/clusters/explain` route) and the snake_case `{ vehicle_id }` body
//  (port of `Number.isFinite(numeric) ? numeric : 0`), the SSE frame parsing (port of `parseSSEFrame`
//  + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Vehicle id coercion (web `Number(vehicleId)` + `Number.isFinite` + `> 0`)

final class ChargeCurveFingerprintVehicleIDTests: XCTestCase {
    func testNumberPassesThrough() {
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.number(4821).numeric, 4821)
        XCTAssertTrue(ChargeCurveFingerprintVehicleID.number(4821).isFiniteNumeric)
    }

    func testAbsentIsNaN() {
        // Web `Number(undefined) === NaN`.
        XCTAssertTrue(ChargeCurveFingerprintVehicleID.absent.numeric.isNaN)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.absent.isFiniteNumeric)
    }

    func testNumericStringCoerces() {
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("4821").numeric, 4821)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("42.5").numeric, 42.5)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("1e3").numeric, 1000)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("+7").numeric, 7)
    }

    func testEmptyStringIsZero() {
        // Web `Number("") === 0` and `Number("   ") === 0`.
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("").numeric, 0)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("   ").numeric, 0)
    }

    func testWhitespaceIsTrimmed() {
        // Web `Number("  12  ") === 12`.
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("  12  ").numeric, 12)
    }

    func testNonNumericStringIsNaN() {
        // Web `Number("abc") === NaN`.
        XCTAssertTrue(ChargeCurveFingerprintVehicleID.string("abc").numeric.isNaN)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.string("abc").isFiniteNumeric)
    }

    func testBodyValueZerosNonFinite() {
        // Web `Number.isFinite(numeric) ? numeric : 0`.
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.absent.bodyValue, 0)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.string("abc").bodyValue, 0)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.number(.infinity).bodyValue, 0)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.number(-5).bodyValue, -5)
        XCTAssertEqual(ChargeCurveFingerprintVehicleID.number(4821).bodyValue, 4821)
    }

    func testCanStartRequiresFinitePositive() {
        // Web `Number.isFinite(numeric) && numeric > 0`.
        XCTAssertTrue(ChargeCurveFingerprintVehicleID.number(4821).canStart)
        XCTAssertTrue(ChargeCurveFingerprintVehicleID.string("4821").canStart)
        XCTAssertTrue(ChargeCurveFingerprintVehicleID.string("42.5").canStart)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.absent.canStart)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.number(0).canStart)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.number(-5).canStart)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.number(.infinity).canStart)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.string("").canStart)
        XCTAssertFalse(ChargeCurveFingerprintVehicleID.string("abc").canStart)
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class ChargeCurveFingerprintRequestTests: XCTestCase {
    func testPathIsStaticExplainRoute() {
        // Web `url: '/ai/charging/curves/clusters/explain'` — a static route, no path param.
        XCTAssertEqual(ChargeCurveFingerprintRequest.path, "/ai/charging/curves/clusters/explain")
        XCTAssertEqual(
            ChargeCurveFingerprintRequest(vehicleID: .number(4821)).path,
            "/ai/charging/curves/clusters/explain"
        )
        XCTAssertEqual(
            ChargeCurveFingerprintRequest(vehicleID: .absent).path,
            "/ai/charging/curves/clusters/explain"
        )
    }

    func testBodyEmbedsFiniteVehicleID() {
        XCTAssertEqual(ChargeCurveFingerprintRequest(vehicleID: .number(4821)).body["vehicle_id"], 4821)
        XCTAssertEqual(ChargeCurveFingerprintRequest(vehicleID: .string("4821")).body["vehicle_id"], 4821)
        XCTAssertEqual(ChargeCurveFingerprintRequest(vehicleID: .number(-5)).body["vehicle_id"], -5)
    }

    func testBodyZerosNonFiniteVehicleID() {
        // Web `vehicle_id: Number.isFinite(numeric) ? numeric : 0`.
        XCTAssertEqual(ChargeCurveFingerprintRequest(vehicleID: .absent).body["vehicle_id"], 0)
        XCTAssertEqual(ChargeCurveFingerprintRequest(vehicleID: .string("abc")).body["vehicle_id"], 0)
        XCTAssertEqual(ChargeCurveFingerprintRequest(vehicleID: .string("")).body["vehicle_id"], 0)
    }

    func testCanStartMirrorsVehicleGate() {
        XCTAssertTrue(ChargeCurveFingerprintRequest(vehicleID: .number(4821)).canStart)
        XCTAssertFalse(ChargeCurveFingerprintRequest(vehicleID: .number(0)).canStart)
        XCTAssertFalse(ChargeCurveFingerprintRequest(vehicleID: .absent).canStart)
    }

    func testEncodedBodyIsWholeNumberJSON() throws {
        // JS `JSON.stringify({ vehicle_id: 4821 })` → `{"vehicle_id":4821}` (no fractional part).
        let data = try ChargeCurveFingerprintRequest(vehicleID: .number(4821)).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":4821}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try ChargeCurveFingerprintRequest(vehicleID: .absent).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }

    func testEncodedBodyKeepsFractionalVehicleID() throws {
        let data = try ChargeCurveFingerprintRequest(vehicleID: .string("42.5")).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":42.5}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class ChargeCurveFingerprintSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"explain\"}"),
            .toolCall(id: "c1", name: "explain")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"explain\",\"ok\":true}"),
            .toolResult(id: "c1", name: "explain", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            ChargeCurveFingerprintSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(ChargeCurveFingerprintSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(ChargeCurveFingerprintSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(ChargeCurveFingerprintSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(ChargeCurveFingerprintSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class ChargeCurveFingerprintStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = ChargeCurveFingerprintStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = ChargeCurveFingerprintStreamReducer.start()
        snapshot = ChargeCurveFingerprintStreamReducer.reduce(snapshot, .delta(text: "L1 "))
        snapshot = ChargeCurveFingerprintStreamReducer.reduce(snapshot, .delta(text: "overnight."))
        XCTAssertEqual(snapshot.text, "L1 overnight.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = ChargeCurveFingerprintStreamReducer.reduce(
            ChargeCurveFingerprintStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = ChargeCurveFingerprintStreamReducer.reduce(
            ChargeCurveFingerprintStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = ChargeCurveFingerprintStreamReducer.reduce(
            ChargeCurveFingerprintStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = ChargeCurveFingerprintStreamReducer.start()
        XCTAssertEqual(ChargeCurveFingerprintStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            ChargeCurveFingerprintStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = ChargeCurveFingerprintStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = ChargeCurveFingerprintStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class ChargeCurveFingerprintOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(ChargeCurveFingerprintOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(ChargeCurveFingerprintStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(ChargeCurveFingerprintStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(
                ChargeCurveFingerprintStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(ChargeCurveFingerprintStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(ChargeCurveFingerprintStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(ChargeCurveFingerprintStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            ChargeCurveFingerprintOutput.derive(
                ChargeCurveFingerprintStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class ChargeCurveFingerprintActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = ChargeCurveFingerprintAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = ChargeCurveFingerprintAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(ChargeCurveFingerprintAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(ChargeCurveFingerprintAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
