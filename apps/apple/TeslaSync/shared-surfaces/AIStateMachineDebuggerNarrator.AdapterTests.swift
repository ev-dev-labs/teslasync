//
//  AIStateMachineDebuggerNarrator.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0050 · AIStateMachineDebuggerNarrator (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request URL (the STATIC
//  `/ai/system/fsm/narrate` route), the `(vehicle_id, from_unix, to_unix)` scope gate
//  (`vehicleID > 0 && fromUnix > 0 && toUnix > fromUnix`, the `{vehicle_id, from_unix, to_unix}` body
//  when valid, the `{0,0,0}` sentinel when not), the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class FSMNarratorRequestTests: XCTestCase {
    func testPathIsStaticNarrateRoute() {
        // Web `url: '/ai/system/fsm/narrate'` — a static constant, scope-independent by construction.
        XCTAssertEqual(FSMNarratorRequest.path, "/ai/system/fsm/narrate")
    }

    func testHaveScopeRequiresVehicleAndPositiveOrderedWindow() {
        // Web `haveScope = vehicleId > 0 && fromUnix > 0 && toUnix > fromUnix`.
        XCTAssertTrue(FSMNarratorRequest(vehicleID: 7, fromUnix: 1000, toUnix: 2000).haveScope)
        XCTAssertTrue(FSMNarratorRequest(vehicleID: 1, fromUnix: 1, toUnix: 2).haveScope)
    }

    func testHaveScopeFalseWhenAnyBoundMissing() {
        XCTAssertFalse(FSMNarratorRequest(vehicleID: nil, fromUnix: 1000, toUnix: 2000).haveScope)
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 7, fromUnix: nil, toUnix: 2000).haveScope)
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 7, fromUnix: 1000, toUnix: nil).haveScope)
        XCTAssertFalse(FSMNarratorRequest(vehicleID: nil, fromUnix: nil, toUnix: nil).haveScope)
    }

    func testHaveScopeFalseWhenVehicleNonPositive() {
        // Web `vehicleId > 0` is false for 0 / negatives.
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 0, fromUnix: 1000, toUnix: 2000).haveScope)
        XCTAssertFalse(FSMNarratorRequest(vehicleID: -5, fromUnix: 1000, toUnix: 2000).haveScope)
    }

    func testHaveScopeFalseWhenFromNonPositive() {
        // Web `fromUnix > 0` is false for 0 / negatives.
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 7, fromUnix: 0, toUnix: 2000).haveScope)
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 7, fromUnix: -5, toUnix: 2000).haveScope)
    }

    func testHaveScopeFalseWhenToNotAfterFrom() {
        // Web `toUnix > fromUnix` is false for an inverted or zero-width window.
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 7, fromUnix: 2000, toUnix: 1000).haveScope)
        XCTAssertFalse(FSMNarratorRequest(vehicleID: 7, fromUnix: 1000, toUnix: 1000).haveScope)
    }

    func testBodyCarriesScopeWhenValid() {
        // Web `useMemo(() => ({ vehicle_id, from_unix, to_unix }), …)` for a valid scope.
        let body = FSMNarratorRequest(vehicleID: 7, fromUnix: 1000, toUnix: 2000).body
        XCTAssertEqual(body["vehicle_id"], 7)
        XCTAssertEqual(body["from_unix"], 1000)
        XCTAssertEqual(body["to_unix"], 2000)
        XCTAssertEqual(body.count, 3)
    }

    func testBodyIsZeroSentinelWhenInvalid() {
        // Web `!haveScope → { vehicle_id: 0, from_unix: 0, to_unix: 0 }` — even a vehicle is dropped.
        for request in [
            FSMNarratorRequest(vehicleID: nil, fromUnix: nil, toUnix: nil),
            FSMNarratorRequest(vehicleID: 0, fromUnix: 1000, toUnix: 2000),
            FSMNarratorRequest(vehicleID: 7, fromUnix: 0, toUnix: 2000),
            FSMNarratorRequest(vehicleID: 7, fromUnix: 2000, toUnix: 1000)
        ] {
            XCTAssertEqual(request.body, ["vehicle_id": 0, "from_unix": 0, "to_unix": 0])
        }
    }

    func testEncodedBodySortsKeysForValidScope() throws {
        let data = try FSMNarratorRequest(vehicleID: 7, fromUnix: 1000, toUnix: 2000).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"from_unix\":1000,\"to_unix\":2000,\"vehicle_id\":7}")
    }

    func testEncodedBodyForInvalidScopeIsZeroSentinel() throws {
        let data = try FSMNarratorRequest(vehicleID: nil, fromUnix: nil, toUnix: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"from_unix\":0,\"to_unix\":0,\"vehicle_id\":0}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class FSMNarratorSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(FSMNarratorSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(FSMNarratorSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"narrate\"}"),
            .toolCall(id: "c1", name: "narrate")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            FSMNarratorSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"narrate\",\"ok\":true}"),
            .toolResult(id: "c1", name: "narrate", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"export\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "export", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            FSMNarratorSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(FSMNarratorSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(FSMNarratorSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(FSMNarratorSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(FSMNarratorSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class FSMNarratorStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = FSMNarratorStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = FSMNarratorStreamReducer.start()
        snapshot = FSMNarratorStreamReducer.reduce(snapshot, .delta(text: "Eighteen "))
        snapshot = FSMNarratorStreamReducer.reduce(snapshot, .delta(text: "transitions."))
        XCTAssertEqual(snapshot.text, "Eighteen transitions.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = FSMNarratorStreamReducer.reduce(
            FSMNarratorStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = FSMNarratorStreamReducer.reduce(
            FSMNarratorStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = FSMNarratorStreamReducer.reduce(
            FSMNarratorStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = FSMNarratorStreamReducer.start()
        XCTAssertEqual(FSMNarratorStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(FSMNarratorStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = FSMNarratorStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = FSMNarratorStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class FSMNarratorOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(FSMNarratorOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            FSMNarratorOutput.derive(FSMNarratorStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class FSMNarratorActionDeriveTests: XCTestCase {
    func testIdleWithScopeIsEnabled() {
        let action = FSMNarratorAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = FSMNarratorAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoScopeIsDisabled() {
        XCTAssertTrue(FSMNarratorAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(FSMNarratorAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
