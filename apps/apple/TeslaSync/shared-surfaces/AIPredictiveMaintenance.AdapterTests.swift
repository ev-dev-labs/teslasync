//
//  AIPredictiveMaintenance.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0039 · AIPredictiveMaintenance (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`haveScope ? { vehicle_id } :
//  { vehicle_id: 0 }`, snake_case, NO `days` field, the bare /ai/maintenance/predict path — the id
//  lives in the BODY, not the path; nil / 0 / negative ids coerce to 0), the SSE frame parsing
//  (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of
//  `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and the output /
//  action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class PredictiveMaintenanceRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(PredictiveMaintenanceRequest.path, "/ai/maintenance/predict")
    }

    func testBodyUsesSnakeCaseVehicleId() {
        let request = PredictiveMaintenanceRequest(vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
    }

    func testBodyHasNoDaysField() {
        // Unlike the range surface, the maintenance envelope is per-vehicle only — no `days`.
        XCTAssertNil(PredictiveMaintenanceRequest(vehicleID: 7).body["days"])
        XCTAssertEqual(PredictiveMaintenanceRequest(vehicleID: 7).body.count, 1)
    }

    func testHaveScopeRequiresPositiveVehicleId() {
        XCTAssertTrue(PredictiveMaintenanceRequest(vehicleID: 7).haveScope)
        XCTAssertFalse(PredictiveMaintenanceRequest(vehicleID: nil).haveScope)
        XCTAssertFalse(PredictiveMaintenanceRequest(vehicleID: 0).haveScope)
        XCTAssertFalse(PredictiveMaintenanceRequest(vehicleID: -3).haveScope)
    }

    func testBodyCoercesOutOfScopeVehicleToZero() {
        // Web `haveScope ? { vehicle_id: vehicleId } : { vehicle_id: 0 }`.
        XCTAssertEqual(PredictiveMaintenanceRequest(vehicleID: nil).body["vehicle_id"], 0)
        XCTAssertEqual(PredictiveMaintenanceRequest(vehicleID: 0).body["vehicle_id"], 0)
        XCTAssertEqual(PredictiveMaintenanceRequest(vehicleID: -3).body["vehicle_id"], 0)
    }

    func testBodyKeepsPositiveVehicleAsIs() {
        XCTAssertEqual(PredictiveMaintenanceRequest(vehicleID: 42).body["vehicle_id"], 42)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let scoped = try PredictiveMaintenanceRequest(vehicleID: 7).encodedBody()
        XCTAssertEqual(try XCTUnwrap(String(bytes: scoped, encoding: .utf8)), "{\"vehicle_id\":7}")

        let unscoped = try PredictiveMaintenanceRequest(vehicleID: nil).encodedBody()
        XCTAssertEqual(try XCTUnwrap(String(bytes: unscoped, encoding: .utf8)), "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class PredictiveMaintenanceSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"predict\"}"),
            .toolCall(id: "c1", name: "predict")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"predict\",\"ok\":true}"),
            .toolResult(id: "c1", name: "predict", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            PredictiveMaintenanceSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(PredictiveMaintenanceSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(PredictiveMaintenanceSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(PredictiveMaintenanceSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(PredictiveMaintenanceSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class PredictiveMaintenanceStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = PredictiveMaintenanceStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = PredictiveMaintenanceStreamReducer.start()
        snapshot = PredictiveMaintenanceStreamReducer.reduce(snapshot, .delta(text: "Tire "))
        snapshot = PredictiveMaintenanceStreamReducer.reduce(snapshot, .delta(text: "rotation."))
        XCTAssertEqual(snapshot.text, "Tire rotation.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = PredictiveMaintenanceStreamReducer.reduce(
            PredictiveMaintenanceStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = PredictiveMaintenanceStreamReducer.reduce(
            PredictiveMaintenanceStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = PredictiveMaintenanceStreamReducer.reduce(
            PredictiveMaintenanceStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = PredictiveMaintenanceStreamReducer.start()
        XCTAssertEqual(PredictiveMaintenanceStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            PredictiveMaintenanceStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = PredictiveMaintenanceStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = PredictiveMaintenanceStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class PredictiveMaintenanceOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(PredictiveMaintenanceOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(PredictiveMaintenanceStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(PredictiveMaintenanceStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(
                PredictiveMaintenanceStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(PredictiveMaintenanceStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(PredictiveMaintenanceStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(PredictiveMaintenanceStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            PredictiveMaintenanceOutput.derive(PredictiveMaintenanceStreamSnapshot(
                state: .error,
                text: "",
                error: nil
            )),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class PredictiveMaintenanceActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = PredictiveMaintenanceAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = PredictiveMaintenanceAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(PredictiveMaintenanceAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(PredictiveMaintenanceAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
