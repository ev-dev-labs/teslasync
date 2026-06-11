//
//  AIDigestNarration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0016 · AIDigestNarration (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request (the static `/ai/digests/weekly/narrate`
//  path, the `{ vehicle_id: vehicleId ?? 0, week_offset_weeks: 0 }` body with the `vehicleId ?? 0`
//  coalescing, the hardcoded current-week offset, and the sorted JSON encoding), the SSE frame
//  parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of
//  `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and the output /
//  action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class DigestNarrationRequestTests: XCTestCase {
    func testPathIsStaticNarrateEndpoint() {
        // Web url `'/ai/digests/weekly/narrate'` — static, no path params.
        XCTAssertEqual(DigestNarrationRequest.path, "/ai/digests/weekly/narrate")
    }

    func testDefaultWeekOffsetIsZero() {
        // Web `week_offset_weeks: 0` — this week's digest, a hardcoded constant.
        XCTAssertEqual(DigestNarrationRequest.defaultWeekOffset, 0)
        XCTAssertEqual(DigestNarrationRequest(vehicleID: 7).weekOffsetWeeks, 0)
    }

    func testBodyCarriesVehicleAndWeekOffset() {
        let body = DigestNarrationRequest(vehicleID: 7).body
        XCTAssertEqual(body, ["vehicle_id": 7, "week_offset_weeks": 0])
    }

    func testBodyCoalescesMissingVehicleToZero() {
        // Web `vehicle_id: vehicleId ?? 0` — a missing vehicle still sends 0.
        let body = DigestNarrationRequest(vehicleID: nil).body
        XCTAssertEqual(body, ["vehicle_id": 0, "week_offset_weeks": 0])
    }

    func testBodyKeepsZeroVehicle() {
        // vehicleId 0 is a present id (`0 != null`); the body carries 0 verbatim.
        XCTAssertEqual(DigestNarrationRequest(vehicleID: 0).body["vehicle_id"], 0)
    }

    func testBodyCarriesNonDefaultWeekOffset() {
        let body = DigestNarrationRequest(vehicleID: 7, weekOffsetWeeks: 2).body
        XCTAssertEqual(body, ["vehicle_id": 7, "week_offset_weeks": 2])
    }

    func testEncodedBodyIsSortedCompactJSON() throws {
        let data = try DigestNarrationRequest(vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7,\"week_offset_weeks\":0}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try DigestNarrationRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0,\"week_offset_weeks\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class DigestNarrationSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"recap\"}"),
            .toolCall(id: "c1", name: "recap")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            DigestNarrationSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"recap\",\"ok\":true}"),
            .toolResult(id: "c1", name: "recap", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            DigestNarrationSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(DigestNarrationSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(DigestNarrationSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(DigestNarrationSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(DigestNarrationSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class DigestNarrationStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = DigestNarrationStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = DigestNarrationStreamReducer.start()
        snapshot = DigestNarrationStreamReducer.reduce(snapshot, .delta(text: "A steady "))
        snapshot = DigestNarrationStreamReducer.reduce(snapshot, .delta(text: "week."))
        XCTAssertEqual(snapshot.text, "A steady week.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = DigestNarrationStreamReducer.reduce(
            DigestNarrationStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = DigestNarrationStreamReducer.reduce(
            DigestNarrationStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = DigestNarrationStreamReducer.reduce(
            DigestNarrationStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = DigestNarrationStreamReducer.start()
        XCTAssertEqual(
            DigestNarrationStreamReducer.reduce(start, .toolCall(id: "1", name: "n")),
            start
        )
        XCTAssertEqual(
            DigestNarrationStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = DigestNarrationStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = DigestNarrationStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class DigestNarrationOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(DigestNarrationOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            DigestNarrationOutput.derive(DigestNarrationStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            DigestNarrationOutput.derive(
                DigestNarrationStreamSnapshot(state: .streaming, text: "")
            ),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            DigestNarrationOutput.derive(
                DigestNarrationStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            DigestNarrationOutput.derive(
                DigestNarrationStreamSnapshot(state: .done, text: "final")
            ),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            DigestNarrationOutput.derive(
                DigestNarrationStreamSnapshot(state: .done, text: "")
            ),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            DigestNarrationOutput.derive(DigestNarrationStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            DigestNarrationOutput.derive(
                DigestNarrationStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class DigestNarrationActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = DigestNarrationAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = DigestNarrationAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(DigestNarrationAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(DigestNarrationAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
