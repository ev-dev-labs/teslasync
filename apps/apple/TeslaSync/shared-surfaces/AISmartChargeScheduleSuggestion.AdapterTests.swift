//
//  AISmartChargeScheduleSuggestion.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0047 · AISmartChargeScheduleSuggestion (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (9-field schedule object,
//  snake_case, the bare /ai/charging/schedule/draft path, the `?? default` fallbacks, the `vehicle_id`
//  0-coercion), the `haveInputs = !!vehicleId && !!ratePlanId` rule, the `depart_by` ISO normalization
//  (selected instant else injected now), the SSE frame parsing, the delta-accumulating stream reducer
//  (incl. the `stream_http_{status}` HTTP failure), and the output / action derivations.
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class SmartChargeScheduleRequestTests: XCTestCase {
    private let epoch = Date(timeIntervalSince1970: 0)

    func testPathIsBareRoute() {
        XCTAssertEqual(SmartChargeScheduleRequest.path, "/ai/charging/schedule/draft")
    }

    func testHaveInputsRequiresBothVehicleAndRatePlan() {
        // Web `haveInputs = !!vehicleId && !!ratePlanId`.
        XCTAssertTrue(SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: "pge-ev2a").haveInputs)
        XCTAssertFalse(SmartChargeScheduleRequest(vehicleID: nil, ratePlanID: "pge-ev2a").haveInputs)
        XCTAssertFalse(SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: nil).haveInputs)
        XCTAssertFalse(SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: "").haveInputs)
    }

    func testHaveInputsTreatsZeroVehicleAsFalsy() {
        // A JS number is truthy iff non-zero, so `!!0` is false.
        XCTAssertFalse(SmartChargeScheduleRequest(vehicleID: 0, ratePlanID: "pge-ev2a").haveInputs)
    }

    func testHaveInputsTreatsNegativeVehicleAsTruthy() {
        // Parity: `!!(-3)` is true (DISTINCT from the predictive surface's `> 0` rule).
        XCTAssertTrue(SmartChargeScheduleRequest(vehicleID: -3, ratePlanID: "pge-ev2a").haveInputs)
    }

    func testBodyUsesSnakeCaseAndWebDefaults() throws {
        let request = SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: "pge-ev2a", departBy: epoch)
        let json = try decoded(request)
        XCTAssertEqual(json["vehicle_id"] as? Int, 7)
        XCTAssertEqual(json["target_soc"] as? Int, 80)
        XCTAssertEqual(json["rate_plan_id"] as? String, "pge-ev2a")
        XCTAssertEqual(json["max_amps"] as? Int, 32)
        XCTAssertEqual(json["battery_capacity_kwh"] as? Int, 75)
        XCTAssertEqual(json["charger_voltage"] as? Int, 240)
        XCTAssertEqual(json["prefer_off_peak"] as? Bool, true)
        XCTAssertEqual(json["current_soc"] as? Int, 20)
        XCTAssertEqual(json["depart_by"] as? String, "1970-01-01T00:00:00.000Z")
    }

    func testBodyHasExactlyNineFields() throws {
        let request = SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: "pge-ev2a", departBy: epoch)
        XCTAssertEqual(try decoded(request).count, 9)
    }

    func testBodyOverridesAreCarriedThrough() throws {
        let request = SmartChargeScheduleRequest(
            vehicleID: 3,
            ratePlanID: "tou-d",
            targetSoc: 90,
            currentSoc: 42,
            departBy: epoch,
            maxAmps: 48,
            batteryCapacityKwh: 100,
            chargerVoltage: 208,
            preferOffPeak: false
        )
        let json = try decoded(request)
        XCTAssertEqual(json["vehicle_id"] as? Int, 3)
        XCTAssertEqual(json["target_soc"] as? Int, 90)
        XCTAssertEqual(json["current_soc"] as? Int, 42)
        XCTAssertEqual(json["max_amps"] as? Int, 48)
        XCTAssertEqual(json["battery_capacity_kwh"] as? Int, 100)
        XCTAssertEqual(json["charger_voltage"] as? Int, 208)
        XCTAssertEqual(json["prefer_off_peak"] as? Bool, false)
        XCTAssertEqual(json["rate_plan_id"] as? String, "tou-d")
    }

    func testBodyCoercesMissingVehicleToZero() throws {
        // Web `numericVehicleId || 0` — a missing id ships the 0 the disabled button never posts.
        let json = try decoded(SmartChargeScheduleRequest(vehicleID: nil, ratePlanID: "x", departBy: epoch))
        XCTAssertEqual(json["vehicle_id"] as? Int, 0)
    }

    func testBodyKeepsNegativeVehicleAsIs() throws {
        // Web `-3 || 0` → -3.
        let json = try decoded(SmartChargeScheduleRequest(vehicleID: -3, ratePlanID: "x", departBy: epoch))
        XCTAssertEqual(json["vehicle_id"] as? Int, -3)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let request = SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: "pge-ev2a", departBy: epoch)
        let string = try XCTUnwrap(String(bytes: request.encodedBody(), encoding: .utf8))
        XCTAssertEqual(
            string,
            "{\"battery_capacity_kwh\":75,\"charger_voltage\":240,\"current_soc\":20,"
                + "\"depart_by\":\"1970-01-01T00:00:00.000Z\",\"max_amps\":32,\"prefer_off_peak\":true,"
                + "\"rate_plan_id\":\"pge-ev2a\",\"target_soc\":80,\"vehicle_id\":7}"
        )
    }

    func testDepartByFallsBackToInjectedNowWhenUnset() {
        // Web `if (!departBy) return new Date().toISOString()`.
        let request = SmartChargeScheduleRequest(vehicleID: 7, ratePlanID: "x", departBy: nil, now: epoch)
        XCTAssertEqual(request.departByISO, "1970-01-01T00:00:00.000Z")
    }

    func testDepartByUsesSelectedInstantWhenSet() {
        let selected = Date(timeIntervalSince1970: 1000)
        let request = SmartChargeScheduleRequest(
            vehicleID: 7,
            ratePlanID: "x",
            departBy: selected,
            now: epoch
        )
        XCTAssertEqual(request.departByISO, "1970-01-01T00:16:40.000Z")
    }

    private func decoded(_ request: SmartChargeScheduleRequest) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: request.encodedBody())
        return try XCTUnwrap(object as? [String: Any])
    }
}

