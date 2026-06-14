//
//  AITripPlannerLLMAgent.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (7-field plan object, nested
//  origin/destination, snake_case, `?? default` fallbacks, `vehicle_id` 0-coercion, missing-endpoint
//  fallback), the `haveInputs` rule, JS-faithful float encoding, SSE parse, reducer, output / action.
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class TripPlannerAgentRequestTests: XCTestCase {
    private let sf = TripPlannerAgentLocation(lat: 37.7749, lng: -122.4194, name: "San Francisco")
    private let la = TripPlannerAgentLocation(lat: 34.0522, lng: -118.2437, name: "Los Angeles")

    func testPathIsBareRoute() {
        XCTAssertEqual(TripPlannerAgentRequest.path, "/ai/trips/plan/draft")
    }

    func testHaveInputsRequiresVehicleOriginAndDestination() {
        XCTAssertTrue(TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: la).haveInputs)
        XCTAssertFalse(TripPlannerAgentRequest(vehicleID: nil, origin: sf, destination: la).haveInputs)
        XCTAssertFalse(TripPlannerAgentRequest(vehicleID: 7, origin: nil, destination: la).haveInputs)
        XCTAssertFalse(TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: nil).haveInputs)
    }

    func testHaveInputsTreatsZeroVehicleAsFalsy() {
        XCTAssertFalse(TripPlannerAgentRequest(vehicleID: 0, origin: sf, destination: la).haveInputs)
    }

    func testHaveInputsTreatsNegativeVehicleAsTruthy() {
        XCTAssertTrue(TripPlannerAgentRequest(vehicleID: -3, origin: sf, destination: la).haveInputs)
    }

    func testBodyUsesSnakeCaseAndWebDefaults() throws {
        let json = try decoded(TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: la))
        XCTAssertEqual(json["vehicle_id"] as? Int, 7)
        XCTAssertEqual(json["current_soc"] as? Int, 80)
        XCTAssertEqual(json["charge_limit_soc"] as? Int, 90)
        XCTAssertEqual(json["min_arrival_soc"] as? Int, 20)
        XCTAssertEqual(json["speed_factor"] as? Double, 1.0)
    }

    func testBodyHasExactlySevenTopLevelFields() throws {
        let json = try decoded(TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: la))
        XCTAssertEqual(json.count, 7)
    }

    func testBodyNestsOriginAndDestination() throws {
        let json = try decoded(TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: la))
        let origin = try XCTUnwrap(json["origin"] as? [String: Any])
        XCTAssertEqual(origin["lat"] as? Double, 37.7749)
        XCTAssertEqual(origin["lng"] as? Double, -122.4194)
        XCTAssertEqual(origin["name"] as? String, "San Francisco")
        let destination = try XCTUnwrap(json["destination"] as? [String: Any])
        XCTAssertEqual(destination["lat"] as? Double, 34.0522)
        XCTAssertEqual(destination["lng"] as? Double, -118.2437)
        XCTAssertEqual(destination["name"] as? String, "Los Angeles")
    }

    func testBodyCoalescesMissingEndpointsToZeroObjects() throws {
        let json = try decoded(TripPlannerAgentRequest(vehicleID: 7, origin: nil, destination: nil))
        let origin = try XCTUnwrap(json["origin"] as? [String: Any])
        XCTAssertEqual(origin["lat"] as? Double, 0)
        XCTAssertEqual(origin["lng"] as? Double, 0)
        XCTAssertEqual(origin["name"] as? String, "")
        let destination = try XCTUnwrap(json["destination"] as? [String: Any])
        XCTAssertEqual(destination["lat"] as? Double, 0)
        XCTAssertEqual(destination["lng"] as? Double, 0)
        XCTAssertEqual(destination["name"] as? String, "")
    }

    func testBodyCoalescesMissingNameToEmptyString() throws {
        let unnamed = TripPlannerAgentLocation(lat: 1.0, lng: 2.0, name: nil)
        let json = try decoded(TripPlannerAgentRequest(vehicleID: 7, origin: unnamed, destination: la))
        let origin = try XCTUnwrap(json["origin"] as? [String: Any])
        XCTAssertEqual(origin["name"] as? String, "")
    }

    func testBodyOverridesAreCarriedThrough() throws {
        let request = TripPlannerAgentRequest(
            vehicleID: 3,
            origin: sf,
            destination: la,
            currentSoc: 55,
            chargeLimitSoc: 100,
            minArrivalSoc: 15,
            speedFactor: 1.25
        )
        let json = try decoded(request)
        XCTAssertEqual(json["vehicle_id"] as? Int, 3)
        XCTAssertEqual(json["current_soc"] as? Int, 55)
        XCTAssertEqual(json["charge_limit_soc"] as? Int, 100)
        XCTAssertEqual(json["min_arrival_soc"] as? Int, 15)
        XCTAssertEqual(json["speed_factor"] as? Double, 1.25)
    }

    func testBodyCoercesMissingVehicleToZero() throws {
        let json = try decoded(TripPlannerAgentRequest(vehicleID: nil, origin: sf, destination: la))
        XCTAssertEqual(json["vehicle_id"] as? Int, 0)
    }

    func testBodyKeepsNegativeVehicleAsIs() throws {
        let json = try decoded(TripPlannerAgentRequest(vehicleID: -3, origin: sf, destination: la))
        XCTAssertEqual(json["vehicle_id"] as? Int, -3)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let request = TripPlannerAgentRequest(
            vehicleID: 7,
            origin: TripPlannerAgentLocation(lat: 1.5, lng: -2.5, name: "A"),
            destination: TripPlannerAgentLocation(lat: 3.25, lng: 4.75, name: "B")
        )
        let string = try XCTUnwrap(String(bytes: request.encodedBody(), encoding: .utf8))
        XCTAssertEqual(
            string,
            "{\"charge_limit_soc\":90,\"current_soc\":80,"
                + "\"destination\":{\"lat\":3.25,\"lng\":4.75,\"name\":\"B\"},"
                + "\"min_arrival_soc\":20,\"origin\":{\"lat\":1.5,\"lng\":-2.5,\"name\":\"A\"},"
                + "\"speed_factor\":1,\"vehicle_id\":7}"
        )
    }

    func testEncodedBodyPreservesFractionalCoordinatesLikeJSON() throws {
        // Parity guard: JS `JSON.stringify(37.7749)` is "37.7749". `JSONEncoder` matches it;
        // `JSONSerialization` would corrupt it to "37.774900000000002".
        let request = TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: la)
        let string = try XCTUnwrap(String(bytes: request.encodedBody(), encoding: .utf8))
        XCTAssertTrue(string.contains("37.7749"))
        XCTAssertTrue(string.contains("-122.4194"))
        XCTAssertFalse(string.contains("37.774900000000002"))
    }

    func testSpeedFactorWholeValueEncodesWithoutDecimalLikeJSON() throws {
        // JS `JSON.stringify(1.0)` is "1"; `JSONEncoder` emits "1" too (not "1.0").
        let request = TripPlannerAgentRequest(vehicleID: 7, origin: sf, destination: la)
        let string = try XCTUnwrap(String(bytes: request.encodedBody(), encoding: .utf8))
        XCTAssertTrue(string.contains("\"speed_factor\":1"))
        XCTAssertFalse(string.contains("\"speed_factor\":1.0"))
    }

    private func decoded(_ request: TripPlannerAgentRequest) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: request.encodedBody())
        return try XCTUnwrap(object as? [String: Any])
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class TripPlannerAgentSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"draft\"}"),
            .toolCall(id: "c1", name: "draft")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"draft\",\"ok\":true}"),
            .toolResult(id: "c1", name: "draft", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"plan\",\"summary\":\"Save?\"}"
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "plan", summary: "Save?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            TripPlannerAgentSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(TripPlannerAgentSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(TripPlannerAgentSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(TripPlannerAgentSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(TripPlannerAgentSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class TripPlannerAgentStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = TripPlannerAgentStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = TripPlannerAgentStreamReducer.start()
        snapshot = TripPlannerAgentStreamReducer.reduce(snapshot, .delta(text: "SF "))
        snapshot = TripPlannerAgentStreamReducer.reduce(snapshot, .delta(text: "→ LA."))
        XCTAssertEqual(snapshot.text, "SF → LA.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = TripPlannerAgentStreamReducer.reduce(
            TripPlannerAgentStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = TripPlannerAgentStreamReducer.reduce(
            TripPlannerAgentStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = TripPlannerAgentStreamReducer.reduce(
            TripPlannerAgentStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = TripPlannerAgentStreamReducer.start()
        XCTAssertEqual(TripPlannerAgentStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            TripPlannerAgentStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = TripPlannerAgentStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = TripPlannerAgentStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class TripPlannerAgentOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(TripPlannerAgentOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(TripPlannerAgentStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(TripPlannerAgentStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(
                TripPlannerAgentStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(TripPlannerAgentStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(TripPlannerAgentStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(TripPlannerAgentStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            TripPlannerAgentOutput.derive(TripPlannerAgentStreamSnapshot(
                state: .error,
                text: "",
                error: nil
            )),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class TripPlannerAgentActionDeriveTests: XCTestCase {
    func testIdleWithInputsIsEnabled() {
        let action = TripPlannerAgentAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = TripPlannerAgentAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testMissingInputsIsDisabled() {
        XCTAssertTrue(TripPlannerAgentAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(TripPlannerAgentAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
