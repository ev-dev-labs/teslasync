//
//  AIAutoTripNameSuggestion.Tests.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  Adapter + projection coverage for the AIAutoTripNameSuggestion surface:
//    • SSE parser — the verbatim port of the web `parseSSEFrame` + `toTypedEvent` (every event
//      type, the `typeof` field guards, unknown/malformed frames, the `event:`/`data:` spacing
//      variants, comment lines, and the irrelevant-wrong-typed-field tolerance).
//    • Reducer — the web `handleEvent` switch + the start / close / cancel / error transitions.
//    • Endpoint — the `useMemo` draft-URL builder (encoding + the `0` fallback).
//    • Projection — the render branches plus the P4 leaf contract across gated-off / loading /
//      idle / thinking / suggestion / error, including precedence + the `canStart` axis.
//    • Accessibility — the composed VoiceOver button / output labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

private func frame(_ event: String, _ json: String) -> String {
    "event: \(event)\ndata: \(json)"
}

// MARK: - Stream lifecycle (web `AiStreamState` tokens)

final class AiStreamLifecycleTests: XCTestCase {
    func testRawValuesMatchWebTokens() {
        XCTAssertEqual(AiStreamLifecycle.idle.rawValue, "idle")
        XCTAssertEqual(AiStreamLifecycle.streaming.rawValue, "streaming")
        XCTAssertEqual(AiStreamLifecycle.done.rawValue, "done")
        XCTAssertEqual(AiStreamLifecycle.error.rawValue, "error")
    }

    func testHasOutputGate() {
        XCTAssertFalse(AiStreamSnapshot.idle.hasOutput)
        XCTAssertTrue(AiStreamSnapshot.started.hasOutput)
        XCTAssertTrue(AiStreamSnapshot(lifecycle: .done, text: "x").hasOutput)
        XCTAssertTrue(AiStreamSnapshot(lifecycle: .error, error: "e").hasOutput)
    }
}

// MARK: - SSE parser (web `parseSSEFrame` + `toTypedEvent`)

final class AiSseFrameParserTests: XCTestCase {
    func testDeltaFrame() {
        XCTAssertEqual(
            AiSseFrameParser.parse(frame("delta", "{\"text\":\"Coast Run\"}")),
            .delta(text: "Coast Run")
        )
    }

    func testDeltaIgnoresIrrelevantWrongTypedField() {
        // Web parity: a delta only validates `text`; an irrelevant wrong-typed `id` must NOT
        // invalidate the frame (the all-fields decode trap this surface deliberately avoids).
        XCTAssertEqual(
            AiSseFrameParser.parse(frame("delta", "{\"text\":\"hi\",\"id\":123}")),
            .delta(text: "hi")
        )
    }

    func testDeltaWrongTypedTextIsRejected() {
        XCTAssertNil(AiSseFrameParser.parse(frame("delta", "{\"text\":123}")))
    }

    func testToolCallFrame() {
        XCTAssertEqual(
            AiSseFrameParser.parse(frame("tool_call", "{\"id\":\"t1\",\"name\":\"geo\"}")),
            .toolCall(id: "t1", name: "geo")
        )
    }

    func testToolResultRequiresBooleanOk() {
        XCTAssertEqual(
            AiSseFrameParser.parse(frame("tool_result", "{\"id\":\"t1\",\"name\":\"geo\",\"ok\":true}")),
            .toolResult(id: "t1", name: "geo", ok: true, error: nil)
        )
        // `ok: 1` is a number, not a boolean → rejected exactly as the web `typeof` guard rejects it.
        XCTAssertNil(
            AiSseFrameParser.parse(frame("tool_result", "{\"id\":\"t1\",\"name\":\"geo\",\"ok\":1}"))
        )
    }

    func testConfirmRequestFrame() {
        let raw = frame("confirm_request", "{\"continuation_id\":\"c1\",\"tool\":\"save\",\"summary\":\"Apply?\"}")
        XCTAssertEqual(
            AiSseFrameParser.parse(raw),
            .confirmRequest(continuationID: "c1", tool: "save", summary: "Apply?")
        )
    }

