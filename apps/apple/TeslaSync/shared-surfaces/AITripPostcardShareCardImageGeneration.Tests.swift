//
//  AITripPostcardShareCardImageGeneration.Tests.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  Stream-codec coverage for the AITripPostcardShareCardImageGeneration surface (the endpoint /
//  input / projection / accessibility tests live in the sibling `.AdapterTests.swift`):
//    • Stream lifecycle — the web `AiStreamState` tokens + the `hasOutput` visibility gate.
//    • SSE parser — the verbatim port of the web `parseSSEFrame` + `toTypedEvent` (every event type,
//      the `typeof` field guards, unknown/malformed frames, the `event:`/`data:` spacing variants,
//      comment lines, and the irrelevant-wrong-typed-field tolerance).
//    • Reducer — the web `handleEvent` switch + the start / close / cancel / error transitions.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

private func postcardFrame(_ event: String, _ json: String) -> String {
    "event: \(event)\ndata: \(json)"
}

// MARK: - Stream lifecycle (web `AiStreamState` tokens)

final class AIPostcardStreamLifecycleTests: XCTestCase {
    func testRawValuesMatchWebTokens() {
        XCTAssertEqual(AIPostcardStreamLifecycle.idle.rawValue, "idle")
        XCTAssertEqual(AIPostcardStreamLifecycle.streaming.rawValue, "streaming")
        XCTAssertEqual(AIPostcardStreamLifecycle.done.rawValue, "done")
        XCTAssertEqual(AIPostcardStreamLifecycle.error.rawValue, "error")
    }

    func testHasOutputGate() {
        XCTAssertFalse(AIPostcardStreamSnapshot.idle.hasOutput)
        XCTAssertTrue(AIPostcardStreamSnapshot.started.hasOutput)
        XCTAssertTrue(AIPostcardStreamSnapshot(lifecycle: .done, text: "x").hasOutput)
        XCTAssertTrue(AIPostcardStreamSnapshot(lifecycle: .error, error: "e").hasOutput)
    }
}

// MARK: - SSE parser (web `parseSSEFrame` + `toTypedEvent`)

final class AIPostcardSseFrameParserTests: XCTestCase {
    func testDeltaFrame() {
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(postcardFrame("delta", "{\"text\":\"Coast Run\"}")),
            .delta(text: "Coast Run")
        )
    }

    func testDeltaIgnoresIrrelevantWrongTypedField() {
        // Web parity: a delta only validates `text`; an irrelevant wrong-typed `id` must NOT
        // invalidate the frame (the all-fields decode trap this surface deliberately avoids).
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(postcardFrame("delta", "{\"text\":\"hi\",\"id\":123}")),
            .delta(text: "hi")
        )
    }

    func testDeltaWrongTypedTextIsRejected() {
        XCTAssertNil(AIPostcardSseFrameParser.parse(postcardFrame("delta", "{\"text\":123}")))
    }

    func testToolCallFrame() {
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(postcardFrame("tool_call", "{\"id\":\"t1\",\"name\":\"geo\"}")),
            .toolCall(id: "t1", name: "geo")
        )
    }

    func testToolResultRequiresBooleanOk() {
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(
                postcardFrame("tool_result", "{\"id\":\"t1\",\"name\":\"geo\",\"ok\":true}")
            ),
            .toolResult(id: "t1", name: "geo", ok: true, error: nil)
        )
        // `ok: 1` is a number, not a boolean → rejected exactly as the web `typeof` guard rejects it.
        XCTAssertNil(
            AIPostcardSseFrameParser.parse(
                postcardFrame("tool_result", "{\"id\":\"t1\",\"name\":\"geo\",\"ok\":1}")
            )
        )
    }

    func testConfirmRequestFrame() {
        let raw = postcardFrame(
            "confirm_request",
            "{\"continuation_id\":\"c1\",\"tool\":\"save\",\"summary\":\"Apply?\"}"
        )
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(raw),
            .confirmRequest(continuationID: "c1", tool: "save", summary: "Apply?")
        )
    }

    func testDoneFrameDefaults() {
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(postcardFrame("done", "{}")),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(
                postcardFrame("done", "{\"finish_reason\":\"length\",\"usage\":{\"in\":3,\"out\":7}}")
            ),
            .done(finishReason: "length", usageIn: 3, usageOut: 7)
        )
    }

    func testErrorFrameCarriesLimitFields() {
        let raw = postcardFrame(
            "error",
            "{\"message\":\"rate limited\",\"reason\":\"rate_limit\",\"retry_after_s\":30," +
                "\"banner_level\":\"warn\",\"baseline_available\":true}"
        )
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(raw),
            .error(
                message: "rate limited",
                reason: "rate_limit",
                retryAfterS: 30,
                bannerLevel: "warn",
                baselineAvailable: true
            )
        )
    }

    func testErrorFrameDefaultsMessageToUnknown() {
        XCTAssertEqual(
            AIPostcardSseFrameParser.parse(postcardFrame("error", "{}")),
            .error(
                message: "unknown",
                reason: nil,
                retryAfterS: nil,
                bannerLevel: nil,
                baselineAvailable: nil
            )
        )
    }

    func testUnknownEventTypeIsDropped() {
        XCTAssertNil(AIPostcardSseFrameParser.parse(postcardFrame("future_event", "{\"x\":1}")))
    }

    func testMalformedJsonIsDropped() {
        XCTAssertNil(AIPostcardSseFrameParser.parse(postcardFrame("delta", "{not json")))
    }

    func testMissingEventIsDropped() {
        XCTAssertNil(AIPostcardSseFrameParser.parse("data: {\"text\":\"hi\"}"))
    }

    func testNoSpaceAndCommentVariants() {
        // `event:`/`data:` without the space, plus a leading `:` comment line, all parse per spec.
        let raw = ":heartbeat\nevent:delta\ndata:{\"text\":\"x\"}"
        XCTAssertEqual(AIPostcardSseFrameParser.parse(raw), .delta(text: "x"))
    }

    func testEmptyDataIsDropped() {
        XCTAssertNil(AIPostcardSseFrameParser.parse("event: done"))
    }
}

