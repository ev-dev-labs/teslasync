//
//  AIChargingDiagnosis.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0011 · AIChargingDiagnosis (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL (`/ai/charging/{sessionID}/diagnose`
//  with `encodeURIComponent`, the `/ai/charging/0/diagnose` fallback, the empty `{}` body — the id is
//  in the PATH and there is no body field), the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` +
//  `finalizeError` + the `stream_http_{status}` HTTP failure), and the output / action derivations
//  (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class ChargingDiagnoseRequestTests: XCTestCase {
    func testFallbackPathWhenNoSession() {
        // Web ternary `sessionId ? … : '/ai/charging/0/diagnose'`.
        XCTAssertEqual(ChargingDiagnoseRequest.fallbackPath, "/ai/charging/0/diagnose")
        XCTAssertEqual(ChargingDiagnoseRequest(sessionID: nil).path, "/ai/charging/0/diagnose")
    }

    func testEmptySessionFallsBackToZeroPath() {
        // JS `"" ? a : b` → b, so an empty sessionID uses the fallback route.
        XCTAssertEqual(ChargingDiagnoseRequest(sessionID: "").path, "/ai/charging/0/diagnose")
    }

    func testPathEmbedsSessionID() {
        XCTAssertEqual(ChargingDiagnoseRequest(sessionID: "4821").path, "/ai/charging/4821/diagnose")
    }

    func testPathPercentEncodesSessionID() {
        // Web `encodeURIComponent(sessionId)` — a space → %20, a slash → %2F.
        XCTAssertEqual(ChargingDiagnoseRequest(sessionID: "a b/c").path, "/ai/charging/a%20b%2Fc/diagnose")
    }

    func testEncodeURIComponentKeepsUnreservedSet() {
        // encodeURIComponent leaves A-Za-z0-9 - _ . ! ~ * ' ( ) untouched.
        XCTAssertEqual(ChargingDiagnoseRequest.encodeURIComponent("Aa9-_.!~*'()"), "Aa9-_.!~*'()")
    }

    func testBodyIsEmptyObject() {
        // Web `useMemo(() => ({}), [])` — an empty body; the id lives in the path.
        XCTAssertTrue(ChargingDiagnoseRequest(sessionID: "4821").body.isEmpty)
        XCTAssertNil(ChargingDiagnoseRequest(sessionID: "4821").body["vehicle_id"])
    }

    func testEncodedBodyIsEmptyJSONObject() throws {
        let data = try ChargingDiagnoseRequest(sessionID: "4821").encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }

    func testEncodedBodyForMissingSessionIsStillEmptyObject() throws {
        let data = try ChargingDiagnoseRequest(sessionID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class ChargingDiagnosisSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(ChargingDiagnosisSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(ChargingDiagnosisSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"diagnose\"}"),
            .toolCall(id: "c1", name: "diagnose")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"diagnose\",\"ok\":true}"),
            .toolResult(id: "c1", name: "diagnose", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            ChargingDiagnosisSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(ChargingDiagnosisSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(ChargingDiagnosisSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(ChargingDiagnosisSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(ChargingDiagnosisSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class ChargingDiagnosisStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = ChargingDiagnosisStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = ChargingDiagnosisStreamReducer.start()
        snapshot = ChargingDiagnosisStreamReducer.reduce(snapshot, .delta(text: "Trickle "))
        snapshot = ChargingDiagnosisStreamReducer.reduce(snapshot, .delta(text: "charge."))
        XCTAssertEqual(snapshot.text, "Trickle charge.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = ChargingDiagnosisStreamReducer.reduce(
            ChargingDiagnosisStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = ChargingDiagnosisStreamReducer.reduce(
            ChargingDiagnosisStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = ChargingDiagnosisStreamReducer.reduce(
            ChargingDiagnosisStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = ChargingDiagnosisStreamReducer.start()
        XCTAssertEqual(ChargingDiagnosisStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(ChargingDiagnosisStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = ChargingDiagnosisStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = ChargingDiagnosisStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class ChargingDiagnosisOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(ChargingDiagnosisOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            ChargingDiagnosisOutput.derive(ChargingDiagnosisStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class ChargingDiagnosisActionDeriveTests: XCTestCase {
    func testIdleWithSessionIsEnabled() {
        let action = ChargingDiagnosisAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = ChargingDiagnosisAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoSessionIsDisabled() {
        XCTAssertTrue(ChargingDiagnosisAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(ChargingDiagnosisAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
