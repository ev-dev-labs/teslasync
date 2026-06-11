//
//  AIFeedbackQueueTriage.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0019 · AIFeedbackQueueTriage (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`feedback_id`, snake_case, the
//  bare /ai/feedback/triage/draft path — the id lives in the BODY, not the path), the `haveFeedback`
//  gate (`feedbackId > 0`, with the nil / 0 / negative boundaries that are NOT valid selections), the
//  SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream
//  reducer (port of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and
//  the output / action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard` button
//  contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class FeedbackTriageRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(FeedbackTriageRequest.path, "/ai/feedback/triage/draft")
    }

    func testBodyUsesSnakeCaseFeedbackId() {
        XCTAssertEqual(FeedbackTriageRequest(feedbackID: 482).body["feedback_id"], 482)
    }

    func testHaveFeedbackRequiresPositiveId() {
        // Web `typeof feedbackId === 'number' && Number.isFinite(feedbackId) && feedbackId > 0`.
        XCTAssertFalse(FeedbackTriageRequest(feedbackID: nil).haveFeedback)
        XCTAssertFalse(FeedbackTriageRequest(feedbackID: 0).haveFeedback)
        XCTAssertFalse(FeedbackTriageRequest(feedbackID: -3).haveFeedback)
        XCTAssertTrue(FeedbackTriageRequest(feedbackID: 1).haveFeedback)
        XCTAssertTrue(FeedbackTriageRequest(feedbackID: 482).haveFeedback)
    }

    func testBodyShipsSentinelZeroWhenNoFeedback() {
        // Web `body = haveFeedback ? { feedback_id: feedbackId } : { feedback_id: 0 }`.
        XCTAssertEqual(FeedbackTriageRequest(feedbackID: nil).body["feedback_id"], 0)
        XCTAssertEqual(FeedbackTriageRequest(feedbackID: 0).body["feedback_id"], 0)
        XCTAssertEqual(FeedbackTriageRequest(feedbackID: -5).body["feedback_id"], 0)
    }

    func testBodyShipsSelectedIdWhenPresent() {
        XCTAssertEqual(FeedbackTriageRequest(feedbackID: 7).body["feedback_id"], 7)
    }

    func testEncodedBodyIsDeterministicJSON() throws {
        let data = try FeedbackTriageRequest(feedbackID: 482).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"feedback_id\":482}")
    }

    func testEncodedBodySentinelWhenNoFeedback() throws {
        let data = try FeedbackTriageRequest(feedbackID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"feedback_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class FeedbackTriageSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(FeedbackTriageSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(FeedbackTriageSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"triage\"}"),
            .toolCall(id: "c1", name: "triage")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"triage\",\"ok\":true}"),
            .toolResult(id: "c1", name: "triage", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            FeedbackTriageSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(FeedbackTriageSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(FeedbackTriageSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(FeedbackTriageSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(FeedbackTriageSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class FeedbackTriageStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = FeedbackTriageStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = FeedbackTriageStreamReducer.start()
        snapshot = FeedbackTriageStreamReducer.reduce(snapshot, .delta(text: "Proposed "))
        snapshot = FeedbackTriageStreamReducer.reduce(snapshot, .delta(text: "status."))
        XCTAssertEqual(snapshot.text, "Proposed status.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = FeedbackTriageStreamReducer.reduce(
            FeedbackTriageStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = FeedbackTriageStreamReducer.reduce(
            FeedbackTriageStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = FeedbackTriageStreamReducer.reduce(
            FeedbackTriageStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = FeedbackTriageStreamReducer.start()
        XCTAssertEqual(FeedbackTriageStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(FeedbackTriageStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = FeedbackTriageStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = FeedbackTriageStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class FeedbackTriageOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(FeedbackTriageOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(state: .pausedConfirm)), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            FeedbackTriageOutput.derive(FeedbackTriageStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class FeedbackTriageActionDeriveTests: XCTestCase {
    func testIdleWithFeedbackIsEnabled() {
        let action = FeedbackTriageAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = FeedbackTriageAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoFeedbackIsDisabled() {
        XCTAssertTrue(FeedbackTriageAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(FeedbackTriageAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