// MARK: - ISO-8601 instant (web `Date.toISOString()`)

final class SmartChargeScheduleISO8601Tests: XCTestCase {
    func testEpochFormatsAsUTCWithMilliseconds() {
        XCTAssertEqual(
            SmartChargeScheduleISO8601.string(from: Date(timeIntervalSince1970: 0)),
            "1970-01-01T00:00:00.000Z"
        )
    }

    func testFormatShapeIsToISOStringLike() {
        let string = SmartChargeScheduleISO8601.string(from: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertTrue(string.hasSuffix("Z"))
        XCTAssertTrue(string.contains("T"))
        XCTAssertTrue(string.contains("."))
        // yyyy-MM-ddTHH:mm:ss.SSSZ → 24 characters.
        XCTAssertEqual(string.count, 24)
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class SmartChargeScheduleSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"draft\"}"),
            .toolCall(id: "c1", name: "draft")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"draft\",\"ok\":true}"),
            .toolResult(id: "c1", name: "draft", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"schedule\",\"summary\":\"Apply?\"}"
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "schedule", summary: "Apply?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            SmartChargeScheduleSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(SmartChargeScheduleSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(SmartChargeScheduleSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(SmartChargeScheduleSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(SmartChargeScheduleSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class SmartChargeScheduleStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = SmartChargeScheduleStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = SmartChargeScheduleStreamReducer.start()
        snapshot = SmartChargeScheduleStreamReducer.reduce(snapshot, .delta(text: "Charge "))
        snapshot = SmartChargeScheduleStreamReducer.reduce(snapshot, .delta(text: "00:30–05:10."))
        XCTAssertEqual(snapshot.text, "Charge 00:30–05:10.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = SmartChargeScheduleStreamReducer.reduce(
            SmartChargeScheduleStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = SmartChargeScheduleStreamReducer.reduce(
            SmartChargeScheduleStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = SmartChargeScheduleStreamReducer.reduce(
            SmartChargeScheduleStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = SmartChargeScheduleStreamReducer.start()
        XCTAssertEqual(SmartChargeScheduleStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            SmartChargeScheduleStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = SmartChargeScheduleStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = SmartChargeScheduleStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class SmartChargeScheduleOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(SmartChargeScheduleOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(SmartChargeScheduleStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(SmartChargeScheduleStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(
                SmartChargeScheduleStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(SmartChargeScheduleStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(SmartChargeScheduleStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(SmartChargeScheduleStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            SmartChargeScheduleOutput.derive(SmartChargeScheduleStreamSnapshot(
                state: .error,
                text: "",
                error: nil
            )),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class SmartChargeScheduleActionDeriveTests: XCTestCase {
    func testIdleWithInputsIsEnabled() {
        let action = SmartChargeScheduleAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = SmartChargeScheduleAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testMissingInputsIsDisabled() {
        XCTAssertTrue(SmartChargeScheduleAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(SmartChargeScheduleAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
