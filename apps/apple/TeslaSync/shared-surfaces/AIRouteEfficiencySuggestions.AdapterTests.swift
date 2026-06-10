//
//  AIRouteEfficiencySuggestions.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0044 · AIRouteEfficiencySuggestions (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL
//  (`/ai/routes/{vehicleID}/efficiency/suggest` with `encodeURIComponent`, the
//  `/ai/routes/0/efficiency/suggest` fallback, the empty `{}` body — the id is in the PATH and there
//  is no body field), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class RouteEfficiencySuggestRequestTests: XCTestCase {
    func testFallbackPathWhenNoVehicle() {
        // Web ternary `vehicleId ? … : '/ai/routes/0/efficiency/suggest'`.
        XCTAssertEqual(RouteEfficiencySuggestRequest.fallbackPath, "/ai/routes/0/efficiency/suggest")
        XCTAssertEqual(RouteEfficiencySuggestRequest(vehicleID: nil).path, "/ai/routes/0/efficiency/suggest")
    }

    func testEmptyVehicleFallsBackToZeroPath() {
        // JS `"" ? a : b` → b, so an empty vehicleId uses the fallback route.
        XCTAssertEqual(RouteEfficiencySuggestRequest(vehicleID: "").path, "/ai/routes/0/efficiency/suggest")
    }

    func testPathEmbedsVehicleID() {
        XCTAssertEqual(RouteEfficiencySuggestRequest(vehicleID: "7").path, "/ai/routes/7/efficiency/suggest")
    }

    func testPathPercentEncodesVehicleID() {
        // Web `encodeURIComponent(vehicleId)` — a space → %20, a slash → %2F.
        XCTAssertEqual(
            RouteEfficiencySuggestRequest(vehicleID: "a b/c").path,
            "/ai/routes/a%20b%2Fc/efficiency/suggest"
        )
    }

    func testEncodeURIComponentKeepsUnreservedSet() {
        // encodeURIComponent leaves A-Za-z0-9 - _ . ! ~ * ' ( ) untouched.
        XCTAssertEqual(RouteEfficiencySuggestRequest.encodeURIComponent("Aa9-_.!~*'()"), "Aa9-_.!~*'()")
    }

    func testBodyIsEmptyObject() {
        // Web `useMemo(() => ({}), [])` — an empty body; the id lives in the path.
        XCTAssertTrue(RouteEfficiencySuggestRequest(vehicleID: "7").body.isEmpty)
        XCTAssertNil(RouteEfficiencySuggestRequest(vehicleID: "7").body["vehicle_id"])
    }

    func testEncodedBodyIsEmptyJSONObject() throws {
        let data = try RouteEfficiencySuggestRequest(vehicleID: "7").encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }

    func testEncodedBodyForMissingVehicleIsStillEmptyObject() throws {
        let data = try RouteEfficiencySuggestRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class RouteEfficiencySuggestionsSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"suggest\"}"),
            .toolCall(id: "c1", name: "suggest")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"suggest\",\"ok\":true}"),
            .toolResult(id: "c1", name: "suggest", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(RouteEfficiencySuggestionsSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(RouteEfficiencySuggestionsSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(RouteEfficiencySuggestionsSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(RouteEfficiencySuggestionsSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class RouteEfficiencySuggestionsStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = RouteEfficiencySuggestionsStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = RouteEfficiencySuggestionsStreamReducer.start()
        snapshot = RouteEfficiencySuggestionsStreamReducer.reduce(snapshot, .delta(text: "Lower "))
        snapshot = RouteEfficiencySuggestionsStreamReducer.reduce(snapshot, .delta(text: "cruise speed."))
        XCTAssertEqual(snapshot.text, "Lower cruise speed.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = RouteEfficiencySuggestionsStreamReducer.reduce(
            RouteEfficiencySuggestionsStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = RouteEfficiencySuggestionsStreamReducer.reduce(
            RouteEfficiencySuggestionsStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = RouteEfficiencySuggestionsStreamReducer.reduce(
            RouteEfficiencySuggestionsStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = RouteEfficiencySuggestionsStreamReducer.start()
        XCTAssertEqual(
            RouteEfficiencySuggestionsStreamReducer.reduce(start, .toolCall(id: "1", name: "n")),
            start
        )
        XCTAssertEqual(
            RouteEfficiencySuggestionsStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = RouteEfficiencySuggestionsStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = RouteEfficiencySuggestionsStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class RouteEfficiencySuggestionsOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(RouteEfficiencySuggestionsOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(RouteEfficiencySuggestionsStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(
                RouteEfficiencySuggestionsStreamSnapshot(state: .streaming, text: "")
            ),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(
                RouteEfficiencySuggestionsStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(
                RouteEfficiencySuggestionsStreamSnapshot(state: .done, text: "final")
            ),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(
                RouteEfficiencySuggestionsStreamSnapshot(state: .done, text: "")
            ),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(RouteEfficiencySuggestionsStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            RouteEfficiencySuggestionsOutput.derive(
                RouteEfficiencySuggestionsStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class RouteEfficiencySuggestionsActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = RouteEfficiencySuggestionsAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = RouteEfficiencySuggestionsAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(RouteEfficiencySuggestionsAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(RouteEfficiencySuggestionsAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
