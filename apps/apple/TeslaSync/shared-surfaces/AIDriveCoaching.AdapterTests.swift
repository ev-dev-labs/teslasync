//
//  AIDriveCoaching.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0017 · AIDriveCoaching (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL (`/ai/drives/{driveID}/coach` with
//  `encodeURIComponent`, the `/ai/drives/0/coach` fallback, the empty `{}` body — unlike 0008's
//  narrate the id is in the PATH and there is no body field), the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` +
//  `finalizeError` + the `stream_http_{status}` HTTP failure), and the output / action derivations
//  (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class DriveCoachRequestTests: XCTestCase {
    func testFallbackPathWhenNoDrive() {
        // Web ternary `driveId ? … : '/ai/drives/0/coach'`.
        XCTAssertEqual(DriveCoachRequest.fallbackPath, "/ai/drives/0/coach")
        XCTAssertEqual(DriveCoachRequest(driveID: nil).path, "/ai/drives/0/coach")
    }

    func testEmptyDriveFallsBackToZeroPath() {
        // JS `"" ? a : b` → b, so an empty driveID uses the fallback route.
        XCTAssertEqual(DriveCoachRequest(driveID: "").path, "/ai/drives/0/coach")
    }

    func testPathEmbedsDriveID() {
        XCTAssertEqual(DriveCoachRequest(driveID: "4821").path, "/ai/drives/4821/coach")
    }

    func testPathPercentEncodesDriveID() {
        // Web `encodeURIComponent(driveId)` — a space → %20, a slash → %2F.
        XCTAssertEqual(DriveCoachRequest(driveID: "a b/c").path, "/ai/drives/a%20b%2Fc/coach")
    }

    func testEncodeURIComponentKeepsUnreservedSet() {
        // encodeURIComponent leaves A-Za-z0-9 - _ . ! ~ * ' ( ) untouched.
        XCTAssertEqual(DriveCoachRequest.encodeURIComponent("Aa9-_.!~*'()"), "Aa9-_.!~*'()")
    }

    func testBodyIsEmptyObject() {
        // Web `useMemo(() => ({}), [])` — an empty body; the id lives in the path.
        XCTAssertTrue(DriveCoachRequest(driveID: "4821").body.isEmpty)
        XCTAssertNil(DriveCoachRequest(driveID: "4821").body["vehicle_id"])
    }

    func testEncodedBodyIsEmptyJSONObject() throws {
        let data = try DriveCoachRequest(driveID: "4821").encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }

    func testEncodedBodyForMissingDriveIsStillEmptyObject() throws {
        let data = try DriveCoachRequest(driveID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class DriveCoachingSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(DriveCoachingSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(DriveCoachingSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"coach\"}"),
            .toolCall(id: "c1", name: "coach")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            DriveCoachingSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"coach\",\"ok\":true}"),
            .toolResult(id: "c1", name: "coach", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            DriveCoachingSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(DriveCoachingSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(DriveCoachingSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(DriveCoachingSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(DriveCoachingSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class DriveCoachingStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = DriveCoachingStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = DriveCoachingStreamReducer.start()
        snapshot = DriveCoachingStreamReducer.reduce(snapshot, .delta(text: "Solid "))
        snapshot = DriveCoachingStreamReducer.reduce(snapshot, .delta(text: "drive."))
        XCTAssertEqual(snapshot.text, "Solid drive.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = DriveCoachingStreamReducer.reduce(
            DriveCoachingStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = DriveCoachingStreamReducer.reduce(
            DriveCoachingStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = DriveCoachingStreamReducer.reduce(
            DriveCoachingStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = DriveCoachingStreamReducer.start()
        XCTAssertEqual(DriveCoachingStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(DriveCoachingStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = DriveCoachingStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = DriveCoachingStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class DriveCoachingOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(DriveCoachingOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            DriveCoachingOutput.derive(DriveCoachingStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class DriveCoachingActionDeriveTests: XCTestCase {
    func testIdleWithDriveIsEnabled() {
        let action = DriveCoachingAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = DriveCoachingAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoDriveIsDisabled() {
        XCTAssertTrue(DriveCoachingAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(DriveCoachingAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
