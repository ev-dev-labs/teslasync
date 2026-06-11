//
//  AIVehiclePaintPreview.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0058 · AIVehiclePaintPreview (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the dynamic request URL
//  (`/ai/vehicles/{id}/paint-preview/draft` when a positive vehicle is in scope, the `/0/` sentinel
//  otherwise), the `numericVehicleId > 0` input gate, the optional `{ style_hint }` body (trimmed +
//  dropped when blank, empty `{}` when absent), the SSE frame parsing (port of `parseSSEFrame` +
//  `toTypedEvent`), the delta-accumulating stream reducer (port of `handleEvent` + `finalizeError` +
//  the `stream_http_{status}` HTTP failure), and the output / action derivations (port of the
//  `AiOutputPanel` branches + the `AIFeatureCard` button contract).
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class PaintPreviewRequestTests: XCTestCase {
    func testNumericVehicleIDCoercesNilToZero() {
        // Web `numericVehicleId = Number.isFinite(vehicleId) ? vehicleId : 0`.
        XCTAssertEqual(PaintPreviewRequest(vehicleID: nil).numericVehicleID, 0)
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 7).numericVehicleID, 7)
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 0).numericVehicleID, 0)
    }

    func testHaveInputsRequiresPositiveVehicle() {
        // Web `haveInputs = numericVehicleId > 0`.
        XCTAssertTrue(PaintPreviewRequest(vehicleID: 7).haveInputs)
        XCTAssertTrue(PaintPreviewRequest(vehicleID: 1).haveInputs)
        XCTAssertFalse(PaintPreviewRequest(vehicleID: nil).haveInputs)
        XCTAssertFalse(PaintPreviewRequest(vehicleID: 0).haveInputs)
        XCTAssertFalse(PaintPreviewRequest(vehicleID: -3).haveInputs)
    }

    func testHaveInputsIgnoresStyleHint() {
        // The style hint never gates the button — only the vehicle id does.
        XCTAssertTrue(PaintPreviewRequest(vehicleID: 7, styleHint: nil).haveInputs)
        XCTAssertFalse(PaintPreviewRequest(vehicleID: nil, styleHint: "studio").haveInputs)
    }

    func testPathEmbedsVehicleWhenPositive() {
        // Web `numericVehicleId > 0 ? '/ai/vehicles/${id}/paint-preview/draft' : …`.
        XCTAssertEqual(
            PaintPreviewRequest(vehicleID: 7).path,
            "/ai/vehicles/7/paint-preview/draft"
        )
        XCTAssertEqual(
            PaintPreviewRequest(vehicleID: 142).path,
            "/ai/vehicles/142/paint-preview/draft"
        )
    }

    func testPathIsZeroSentinelWhenNoVehicle() {
        // Web `: '/ai/vehicles/0/paint-preview/draft'` — the disabled button never POSTs it.
        XCTAssertEqual(PaintPreviewRequest(vehicleID: nil).path, "/ai/vehicles/0/paint-preview/draft")
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 0).path, "/ai/vehicles/0/paint-preview/draft")
        XCTAssertEqual(PaintPreviewRequest(vehicleID: -5).path, "/ai/vehicles/0/paint-preview/draft")
    }

    func testTrimmedStyleHintDropsBlankAndTrims() {
        // Web `styleHint.trim() !== '' ? styleHint.trim() : undefined`.
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 7, styleHint: "  studio  ").trimmedStyleHint, "studio")
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 7, styleHint: "outdoor").trimmedStyleHint, "outdoor")
        XCTAssertNil(PaintPreviewRequest(vehicleID: 7, styleHint: nil).trimmedStyleHint)
        XCTAssertNil(PaintPreviewRequest(vehicleID: 7, styleHint: "").trimmedStyleHint)
        XCTAssertNil(PaintPreviewRequest(vehicleID: 7, styleHint: "   ").trimmedStyleHint)
        XCTAssertNil(PaintPreviewRequest(vehicleID: 7, styleHint: "\n\t").trimmedStyleHint)
    }

    func testBodyEmptyWhenNoStyleHint() {
        // Web `const payload = {}` when no usable style hint — the vehicleID is in the URL, not body.
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 7, styleHint: nil).body, [:])
        XCTAssertEqual(PaintPreviewRequest(vehicleID: 7, styleHint: "   ").body, [:])
        // Even with no vehicle, an absent hint yields the empty body.
        XCTAssertEqual(PaintPreviewRequest(vehicleID: nil, styleHint: nil).body, [:])
    }

    func testBodyCarriesTrimmedStyleHintWhenPresent() {
        // Web `payload.style_hint = styleHint.trim()`.
        XCTAssertEqual(
            PaintPreviewRequest(vehicleID: 7, styleHint: "  sunset  ").body,
            ["style_hint": "sunset"]
        )
        XCTAssertEqual(
            PaintPreviewRequest(vehicleID: nil, styleHint: "studio").body,
            ["style_hint": "studio"]
        )
    }

    func testEncodedBodyIsEmptyObjectWhenNoHint() throws {
        let data = try PaintPreviewRequest(vehicleID: 7, styleHint: nil).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{}")
    }

    func testEncodedBodyCarriesStyleHint() throws {
        let data = try PaintPreviewRequest(vehicleID: 7, styleHint: "studio").encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"style_hint\":\"studio\"}")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class PaintPreviewSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"),
            .delta(text: "hi")
        )
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(PaintPreviewSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(PaintPreviewSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"render\"}"),
            .toolCall(id: "c1", name: "render")
        )
    }

    func testParsesToolResult() {
        XCTAssertEqual(
            PaintPreviewSSEFrame
                .parse("event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"render\",\"ok\":true}"),
            .toolResult(id: "c1", name: "render", ok: true)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"apply\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "apply", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(
            PaintPreviewSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"),
            .delta(text: "y")
        )
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(PaintPreviewSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(PaintPreviewSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(PaintPreviewSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(PaintPreviewSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError`)

final class PaintPreviewStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmpty() {
        let snapshot = PaintPreviewStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
    }

    func testDeltaAccumulatesText() {
        var snapshot = PaintPreviewStreamReducer.start()
        snapshot = PaintPreviewStreamReducer.reduce(snapshot, .delta(text: "Midnight "))
        snapshot = PaintPreviewStreamReducer.reduce(snapshot, .delta(text: "blue."))
        XCTAssertEqual(snapshot.text, "Midnight blue.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testDoneFinalizes() {
        let snapshot = PaintPreviewStreamReducer.reduce(
            PaintPreviewStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = PaintPreviewStreamReducer.reduce(
            PaintPreviewStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = PaintPreviewStreamReducer.reduce(
            PaintPreviewStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolEventsDoNotMutateState() {
        let start = PaintPreviewStreamReducer.start()
        XCTAssertEqual(PaintPreviewStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
        XCTAssertEqual(PaintPreviewStreamReducer.reduce(start, .toolResult(id: "1", name: "n", ok: true)), start)
    }

    func testFoldReplaysSequence() {
        let snapshot = PaintPreviewStreamReducer.fold([
            .delta(text: "a"),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = PaintPreviewStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class PaintPreviewOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(PaintPreviewOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_500"
            )),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            PaintPreviewOutput.derive(PaintPreviewStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class PaintPreviewActionDeriveTests: XCTestCase {
    func testIdleWithInputsIsEnabled() {
        let action = PaintPreviewAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = PaintPreviewAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(PaintPreviewAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(PaintPreviewAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}
