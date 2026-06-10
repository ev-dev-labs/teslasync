//
//  AISafetySettingExplainer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0045 · AISafetySettingExplainer (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (the empty object `{}`, the
//  /ai/settings/safety/explain path), the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract, incl. the
//  `canStart = state !== 'paused-confirm'` rule + the `isBusy` double-submit guard).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class SafetySettingExplainerRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(SafetySettingExplainerRequest.path, "/ai/settings/safety/explain")
    }

    func testBodyIsEmptyObject() {
        // Parity: web `body = useMemo(() => ({}), [])` — no fields (no vehicle_id, no days).
        XCTAssertTrue(SafetySettingExplainerRequest().body.isEmpty)
        XCTAssertNil(SafetySettingExplainerRequest().body["vehicle_id"])
        XCTAssertNil(SafetySettingExplainerRequest().body["days"])
    }

    func testEncodedBodyIsEmptyJSONObject() throws {
        let data = try SafetySettingExplainerRequest().encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class SafetySettingExplainerSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"explain\"}"),
            .toolCall(id: "c1", name: "explain")
        )
    }

    func testParsesToolResult() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"explain\",\"ok\":true}"
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse(frame),
            .toolResult(id: "c1", name: "explain", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            SafetySettingExplainerSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(SafetySettingExplainerSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(SafetySettingExplainerSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(SafetySettingExplainerSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(SafetySettingExplainerSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class SafetySettingExplainerStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = SafetySettingExplainerStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = SafetySettingExplainerStreamReducer.start()
        snapshot = SafetySettingExplainerStreamReducer.reduce(snapshot, .delta(text: "Quiet "))
        snapshot = SafetySettingExplainerStreamReducer.reduce(snapshot, .delta(text: "hours off."))
        XCTAssertEqual(snapshot.text, "Quiet hours off.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = SafetySettingExplainerStreamReducer.reduce(
            SafetySettingExplainerStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = SafetySettingExplainerStreamReducer.reduce(
            SafetySettingExplainerStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = SafetySettingExplainerStreamReducer.reduce(
            SafetySettingExplainerStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = SafetySettingExplainerStreamReducer.start()
        XCTAssertEqual(SafetySettingExplainerStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            SafetySettingExplainerStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = SafetySettingExplainerStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = SafetySettingExplainerStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class SafetySettingExplainerOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(SafetySettingExplainerOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(SafetySettingExplainerStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testProseWhenPausedWithText() {
        // paused-confirm is `hasAnything` only via accumulated text → the prose branch.
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(
                SafetySettingExplainerStreamSnapshot(state: .pausedConfirm, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(SafetySettingExplainerStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(
                SafetySettingExplainerStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(SafetySettingExplainerStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(SafetySettingExplainerStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(
                SafetySettingExplainerStreamSnapshot(state: .error, text: "", error: "stream_http_500")
            ),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            SafetySettingExplainerOutput.derive(
                SafetySettingExplainerStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button + `canStart`/`isBusy`)

final class SafetySettingExplainerActionDeriveTests: XCTestCase {
    func testIdleIsEnabledAndNotBusy() {
        let action = SafetySettingExplainerAction.derive(state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertTrue(action.canStart)
        XCTAssertFalse(action.isDisabled)
        XCTAssertFalse(action.isBusy)
    }

    func testStreamingIsDisabledStreamingAndBusy() {
        let action = SafetySettingExplainerAction.derive(state: .streaming)
        XCTAssertTrue(action.isStreaming)
        // canStart stays true (web `state !== 'paused-confirm'`); disabled comes from isStreaming.
        XCTAssertTrue(action.canStart)
        XCTAssertTrue(action.isDisabled)
        XCTAssertTrue(action.isBusy)
    }

    func testPausedConfirmCannotStartAndIsBusy() {
        let action = SafetySettingExplainerAction.derive(state: .pausedConfirm)
        XCTAssertFalse(action.isStreaming)
        // Web `canStart={stream.state !== 'paused-confirm'}` → false here.
        XCTAssertFalse(action.canStart)
        XCTAssertTrue(action.isDisabled)
        XCTAssertTrue(action.isBusy)
    }

    func testDoneAndErrorAreEnabledAndNotBusy() {
        for state in [SafetySettingExplainerStreamState.done, .error] {
            let action = SafetySettingExplainerAction.derive(state: state)
            XCTAssertFalse(action.isStreaming, "\(state)")
            XCTAssertTrue(action.canStart, "\(state)")
            XCTAssertFalse(action.isDisabled, "\(state)")
            XCTAssertFalse(action.isBusy, "\(state)")
        }
    }

    func testCanStartHelperMatchesRule() {
        XCTAssertTrue(SafetySettingExplainerAction.canStart(.idle))
        XCTAssertTrue(SafetySettingExplainerAction.canStart(.streaming))
        XCTAssertTrue(SafetySettingExplainerAction.canStart(.done))
        XCTAssertTrue(SafetySettingExplainerAction.canStart(.error))
        XCTAssertFalse(SafetySettingExplainerAction.canStart(.pausedConfirm))
    }

    func testIsBusyHelperMatchesRule() {
        XCTAssertFalse(SafetySettingExplainerAction.isBusy(.idle))
        XCTAssertTrue(SafetySettingExplainerAction.isBusy(.streaming))
        XCTAssertTrue(SafetySettingExplainerAction.isBusy(.pausedConfirm))
        XCTAssertFalse(SafetySettingExplainerAction.isBusy(.done))
        XCTAssertFalse(SafetySettingExplainerAction.isBusy(.error))
    }
}
