//
//  AILogTraceSummarization.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0026 · AILogTraceSummarization (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the log/trace window seam (the `Number.isFinite`
//  coercion + the `haveWindow` / `windowSeconds` / `windowAcceptable` block), the request body (the
//  `/ai/system/logs/summarize` path, the zeroed non-acceptable body, the conditional `vehicle_id`,
//  snake_case), the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the
//  delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` + the
//  `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Window seam (web `haveWindow` / `windowSeconds` / `windowAcceptable`)

final class LogTraceWindowTests: XCTestCase {
    func testResolveFiniteKeepsFiniteNumber() {
        XCTAssertEqual(LogTraceWindow.resolveFinite(1_717_000_000), 1_717_000_000)
    }

    func testResolveFiniteDropsAbsent() {
        XCTAssertNil(LogTraceWindow.resolveFinite(nil))
    }

    func testResolveFiniteDropsNaNAndInfinity() {
        // Web `!Number.isFinite(x)` → nil.
        XCTAssertNil(LogTraceWindow.resolveFinite(.nan))
        XCTAssertNil(LogTraceWindow.resolveFinite(.infinity))
        XCTAssertNil(LogTraceWindow.resolveFinite(-.infinity))
    }

    func testHaveWindowRequiresBothBoundsPositiveAndOrdered() {
        // Web: isFinite(from) && from > 0 && isFinite(to) && to > from.
        XCTAssertTrue(LogTraceWindow.haveWindow(fromUnix: 100, toUnix: 200))
        XCTAssertFalse(LogTraceWindow.haveWindow(fromUnix: nil, toUnix: 200))
        XCTAssertFalse(LogTraceWindow.haveWindow(fromUnix: 100, toUnix: nil))
        XCTAssertFalse(LogTraceWindow.haveWindow(fromUnix: 0, toUnix: 200)) // from not > 0
        XCTAssertFalse(LogTraceWindow.haveWindow(fromUnix: -5, toUnix: 200))
        XCTAssertFalse(LogTraceWindow.haveWindow(fromUnix: 200, toUnix: 100)) // to not > from
        XCTAssertFalse(LogTraceWindow.haveWindow(fromUnix: 200, toUnix: 200)) // equal, not strictly >
    }

    func testWindowSecondsIsSpanWhenValidElseZero() {
        XCTAssertEqual(LogTraceWindow.windowSeconds(fromUnix: 100, toUnix: 1900), 1800)
        XCTAssertEqual(LogTraceWindow.windowSeconds(fromUnix: nil, toUnix: 1900), 0)
        XCTAssertEqual(LogTraceWindow.windowSeconds(fromUnix: 200, toUnix: 100), 0)
    }

    func testIsAcceptableEnforcesTwentyFourHourCap() {
        // Web `windowAcceptable = haveWindow && windowSeconds <= 24*60*60`.
        let day = 24 * 60 * 60
        XCTAssertTrue(LogTraceWindow.isAcceptable(fromUnix: 1000, toUnix: 1000 + 1800))
        XCTAssertTrue(LogTraceWindow.isAcceptable(fromUnix: 1000, toUnix: 1000 + day)) // exactly 24h
        XCTAssertFalse(LogTraceWindow.isAcceptable(fromUnix: 1000, toUnix: 1000 + day + 1)) // > 24h
        XCTAssertFalse(LogTraceWindow.isAcceptable(fromUnix: nil, toUnix: 1000 + 1800))
        XCTAssertFalse(LogTraceWindow.isAcceptable(fromUnix: 2000, toUnix: 1000)) // mis-ordered
    }

    func testMaxWindowSecondsIsTwentyFourHours() {
        XCTAssertEqual(LogTraceWindow.maxWindowSeconds, 86400)
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class LogTraceSummaryRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(LogTraceSummaryRequest.path, "/ai/system/logs/summarize")
    }

    func testBodyForAcceptableWindowUsesSnakeCaseBounds() {
        let request = LogTraceSummaryRequest(fromUnix: 1000, toUnix: 2800)
        XCTAssertEqual(request.body["from_unix"], 1000)
        XCTAssertEqual(request.body["to_unix"], 2800)
        XCTAssertNil(request.body["vehicle_id"]) // omitted when no vehicle
        XCTAssertEqual(request.body.count, 2)
    }