    func testDoneFrameDefaults() {
        XCTAssertEqual(
            AiSseFrameParser.parse(frame("done", "{}")),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
        XCTAssertEqual(
            AiSseFrameParser.parse(frame("done", "{\"finish_reason\":\"length\",\"usage\":{\"in\":3,\"out\":7}}")),
            .done(finishReason: "length", usageIn: 3, usageOut: 7)
        )
    }

    func testErrorFrameCarriesLimitFields() {
        let raw = frame(
            "error",
            "{\"message\":\"rate limited\",\"reason\":\"rate_limit\",\"retry_after_s\":30," +
                "\"banner_level\":\"warn\",\"baseline_available\":true}"
        )
        XCTAssertEqual(
            AiSseFrameParser.parse(raw),
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
            AiSseFrameParser.parse(frame("error", "{}")),
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
        XCTAssertNil(AiSseFrameParser.parse(frame("future_event", "{\"x\":1}")))
    }

    func testMalformedJsonIsDropped() {
        XCTAssertNil(AiSseFrameParser.parse(frame("delta", "{not json")))
    }

    func testMissingEventIsDropped() {
        XCTAssertNil(AiSseFrameParser.parse("data: {\"text\":\"hi\"}"))
    }

    func testNoSpaceAndCommentVariants() {
        // `event:`/`data:` without the space, plus a leading `:` comment line, all parse per spec.
        let raw = ":heartbeat\nevent:delta\ndata:{\"text\":\"x\"}"
        XCTAssertEqual(AiSseFrameParser.parse(raw), .delta(text: "x"))
    }

    func testEmptyDataIsDropped() {
        XCTAssertNil(AiSseFrameParser.parse("event: done"))
    }
}

// MARK: - Reducer (web `handleEvent` + lifecycle transitions)

final class AiStreamReducerTests: XCTestCase {
    func testStartedResetsToStreaming() {
        let started = AiStreamReducer.started()
        XCTAssertEqual(started.lifecycle, .streaming)
        XCTAssertTrue(started.text.isEmpty)
        XCTAssertNil(started.error)
        XCTAssertNil(started.limit)
    }

    func testDeltaAccumulatesText() {
        var snapshot = AiStreamSnapshot.started
        snapshot = AiStreamReducer.reduce(snapshot, .delta(text: "Coast "))
        snapshot = AiStreamReducer.reduce(snapshot, .delta(text: "Run"))
        XCTAssertEqual(snapshot.text, "Coast Run")
        XCTAssertEqual(snapshot.lifecycle, .streaming)
    }

    func testToolFramesAreInert() {
        let snapshot = AiStreamReducer.reduce(.started, .toolCall(id: "t", name: "geo"))
        XCTAssertEqual(snapshot, .started)
    }

    func testConfirmRequestPauses() {
        let snapshot = AiStreamReducer.reduce(.started, .confirmRequest(
            continuationID: "c", tool: "save", summary: "?"
        ))
        XCTAssertEqual(snapshot.lifecycle, .pausedConfirm)
    }

    func testDoneTerminates() {
        let snapshot = AiStreamReducer.reduce(.started, .done(finishReason: "stop", usageIn: 0, usageOut: 0))
        XCTAssertEqual(snapshot.lifecycle, .done)
    }

    func testErrorWithReasonCapturesLimit() {
        let snapshot = AiStreamReducer.reduce(.started, .error(
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
        let snapshot = AiStreamReducer.reduce(.started, .error(
            message: "boom", reason: nil, retryAfterS: nil, bannerLevel: nil, baselineAvailable: nil
        ))
        XCTAssertEqual(snapshot.lifecycle, .error)
        XCTAssertEqual(snapshot.error, "boom")
        XCTAssertNil(snapshot.limit)
    }

    func testClosedPromotesStreamingPhaseDone() {
        XCTAssertEqual(AiStreamReducer.closed(.started).lifecycle, .done)
        // A terminal/paused state is left untouched.
        let paused = AiStreamSnapshot(lifecycle: .pausedConfirm)
        XCTAssertEqual(AiStreamReducer.closed(paused).lifecycle, .pausedConfirm)
    }

    func testCancelledReturnsStreamingToIdle() {
        XCTAssertEqual(AiStreamReducer.cancelled(.started).lifecycle, .idle)
        let done = AiStreamSnapshot(lifecycle: .done, text: "x")
        XCTAssertEqual(AiStreamReducer.cancelled(done).lifecycle, .done)
    }

    func testFailedSetsErrorAndMessage() {
        let snapshot = AiStreamReducer.failed(.started, message: "stream_http_404")
        XCTAssertEqual(snapshot.lifecycle, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }

    func testParserAndReducerComposeOverAFullStream() {
        var snapshot = AiStreamReducer.started()
        for raw in [
            frame("delta", "{\"text\":\"Coast \"}"),
            frame("delta", "{\"text\":\"Run\"}"),
            frame("done", "{\"finish_reason\":\"stop\"}")
        ] {
            guard let event = AiSseFrameParser.parse(raw) else { return XCTFail("frame should parse") }
            snapshot = AiStreamReducer.reduce(snapshot, event)
        }
        XCTAssertEqual(snapshot.text, "Coast Run")
        XCTAssertEqual(snapshot.lifecycle, .done)
    }
}

// MARK: - Endpoint (web `useMemo` draft URL)

final class AITripNameEndpointTests: XCTestCase {
    func testDraftPathWithTrip() {
        XCTAssertEqual(AITripNameEndpoint.draftPath(tripID: "42"), "/ai/trips/42/name/draft")
    }

    func testDraftPathFallsBackToZeroSentinel() {
        XCTAssertEqual(AITripNameEndpoint.draftPath(tripID: nil), "/ai/trips/0/name/draft")
        XCTAssertEqual(AITripNameEndpoint.draftPath(tripID: ""), "/ai/trips/0/name/draft")
    }

    func testDraftPathEncodesTripID() {
        XCTAssertEqual(
            AITripNameEndpoint.draftPath(tripID: "a b/c"),
            "/ai/trips/a%20b%2Fc/name/draft"
        )
    }

    func testFeatureIDAndSlug() {
        XCTAssertEqual(AITripNameEndpoint.featureID, "auto-trip-naming")
        XCTAssertEqual(AITripNameEndpoint.surfaceSlug, "AIAutoTripNameSuggestion")
    }
}

// MARK: - Input (web `canStart = !!tripId`)

final class AITripNameInputTests: XCTestCase {
    func testCanStartRequiresEnabledTripAndConnectivity() {
        XCTAssertTrue(AITripNameInput(tripID: "42").canStart)
        XCTAssertFalse(AITripNameInput(featureEnabled: false, tripID: "42").canStart)
        XCTAssertFalse(AITripNameInput(tripID: nil).canStart)
        XCTAssertFalse(AITripNameInput(tripID: "").canStart)
        XCTAssertFalse(AITripNameInput(tripID: "42", connection: .offline).canStart)
    }

    func testHasTrip() {
        XCTAssertTrue(AITripNameInput(tripID: "42").hasTrip)
        XCTAssertFalse(AITripNameInput(tripID: nil).hasTrip)
        XCTAssertFalse(AITripNameInput(tripID: "").hasTrip)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AITripNameProjectionTests: XCTestCase {
    func testGatedOffWhenFeatureDisabled() {
        let resolved = AITripNameProjection.resolve(
            AITripNameInput(featureEnabled: false, tripID: "42"), .idle
        )
        XCTAssertEqual(resolved.phase, .gatedOff)
    }

    func testLoadingWhenContextLoadingAndStreamIdle() {
        let resolved = AITripNameProjection.resolve(
            AITripNameInput(tripID: "42", isLoading: true), .idle
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testIdleWhenResolvedAndNoStream() {
        let resolved = AITripNameProjection.resolve(AITripNameInput(tripID: "42"), .idle)
        XCTAssertEqual(resolved.phase, .idle)
        XCTAssertTrue(resolved.canStart)
    }

    func testThinkingWhenStreamingWithoutText() {
        let resolved = AITripNameProjection.resolve(
            AITripNameInput(tripID: "42"), AiStreamSnapshot(lifecycle: .streaming)
        )
        XCTAssertEqual(resolved.phase, .thinking)
        XCTAssertTrue(resolved.isStreaming)
    }

    func testSuggestionWhenTextPresent() {
        let resolved = AITripNameProjection.resolve(
            AITripNameInput(tripID: "42"), AiStreamSnapshot(lifecycle: .done, text: "Coast Run")
        )
        XCTAssertEqual(resolved.phase, .suggestion("Coast Run"))
    }

    func testErrorTakesPrecedenceOverText() {
        let resolved = AITripNameProjection.resolve(
            AITripNameInput(tripID: "42"),
            AiStreamSnapshot(lifecycle: .error, text: "partial", error: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testOfflineDisablesCanStartButKeepsSuggestion() {
        let resolved = AITripNameProjection.resolve(
            AITripNameInput(tripID: "42", connection: .offline),
            AiStreamSnapshot(lifecycle: .done, text: "Coast Run")
        )
        XCTAssertEqual(resolved.phase, .suggestion("Coast Run"))
        XCTAssertFalse(resolved.canStart)
        XCTAssertTrue(resolved.hasTrip)
    }
}

// MARK: - Accessibility summaries

final class AITripNameAccessibilityTests: XCTestCase {
    func testActionLabelJoinsHelixAndVerb() {
        XCTAssertEqual(
            AITripNameAccessibility.actionLabel(askHelix: "Ask Helix", buttonLabel: "Suggest a name"),
            "Ask Helix · Suggest a name"
        )
    }

    func testSuggestionLabelReadsRoleThenText() {
        XCTAssertEqual(
            AITripNameAccessibility.suggestionLabel(role: "Suggested name", text: "Coast Run"),
            "Suggested name: Coast Run"
        )
    }

    func testErrorLabelReadsPrefixThenMessage() {
        XCTAssertEqual(
            AITripNameAccessibility.errorLabel(prefix: "Helix error:", message: "boom"),
            "Helix error: boom"
        )
    }
}
