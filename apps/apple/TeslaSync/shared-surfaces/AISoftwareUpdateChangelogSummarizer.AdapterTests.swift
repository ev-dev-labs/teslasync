//
//  AISoftwareUpdateChangelogSummarizer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0048 · AISoftwareUpdateChangelogSummarizer (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL (fixed
//  `/ai/software-updates/summarize`) + body (`{ "vehicle_id": <id|0> }`, snake_case JSON number; the
//  id rides in the body, not the path — unlike 0022's id-in-path summarize), the numeric coercion
//  (nil → 0), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-
//  accumulating stream reducer (port of `handleEvent` + `finalizeError` + the `stream_http_{status}`
//  HTTP failure), and the output / action derivations (port of the `AiOutputPanel` branches + the
//  `AIFeatureCard` button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class SoftwareUpdateSummarizeRequestTests: XCTestCase {
    func testPathIsFixedSummarizeRoute() {
        // Web `useAiStream({ url: '/ai/software-updates/summarize', … })` — a fixed route; the id is
        // in the body, not the path.
        XCTAssertEqual(SoftwareUpdateSummarizeRequest.path, "/ai/software-updates/summarize")
        XCTAssertEqual(
            SoftwareUpdateSummarizeRequest(vehicleID: 42).path,
            "/ai/software-updates/summarize"
        )
        XCTAssertEqual(
            SoftwareUpdateSummarizeRequest(vehicleID: nil).path,
            "/ai/software-updates/summarize"
        )
    }

    func testNumericVehicleIDCoercesNilToZero() {
        // Web `numericVehicleId = (number & finite) ? id : 0`; a nil id coerces to 0.
        XCTAssertEqual(SoftwareUpdateSummarizeRequest(vehicleID: nil).numericVehicleID, 0)
        XCTAssertEqual(SoftwareUpdateSummarizeRequest(vehicleID: 42).numericVehicleID, 42)
        XCTAssertEqual(SoftwareUpdateSummarizeRequest(vehicleID: 0).numericVehicleID, 0)
    }

    func testBodyCarriesVehicleIDNumber() {
        // Web `body = { vehicle_id: numericVehicleId }` — always present, a number, snake_case.
        XCTAssertEqual(SoftwareUpdateSummarizeRequest(vehicleID: 42).body, ["vehicle_id": 42])
        XCTAssertEqual(SoftwareUpdateSummarizeRequest(vehicleID: nil).body, ["vehicle_id": 0])
    }

    func testEncodedBodyForVehicle() throws {
        let data = try SoftwareUpdateSummarizeRequest(vehicleID: 42).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":42}")
    }

    func testEncodedBodyForMissingVehicleIsZero() throws {
        // No vehicle in scope still POSTs `{ "vehicle_id": 0 }`; the handler rejects `<= 0`.
        let data = try SoftwareUpdateSummarizeRequest(vehicleID: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class SoftwareUpdateSummarizerSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame
                .parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"summarize\"}"),
            .toolCall(id: "c1", name: "summarize")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"summarize\",\"ok\":true}"),
            .toolResult(id: "c1", name: "summarize", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(SoftwareUpdateSummarizerSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(SoftwareUpdateSummarizerSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(SoftwareUpdateSummarizerSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(SoftwareUpdateSummarizerSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class SoftwareUpdateSummarizerStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = SoftwareUpdateSummarizerStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = SoftwareUpdateSummarizerStreamReducer.start()
        snapshot = SoftwareUpdateSummarizerStreamReducer.reduce(snapshot, .delta(text: "You are on "))
        snapshot = SoftwareUpdateSummarizerStreamReducer.reduce(snapshot, .delta(text: "2024.20.7."))
        XCTAssertEqual(snapshot.text, "You are on 2024.20.7.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = SoftwareUpdateSummarizerStreamReducer.reduce(
            SoftwareUpdateSummarizerStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = SoftwareUpdateSummarizerStreamReducer.reduce(
            SoftwareUpdateSummarizerStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = SoftwareUpdateSummarizerStreamReducer.reduce(
            SoftwareUpdateSummarizerStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = SoftwareUpdateSummarizerStreamReducer.start()
        XCTAssertEqual(
            SoftwareUpdateSummarizerStreamReducer.reduce(start, .toolCall(id: "1", name: "n")),
            start
        )
        XCTAssertEqual(
            SoftwareUpdateSummarizerStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = SoftwareUpdateSummarizerStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = SoftwareUpdateSummarizerStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class SoftwareUpdateSummarizerOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(SoftwareUpdateSummarizerOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(
                SoftwareUpdateSummarizerStreamSnapshot(state: .pausedConfirm)
            ),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(
                SoftwareUpdateSummarizerStreamSnapshot(state: .streaming, text: "")
            ),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(
                SoftwareUpdateSummarizerStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(
                SoftwareUpdateSummarizerStreamSnapshot(state: .done, text: "final")
            ),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(
                SoftwareUpdateSummarizerStreamSnapshot(state: .done, text: "")
            ),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(SoftwareUpdateSummarizerStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerOutput.derive(
                SoftwareUpdateSummarizerStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class SoftwareUpdateSummarizerActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = SoftwareUpdateSummarizerAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = SoftwareUpdateSummarizerAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(SoftwareUpdateSummarizerAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(
            SoftwareUpdateSummarizerAction.derive(canStart: false, state: .streaming).isDisabled
        )
    }
}