// MARK: - Reducer (web `handleEvent` + lifecycle transitions)

final class AIPostcardStreamReducerTests: XCTestCase {
    func testStartedResetsToStreaming() {
        let started = AIPostcardStreamReducer.started()
        XCTAssertEqual(started.lifecycle, .streaming)
        XCTAssertTrue(started.text.isEmpty)
        XCTAssertNil(started.error)
        XCTAssertNil(started.limit)
    }

    func testDeltaAccumulatesText() {
        var snapshot = AIPostcardStreamSnapshot.started
        snapshot = AIPostcardStreamReducer.reduce(snapshot, .delta(text: "Coast "))
        snapshot = AIPostcardStreamReducer.reduce(snapshot, .delta(text: "Run"))
        XCTAssertEqual(snapshot.text, "Coast Run")
        XCTAssertEqual(snapshot.lifecycle, .streaming)
    }

    func testToolFramesAreInert() {
        let snapshot = AIPostcardStreamReducer.reduce(.started, .toolCall(id: "t", name: "geo"))
        XCTAssertEqual(snapshot, .started)
    }

    func testConfirmRequestPauses() {
        let snapshot = AIPostcardStreamReducer.reduce(.started, .confirmRequest(
            continuationID: "c", tool: "save", summary: "?"
        ))
        XCTAssertEqual(snapshot.lifecycle, .pausedConfirm)
    }

    func testDoneTerminates() {
        let snapshot = AIPostcardStreamReducer.reduce(
            .started, .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
        XCTAssertEqual(snapshot.lifecycle, .done)
    }

    func testErrorWithReasonCapturesLimit() {
        let snapshot = AIPostcardStreamReducer.reduce(.started, .error(
            message: "rate limited", reason: "rate_limit", retryAfterS: 30,
            bannerLevel: "warn", baselineAvailable: false
        ))
        XCTAssertEqual(snapshot.lifecycle, .error)
        XCTAssertEqual(snapshot.error, "rate limited")
        XCTAssertEqual(snapshot.limit?.reason, "rate_limit")
        XCTAssertEqual(snapshot.limit?.retryAfterS, 30)
        XCTAssertEqual(snapshot.limit?.bannerLevel, "warn")
        XCTAssertEqual(snapshot.limit?.baselineAvailable, false)
    }

    func testErrorWithoutReasonHasNoLimit() {
        let snapshot = AIPostcardStreamReducer.reduce(.started, .error(
            message: "boom", reason: nil, retryAfterS: nil, bannerLevel: nil, baselineAvailable: nil
        ))
        XCTAssertEqual(snapshot.lifecycle, .error)
        XCTAssertEqual(snapshot.error, "boom")
        XCTAssertNil(snapshot.limit)
    }

    func testClosedPromotesStreamingPhaseDone() {
        XCTAssertEqual(AIPostcardStreamReducer.closed(.started).lifecycle, .done)
        // A terminal/paused state is left untouched.
        let paused = AIPostcardStreamSnapshot(lifecycle: .pausedConfirm)
        XCTAssertEqual(AIPostcardStreamReducer.closed(paused).lifecycle, .pausedConfirm)
    }

    func testCancelledReturnsStreamingToIdle() {
        XCTAssertEqual(AIPostcardStreamReducer.cancelled(.started).lifecycle, .idle)
        let done = AIPostcardStreamSnapshot(lifecycle: .done, text: "x")
        XCTAssertEqual(AIPostcardStreamReducer.cancelled(done).lifecycle, .done)
    }

    func testFailedSetsErrorAndMessage() {
        let snapshot = AIPostcardStreamReducer.failed(.started, message: "stream_http_404")
        XCTAssertEqual(snapshot.lifecycle, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }

    func testParserAndReducerComposeOverAFullStream() {
        var snapshot = AIPostcardStreamReducer.started()
        for raw in [
            postcardFrame("delta", "{\"text\":\"Coast \"}"),
            postcardFrame("delta", "{\"text\":\"Run\"}"),
            postcardFrame("done", "{\"finish_reason\":\"stop\"}")
        ] {
            guard let event = AIPostcardSseFrameParser.parse(raw) else {
                return XCTFail("frame should parse")
            }
            snapshot = AIPostcardStreamReducer.reduce(snapshot, event)
        }
        XCTAssertEqual(snapshot.text, "Coast Run")
        XCTAssertEqual(snapshot.lifecycle, .done)
    }
}
