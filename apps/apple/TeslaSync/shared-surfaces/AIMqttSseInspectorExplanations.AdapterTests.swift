//
//  AIMqttSseInspectorExplanations.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0028 · AIMqttSseInspectorExplanations (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL (the STATIC
//  `/ai/system/streams/explain` route — unlike 0022's id-in-path summarizer), the
//  `(from_unix, to_unix)` window gate (`fromUnix > 0 && toUnix > fromUnix`, the `{from_unix,
//  to_unix}` body when valid, the `{0,0}` sentinel when not), the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` +
//  `finalizeError` + the `stream_http_{status}` HTTP failure), and the output / action derivations
//  (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class MqttSseExplainRequestTests: XCTestCase {
    func testPathIsStaticExplainRoute() {
        // Web `url: '/ai/system/streams/explain'` — a static constant, window-independent by construction.
        XCTAssertEqual(MqttSseExplainRequest.path, "/ai/system/streams/explain")
    }

    func testHaveWindowRequiresPositiveOrderedBounds() {
        // Web `haveWindow = fromUnix > 0 && toUnix > fromUnix`.
        XCTAssertTrue(MqttSseExplainRequest(fromUnix: 1000, toUnix: 2000).haveWindow)
        XCTAssertTrue(MqttSseExplainRequest(fromUnix: 1, toUnix: 2).haveWindow)
    }

    func testHaveWindowFalseWhenBoundsMissing() {
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: nil, toUnix: 2000).haveWindow)
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: 1000, toUnix: nil).haveWindow)
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: nil, toUnix: nil).haveWindow)
    }

    func testHaveWindowFalseWhenFromNonPositive() {
        // Web `fromUnix > 0` is false for 0 / negatives.
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: 0, toUnix: 2000).haveWindow)
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: -5, toUnix: 2000).haveWindow)
    }

    func testHaveWindowFalseWhenToNotAfterFrom() {
        // Web `toUnix > fromUnix` is false for an inverted or zero-width window.
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: 2000, toUnix: 1000).haveWindow)
        XCTAssertFalse(MqttSseExplainRequest(fromUnix: 1000, toUnix: 1000).haveWindow)
    }

    func testBodyCarriesWindowWhenValid() {
        // Web `useMemo(() => ({ from_unix, to_unix }), …)` for a valid window.
        let body = MqttSseExplainRequest(fromUnix: 1000, toUnix: 2000).body
        XCTAssertEqual(body["from_unix"], 1000)
        XCTAssertEqual(body["to_unix"], 2000)
    }

    func testBodyIsZeroSentinelWhenInvalid() {
        // Web `!haveWindow → { from_unix: 0, to_unix: 0 }`.
        for request in [
            MqttSseExplainRequest(fromUnix: nil, toUnix: nil),
            MqttSseExplainRequest(fromUnix: 0, toUnix: 2000),
            MqttSseExplainRequest(fromUnix: 2000, toUnix: 1000)
        ] {
            XCTAssertEqual(request.body["from_unix"], 0)
            XCTAssertEqual(request.body["to_unix"], 0)
        }
    }

    func testEncodedBodySortsKeysForValidWindow() throws {
        let data = try MqttSseExplainRequest(fromUnix: 1000, toUnix: 2000).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"from_unix\":1000,\"to_unix\":2000}")
    }

    func testEncodedBodyForMissingWindowIsZeroSentinel() throws {
        let data = try MqttSseExplainRequest(fromUnix: nil, toUnix: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"from_unix\":0,\"to_unix\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class MqttSseExplainerSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(MqttSseExplainerSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(MqttSseExplainerSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"explain\"}"),
            .toolCall(id: "c1", name: "explain")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"explain\",\"ok\":true}"),
            .toolResult(id: "c1", name: "explain", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            MqttSseExplainerSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(MqttSseExplainerSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(MqttSseExplainerSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(MqttSseExplainerSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(MqttSseExplainerSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class MqttSseExplainerStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = MqttSseExplainerStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = MqttSseExplainerStreamReducer.start()
        snapshot = MqttSseExplainerStreamReducer.reduce(snapshot, .delta(text: "The broker "))
        snapshot = MqttSseExplainerStreamReducer.reduce(snapshot, .delta(text: "is connected."))
        XCTAssertEqual(snapshot.text, "The broker is connected.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = MqttSseExplainerStreamReducer.reduce(
            MqttSseExplainerStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = MqttSseExplainerStreamReducer.reduce(
            MqttSseExplainerStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = MqttSseExplainerStreamReducer.reduce(
            MqttSseExplainerStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = MqttSseExplainerStreamReducer.start()
        XCTAssertEqual(MqttSseExplainerStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(MqttSseExplainerStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = MqttSseExplainerStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = MqttSseExplainerStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class MqttSseExplainerOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(MqttSseExplainerOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            MqttSseExplainerOutput.derive(MqttSseExplainerStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class MqttSseExplainerActionDeriveTests: XCTestCase {
    func testIdleWithWindowIsEnabled() {
        let action = MqttSseExplainerAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = MqttSseExplainerAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoWindowIsDisabled() {
        XCTAssertTrue(MqttSseExplainerAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(MqttSseExplainerAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
