//
//  AITripPostcardShareCardImageGeneration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  Endpoint + input + projection + accessibility coverage for the
//  AITripPostcardShareCardImageGeneration surface, split from the stream-codec tests
//  (`.Tests.swift`) for the lint length budget:
//    • Endpoint — the static draft path, the `numericTripId` rule, the `useMemo` body builder
//      (style-hint trimming, the trip-id fallback), and the JSON encoding.
//    • Input — the web `canStart = numericTripId > 0` gate plus the connectivity axis.
//    • Projection — the render branches plus the P4 leaf contract across gated-off / loading / idle /
//      thinking / draft / error, including precedence + the `canStart` axis.
//    • Accessibility — the composed VoiceOver button / output labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Endpoint (static draft URL + web `useMemo` body)

final class AIPostcardEndpointTests: XCTestCase {
    func testStaticDraftPath() {
        XCTAssertEqual(AIPostcardEndpoint.draftPath, "/ai/share-cards/trip-image/draft")
    }

    func testFeatureIDAndSlug() {
        XCTAssertEqual(AIPostcardEndpoint.featureID, "trip-postcard-share-card-image-generation")
        XCTAssertEqual(AIPostcardEndpoint.surfaceSlug, "AITripPostcardShareCardImageGeneration")
    }

    func testNumericTripIDFallsBackToZero() {
        XCTAssertEqual(AIPostcardEndpoint.numericTripID(42), 42)
        XCTAssertEqual(AIPostcardEndpoint.numericTripID(nil), 0)
    }

    func testDraftBodyOmitsEmptyStyleHint() {
        XCTAssertEqual(
            AIPostcardEndpoint.draftBody(tripID: 42, styleHint: nil),
            AIPostcardDraftBody(tripID: 42, styleHint: nil)
        )
        XCTAssertEqual(
            AIPostcardEndpoint.draftBody(tripID: 42, styleHint: "   "),
            AIPostcardDraftBody(tripID: 42, styleHint: nil)
        )
    }

    func testDraftBodyTrimsAndKeepsStyleHint() {
        XCTAssertEqual(
            AIPostcardEndpoint.draftBody(tripID: 42, styleHint: "  vintage  "),
            AIPostcardDraftBody(tripID: 42, styleHint: "vintage")
        )
    }

    func testDraftBodyUsesNumericTripIDFallback() {
        XCTAssertEqual(
            AIPostcardEndpoint.draftBody(tripID: nil, styleHint: "minimal"),
            AIPostcardDraftBody(tripID: 0, styleHint: "minimal")
        )
    }

    func testEncodedDraftBodyOmitsStyleHintWhenNil() throws {
        let data = AIPostcardEndpoint.encodedDraftBody(AIPostcardDraftBody(tripID: 42, styleHint: nil))
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(object["trip_id"] as? Int, 42)
        XCTAssertNil(object["style_hint"])
        XCTAssertEqual(object.count, 1)
    }

    func testEncodedDraftBodyIncludesStyleHintWhenPresent() throws {
        let data = AIPostcardEndpoint.encodedDraftBody(
            AIPostcardDraftBody(tripID: 7, styleHint: "vintage")
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(object["trip_id"] as? Int, 7)
        XCTAssertEqual(object["style_hint"] as? String, "vintage")
    }
}

// MARK: - Input (web `canStart = numericTripId > 0`)

final class AIPostcardInputTests: XCTestCase {
    func testCanStartRequiresEnabledPositiveTripAndConnectivity() {
        XCTAssertTrue(AIPostcardInput(tripID: 42).canStart)
        XCTAssertFalse(AIPostcardInput(featureEnabled: false, tripID: 42).canStart)
        XCTAssertFalse(AIPostcardInput(tripID: nil).canStart)
        XCTAssertFalse(AIPostcardInput(tripID: 0).canStart)
        XCTAssertFalse(AIPostcardInput(tripID: -3).canStart)
        XCTAssertFalse(AIPostcardInput(tripID: 42, connection: .offline).canStart)
    }

    func testHasTrip() {
        XCTAssertTrue(AIPostcardInput(tripID: 42).hasTrip)
        XCTAssertFalse(AIPostcardInput(tripID: nil).hasTrip)
        XCTAssertFalse(AIPostcardInput(tripID: 0).hasTrip)
    }

    func testNumericTripIDProperty() {
        XCTAssertEqual(AIPostcardInput(tripID: 42).numericTripID, 42)
        XCTAssertEqual(AIPostcardInput(tripID: nil).numericTripID, 0)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AIPostcardProjectionTests: XCTestCase {
    func testGatedOffWhenFeatureDisabled() {
        let resolved = AIPostcardProjection.resolve(
            AIPostcardInput(featureEnabled: false, tripID: 42), .idle
        )
        XCTAssertEqual(resolved.phase, .gatedOff)
    }

    func testLoadingWhenContextLoadingAndStreamIdle() {
        let resolved = AIPostcardProjection.resolve(
            AIPostcardInput(tripID: 42, isLoading: true), .idle
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testIdleWhenResolvedAndNoStream() {
        let resolved = AIPostcardProjection.resolve(AIPostcardInput(tripID: 42), .idle)
        XCTAssertEqual(resolved.phase, .idle)
        XCTAssertTrue(resolved.canStart)
    }

    func testThinkingWhenStreamingWithoutText() {
        let resolved = AIPostcardProjection.resolve(
            AIPostcardInput(tripID: 42), AIPostcardStreamSnapshot(lifecycle: .streaming)
        )
        XCTAssertEqual(resolved.phase, .thinking)
        XCTAssertTrue(resolved.isStreaming)
    }

    func testDraftWhenTextPresent() {
        let resolved = AIPostcardProjection.resolve(
            AIPostcardInput(tripID: 42), AIPostcardStreamSnapshot(lifecycle: .done, text: "Coast Run")
        )
        XCTAssertEqual(resolved.phase, .draft("Coast Run"))
    }

    func testErrorTakesPrecedenceOverText() {
        let resolved = AIPostcardProjection.resolve(
            AIPostcardInput(tripID: 42),
            AIPostcardStreamSnapshot(lifecycle: .error, text: "partial", error: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testOfflineDisablesCanStartButKeepsDraft() {
        let resolved = AIPostcardProjection.resolve(
            AIPostcardInput(tripID: 42, connection: .offline),
            AIPostcardStreamSnapshot(lifecycle: .done, text: "Coast Run")
        )
        XCTAssertEqual(resolved.phase, .draft("Coast Run"))
        XCTAssertFalse(resolved.canStart)
        XCTAssertTrue(resolved.hasTrip)
    }
}

// MARK: - Accessibility summaries

final class AIPostcardAccessibilityTests: XCTestCase {
    func testActionLabelJoinsHelixAndVerb() {
        XCTAssertEqual(
            AIPostcardAccessibility.actionLabel(askHelix: "Ask Helix", buttonLabel: "Generate share card"),
            "Ask Helix · Generate share card"
        )
    }

    func testDraftLabelReadsRoleThenText() {
        XCTAssertEqual(
            AIPostcardAccessibility.draftLabel(role: "Share-card draft", text: "Coast Run"),
            "Share-card draft: Coast Run"
        )
    }

    func testErrorLabelReadsPrefixThenMessage() {
        XCTAssertEqual(
            AIPostcardAccessibility.errorLabel(prefix: "Helix error:", message: "boom"),
            "Helix error: boom"
        )
    }
}
