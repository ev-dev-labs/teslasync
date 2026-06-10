//
//  AIIncidentTimelineSummarizer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0022 · AIIncidentTimelineSummarizer (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL
//  (`/ai/system/incidents/{incidentID}/summarize` with the numeric `> 0` gate, the
//  `/ai/system/incidents/0/summarize` fallback for nil / 0 / negative, the empty `{}` body — like
//  0017's coach the id is in the PATH and there is no body field), the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` +
//  `finalizeError` + the `stream_http_{status}` HTTP failure), and the output / action derivations
//  (port of the `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class IncidentSummarizeRequestTests: XCTestCase {
    func testFallbackPathWhenNoIncident() {
        // Web ternary `haveIncident ? … : '/ai/system/incidents/0/summarize'`.
        XCTAssertEqual(IncidentSummarizeRequest.fallbackPath, "/ai/system/incidents/0/summarize")
        XCTAssertEqual(IncidentSummarizeRequest(incidentID: nil).path, "/ai/system/incidents/0/summarize")
    }

    func testZeroIncidentFallsBackToZeroPath() {
        // Web `numericIncidentId > 0` is false for 0, so the fallback route is used.
        XCTAssertEqual(IncidentSummarizeRequest(incidentID: 0).path, "/ai/system/incidents/0/summarize")
    }

    func testNegativeIncidentFallsBackToZeroPath() {
        // Web `numericIncidentId > 0` is false for negatives → the fallback route.
        XCTAssertEqual(IncidentSummarizeRequest(incidentID: -5).path, "/ai/system/incidents/0/summarize")
    }

    func testPathEmbedsPositiveIncidentID() {
        // Web `/ai/system/incidents/${numericIncidentId}/summarize` for a positive id.
        XCTAssertEqual(IncidentSummarizeRequest(incidentID: 4821).path, "/ai/system/incidents/4821/summarize")
        XCTAssertEqual(IncidentSummarizeRequest(incidentID: 1).path, "/ai/system/incidents/1/summarize")
    }

    func testBodyIsEmptyObject() {
        // Web `useMemo(() => ({}), [])` — an empty body; the id lives in the path.
        XCTAssertTrue(IncidentSummarizeRequest(incidentID: 4821).body.isEmpty)
        XCTAssertNil(IncidentSummarizeRequest(incidentID: 4821).body["incident_id"])
    }

    func testEncodedBodyIsEmptyJSONObject() throws {
        let data = try IncidentSummarizeRequest(incidentID: 4821).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }

    func testEncodedBodyForMissingIncidentIsStillEmptyObject() throws {
        let data = try IncidentSummarizeRequest(incidentID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class IncidentSummarizerSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(IncidentSummarizerSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(IncidentSummarizerSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"summarize\"}"),
            .toolCall(id: "c1", name: "summarize")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"summarize\",\"ok\":true}"),
            .toolResult(id: "c1", name: "summarize", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            IncidentSummarizerSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(IncidentSummarizerSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(IncidentSummarizerSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(IncidentSummarizerSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(IncidentSummarizerSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class IncidentSummarizerStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = IncidentSummarizerStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = IncidentSummarizerStreamReducer.start()
        snapshot = IncidentSummarizerStreamReducer.reduce(snapshot, .delta(text: "At 09:14 "))
        snapshot = IncidentSummarizerStreamReducer.reduce(snapshot, .delta(text: "the pod paged."))
        XCTAssertEqual(snapshot.text, "At 09:14 the pod paged.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = IncidentSummarizerStreamReducer.reduce(
            IncidentSummarizerStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = IncidentSummarizerStreamReducer.reduce(
            IncidentSummarizerStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = IncidentSummarizerStreamReducer.reduce(
            IncidentSummarizerStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = IncidentSummarizerStreamReducer.start()
        XCTAssertEqual(IncidentSummarizerStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(IncidentSummarizerStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = IncidentSummarizerStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = IncidentSummarizerStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class IncidentSummarizerOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(IncidentSummarizerOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            IncidentSummarizerOutput.derive(IncidentSummarizerStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class IncidentSummarizerActionDeriveTests: XCTestCase {
    func testIdleWithIncidentIsEnabled() {
        let action = IncidentSummarizerAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = IncidentSummarizerAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoIncidentIsDisabled() {
        XCTAssertTrue(IncidentSummarizerAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(IncidentSummarizerAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