    func testBodyAppendsVehicleIdWhenPositive() {
        let request = LogTraceSummaryRequest(fromUnix: 1000, toUnix: 2800, vehicleID: 7)
        XCTAssertEqual(request.body["from_unix"], 1000)
        XCTAssertEqual(request.body["to_unix"], 2800)
        XCTAssertEqual(request.body["vehicle_id"], 7)
        XCTAssertEqual(request.body.count, 3)
    }

    func testBodyOmitsVehicleIdWhenZeroOrNegative() {
        // Web appends vehicle_id only when `Number.isFinite(vehicleId) && vehicleId > 0`.
        XCTAssertNil(LogTraceSummaryRequest(fromUnix: 1000, toUnix: 2800, vehicleID: 0).body["vehicle_id"])
        XCTAssertNil(LogTraceSummaryRequest(fromUnix: 1000, toUnix: 2800, vehicleID: -3).body["vehicle_id"])
    }

    func testBodyForNonAcceptableWindowIsZeroed() {
        // Web `if (!windowAcceptable) return { from_unix: 0, to_unix: 0 }` — even a vehicle is dropped.
        let noWindow = LogTraceSummaryRequest(fromUnix: nil, toUnix: nil, vehicleID: 7)
        XCTAssertEqual(noWindow.body, ["from_unix": 0, "to_unix": 0])

        let tooLarge = LogTraceSummaryRequest(fromUnix: 1000, toUnix: 1000 + 24 * 60 * 60 + 1, vehicleID: 7)
        XCTAssertEqual(tooLarge.body, ["from_unix": 0, "to_unix": 0])

        let misordered = LogTraceSummaryRequest(fromUnix: 2000, toUnix: 1000, vehicleID: 7)
        XCTAssertEqual(misordered.body, ["from_unix": 0, "to_unix": 0])
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try LogTraceSummaryRequest(fromUnix: 1000, toUnix: 2800, vehicleID: 7).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"from_unix\":1000,\"to_unix\":2800,\"vehicle_id\":7}")
    }

    func testEncodedBodyForNonAcceptableWindowIsZeroed() throws {
        let data = try LogTraceSummaryRequest(fromUnix: nil, toUnix: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"from_unix\":0,\"to_unix\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class LogTraceSummarySSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse(frame),
            .done(finishReason: "stop", usageIn: 10, usageOut: 20)
        )
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse("event: error\ndata: {}"),
            .failure(message: "unknown")
        )
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"summarize\"}"),
            .toolCall(id: "c1", name: "summarize")
        )
    }

    func testParsesToolResult() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"summarize\",\"ok\":true}"
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse(frame),
            .toolResult(id: "c1", name: "summarize", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"wipe\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "wipe", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            LogTraceSummarySSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(LogTraceSummarySSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(LogTraceSummarySSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(LogTraceSummarySSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(LogTraceSummarySSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class LogTraceSummaryStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = LogTraceSummaryStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = LogTraceSummaryStreamReducer.start()
        snapshot = LogTraceSummaryStreamReducer.reduce(snapshot, .delta(text: "No "))
        snapshot = LogTraceSummaryStreamReducer.reduce(snapshot, .delta(text: "errors."))
        XCTAssertEqual(snapshot.text, "No errors.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = LogTraceSummaryStreamReducer.reduce(
            LogTraceSummaryStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = LogTraceSummaryStreamReducer.reduce(
            LogTraceSummaryStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = LogTraceSummaryStreamReducer.reduce(
            LogTraceSummaryStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = LogTraceSummaryStreamReducer.start()
        XCTAssertEqual(LogTraceSummaryStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(
            LogTraceSummaryStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)),
            start
        )
    }

    func testFoldReplaysSequence() {
        let snapshot = LogTraceSummaryStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = LogTraceSummaryStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class LogTraceSummaryOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(LogTraceSummaryOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(LogTraceSummaryStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(LogTraceSummaryStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(
                LogTraceSummaryStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(LogTraceSummaryStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(LogTraceSummaryStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(
                LogTraceSummaryStreamSnapshot(state: .error, text: "", error: "stream_http_500")
            ),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            LogTraceSummaryOutput.derive(
                LogTraceSummaryStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class LogTraceSummaryActionDeriveTests: XCTestCase {
    func testAcceptableWindowIdleIsEnabled() {
        let action = LogTraceSummaryAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = LogTraceSummaryAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoWindowIsDisabled() {
        XCTAssertTrue(LogTraceSummaryAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(LogTraceSummaryAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
