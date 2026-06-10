//
//  AISpeedProfileInsights.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0049 · AISpeedProfileInsights (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL
//  (`/ai/drives/{driveID}/speed-profile/insights` with `encodeURIComponent`, the
//  `/ai/drives/0/speed-profile/insights` fallback, the empty `{}` body — the id is in the PATH and there
//  is no body field), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class SpeedProfileInsightsRequestTests: XCTestCase {
    func testFallbackPathWhenNoDrive() {
        // Web ternary `driveId ? … : '/ai/drives/0/speed-profile/insights'`.
        XCTAssertEqual(SpeedProfileInsightsRequest.fallbackPath, "/ai/drives/0/speed-profile/insights")
        XCTAssertEqual(SpeedProfileInsightsRequest(driveID: nil).path, "/ai/drives/0/speed-profile/insights")
    }

    func testEmptyDriveFallsBackToZeroPath() {
        // JS `"" ? a : b` → b, so an empty driveId uses the fallback path.
        XCTAssertEqual(SpeedProfileInsightsRequest(driveID: "").path, "/ai/drives/0/speed-profile/insights")
    }

    func testPathEmbedsDriveID() {
        XCTAssertEqual(SpeedProfileInsightsRequest(driveID: "7").path, "/ai/drives/7/speed-profile/insights")
    }

    func testPathPercentEncodesDriveID() {
        // Web `encodeURIComponent(driveId)` — a space → %20, a slash → %2F.
        XCTAssertEqual(
            SpeedProfileInsightsRequest(driveID: "a b/c").path,
            "/ai/drives/a%20b%2Fc/speed-profile/insights"
        )
    }

    func testEncodeURIComponentKeepsUnreservedSet() {
        // encodeURIComponent leaves A-Za-z0-9 - _ . ! ~ * ' ( ) untouched.
        XCTAssertEqual(SpeedProfileInsightsRequest.encodeURIComponent("Aa9-_.!~*'()"), "Aa9-_.!~*'()")
    }

    func testBodyIsEmptyObject() {
        // Web `useMemo(() => ({}), [])` — an empty body; the id lives in the path.
        XCTAssertTrue(SpeedProfileInsightsRequest(driveID: "7").body.isEmpty)
        XCTAssertNil(SpeedProfileInsightsRequest(driveID: "7").body["drive_id"])
    }

    func testEncodedBodyIsEmptyJSONObject() throws {
        let data = try SpeedProfileInsightsRequest(driveID: "7").encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }

    func testEncodedBodyForMissingDriveIsStillEmptyObject() throws {
        let data = try SpeedProfileInsightsRequest(driveID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class SpeedProfileInsightsSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"suggest\"}"),
            .toolCall(id: "c1", name: "suggest")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"suggest\",\"ok\":true}"),
            .toolResult(id: "c1", name: "suggest", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            SpeedProfileInsightsSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(SpeedProfileInsightsSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(SpeedProfileInsightsSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(SpeedProfileInsightsSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(SpeedProfileInsightsSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class SpeedProfileInsightsStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = SpeedProfileInsightsStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = SpeedProfileInsightsStreamReducer.start()
        snapshot = SpeedProfileInsightsStreamReducer.reduce(snapshot, .delta(text: "Lower "))
        snapshot = SpeedProfileInsightsStreamReducer.reduce(snapshot, .delta(text: "cruise speed."))
        XCTAssertEqual(snapshot.text, "Lower cruise speed.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = SpeedProfileInsightsStreamReducer.reduce(
            SpeedProfileInsightsStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = SpeedProfileInsightsStreamReducer.reduce(
            SpeedProfileInsightsStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = SpeedProfileInsightsStreamReducer.reduce(
            SpeedProfileInsightsStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = SpeedProfileInsightsStreamReducer.start()
        XCTAssertEqual(
            SpeedProfileInsightsStreamReducer.reduce(start, .toolCall(id: "1", name: "n")),
            start
        )
        XCTAssertEqual(
            SpeedProfileInsightsStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = SpeedProfileInsightsStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = SpeedProfileInsightsStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class SpeedProfileInsightsOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(SpeedProfileInsightsOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(SpeedProfileInsightsStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(
                SpeedProfileInsightsStreamSnapshot(state: .streaming, text: "")
            ),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(
                SpeedProfileInsightsStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(
                SpeedProfileInsightsStreamSnapshot(state: .done, text: "final")
            ),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(
                SpeedProfileInsightsStreamSnapshot(state: .done, text: "")
            ),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(SpeedProfileInsightsStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            SpeedProfileInsightsOutput.derive(
                SpeedProfileInsightsStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class SpeedProfileInsightsActionDeriveTests: XCTestCase {
    func testIdleWithDriveIsEnabled() {
        let action = SpeedProfileInsightsAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = SpeedProfileInsightsAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoDriveIsDisabled() {
        XCTAssertTrue(SpeedProfileInsightsAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(SpeedProfileInsightsAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
