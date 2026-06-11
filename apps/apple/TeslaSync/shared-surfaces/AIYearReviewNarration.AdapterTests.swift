//
//  AIYearReviewNarration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0061 · AIYearReviewNarration (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request (the static
//  `/ai/analytics/year-in-review/narrate` path, the `{ vehicle_id: vehicleId ?? 0, year: defaultYear }`
//  body with the `vehicleId ?? 0` coalescing, the previous-calendar-year default, and the sorted JSON
//  encoding), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class YearReviewNarrationRequestTests: XCTestCase {
    func testPathIsStaticNarrateEndpoint() {
        // Web url `'/ai/analytics/year-in-review/narrate'` — static, no path params.
        XCTAssertEqual(YearReviewNarrationRequest.path, "/ai/analytics/year-in-review/narrate")
    }

    func testBodyCarriesVehicleAndYear() {
        let body = YearReviewNarrationRequest(vehicleID: 7, year: 2025).body
        XCTAssertEqual(body, ["vehicle_id": 7, "year": 2025])
    }

    func testBodyCoalescesMissingVehicleToZero() {
        // Web `vehicle_id: vehicleId ?? 0` — a missing vehicle still sends 0.
        let body = YearReviewNarrationRequest(vehicleID: nil, year: 2025).body
        XCTAssertEqual(body, ["vehicle_id": 0, "year": 2025])
    }

    func testBodyKeepsZeroVehicle() {
        // vehicleId 0 is a present id (`0 != null`); the body carries 0 verbatim.
        XCTAssertEqual(YearReviewNarrationRequest(vehicleID: 0, year: 2025).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsSortedCompactJSON() throws {
        let data = try YearReviewNarrationRequest(vehicleID: 7, year: 2025).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":7,\"year\":2025}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        let data = try YearReviewNarrationRequest(vehicleID: nil, year: 2025).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0,\"year\":2025}")
    }

    func testDefaultYearIsPreviousCalendarYear() throws {
        // Web `new Date().getFullYear() - 1` — the previous calendar year.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 10, hour: 12)))
        XCTAssertEqual(YearReviewNarrationRequest.defaultYear(now: now, calendar: calendar), 2025)
    }

    func testDefaultYearHonoursYearBoundary() throws {
        // Jan 1 still reports the prior year (the just-ended one).
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2030, month: 1, day: 1, hour: 0)))
        XCTAssertEqual(YearReviewNarrationRequest.defaultYear(now: now, calendar: calendar), 2029)
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class YearReviewNarrationSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"recap\"}"),
            .toolCall(id: "c1", name: "recap")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"recap\",\"ok\":true}"),
            .toolResult(id: "c1", name: "recap", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            YearReviewNarrationSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(YearReviewNarrationSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(YearReviewNarrationSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(YearReviewNarrationSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(YearReviewNarrationSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class YearReviewNarrationStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = YearReviewNarrationStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = YearReviewNarrationStreamReducer.start()
        snapshot = YearReviewNarrationStreamReducer.reduce(snapshot, .delta(text: "A steady "))
        snapshot = YearReviewNarrationStreamReducer.reduce(snapshot, .delta(text: "year."))
        XCTAssertEqual(snapshot.text, "A steady year.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = YearReviewNarrationStreamReducer.reduce(
            YearReviewNarrationStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = YearReviewNarrationStreamReducer.reduce(
            YearReviewNarrationStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = YearReviewNarrationStreamReducer.reduce(
            YearReviewNarrationStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = YearReviewNarrationStreamReducer.start()
        XCTAssertEqual(
            YearReviewNarrationStreamReducer.reduce(start, .toolCall(id: "1", name: "n")),
            start
        )
        XCTAssertEqual(
            YearReviewNarrationStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = YearReviewNarrationStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = YearReviewNarrationStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class YearReviewNarrationOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(YearReviewNarrationOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(YearReviewNarrationStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(
                YearReviewNarrationStreamSnapshot(state: .streaming, text: "")
            ),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(
                YearReviewNarrationStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(
                YearReviewNarrationStreamSnapshot(state: .done, text: "final")
            ),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(
                YearReviewNarrationStreamSnapshot(state: .done, text: "")
            ),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(YearReviewNarrationStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            YearReviewNarrationOutput.derive(
                YearReviewNarrationStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class YearReviewNarrationActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = YearReviewNarrationAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = YearReviewNarrationAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(YearReviewNarrationAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(YearReviewNarrationAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
