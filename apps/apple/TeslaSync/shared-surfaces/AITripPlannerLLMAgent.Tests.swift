//
//  AITripPlannerLLMAgent.Tests.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  Unit coverage for the AITripPlannerLLMAgent surface:
//    • Projection — gated / loading / error / ready, the `canStart = haveInputs` rule (vehicle, origin,
//      destination thirds, incl. nil / 0 boundaries), the Ask-Helix label flip, the disabled rule, and
//      every localized `AiOutputPanel` branch. The web source passes NO `emptyHint`, so the contextual
//      guidance lives in the output panel rather than a description-level hint.
//    • State holder — `TripPlannerAgentModel` wiring, the P1/S11 `view.opened` telemetry (deferred past
//      the gate), the stale one-shot auto-refresh + re-arm, and generate / cancel / refresh / stop.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no real store: the model is driven
//  by `InMemoryTripPlannerAgentSource` with an injected locale, so the i18n facade returns the web
//  English `value:` fallbacks (the per-surface table is absent in the test bundle), which are asserted.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let sf = TripPlannerAgentLocation(lat: 37.7749, lng: -122.4194, name: "San Francisco")
private let la = TripPlannerAgentLocation(lat: 34.0522, lng: -118.2437, name: "Los Angeles")

// MARK: - Projection: phases

@MainActor final class TripPlannerAgentProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = TripPlannerAgentProjection.resolve(
            TripPlannerAgentInput(
                availability: .resolved(enabled: false),
                vehicleID: 7,
                origin: sf,
                destination: la
            ),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = TripPlannerAgentProjection.resolve(
            TripPlannerAgentInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = TripPlannerAgentProjection.resolve(
            TripPlannerAgentInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = TripPlannerAgentProjection.resolve(
            TripPlannerAgentInput(
                availability: .resolved(enabled: true),
                vehicleID: 7,
                origin: sf,
                destination: la
            ),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class TripPlannerAgentProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        origin: TripPlannerAgentLocation? = sf,
        destination: TripPlannerAgentLocation? = la,
        stream: TripPlannerAgentStreamSnapshot = .idle
    ) -> TripPlannerAgentReady {
        let resolved = TripPlannerAgentProjection.resolve(
            TripPlannerAgentInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                origin: origin,
                destination: destination,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Draft a plan with Helix")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertEqual(card.buttonContext, "Draft a plan")
        XCTAssertTrue(card.description.contains("draft a trip plan grounded in your past charging history"))
        XCTAssertTrue(card.description.contains("never saved automatically"))
        XCTAssertTrue(card.description.contains("click Plan in the form below to save it"))
    }

    func testDescriptionPreservesUnicodeEmDash() {
        // Parity: the web copy uses the — em dash (\u2014).
        XCTAssertTrue(ready().description.contains("—"))
    }

    func testCanStartRequiresVehicleOriginAndDestination() {
        // Web `haveInputs = !!vehicleId && origin != null && destination != null`.
        XCTAssertTrue(ready(vehicleID: 7, origin: sf, destination: la).canStart)
        XCTAssertFalse(ready(vehicleID: nil, origin: sf, destination: la).canStart)
        XCTAssertFalse(ready(vehicleID: 7, origin: nil, destination: la).canStart)
        XCTAssertFalse(ready(vehicleID: 7, origin: sf, destination: nil).canStart)
    }

    func testCanStartRejectsZeroVehicle() {
        XCTAssertFalse(ready(vehicleID: 0, origin: sf, destination: la).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: TripPlannerAgentStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutInputsOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(origin: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(destination: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(stream: TripPlannerAgentStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Draft a plan")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class TripPlannerAgentProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        origin: TripPlannerAgentLocation? = sf,
        destination: TripPlannerAgentLocation? = la,
        stream: TripPlannerAgentStreamSnapshot
    ) -> TripPlannerAgentResolvedOutput {
        TripPlannerAgentProjection.resolve(
            TripPlannerAgentInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                origin: origin,
                destination: destination,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithInputs() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No plan drafted yet"))
    }

    func testNoInputsHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle, an origin, and a destination"))
    }

    func testNoInputsHintWhenIdleWithoutOrigin() {
        let out = output(origin: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle, an origin, and a destination"))
    }

    func testNoInputsHintWhenIdleWithoutDestination() {
        let out = output(destination: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle, an origin, and a destination"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: TripPlannerAgentStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: TripPlannerAgentStreamSnapshot(state: .streaming, text: "SF → LA."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "SF → LA.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: TripPlannerAgentStreamSnapshot(
            state: .error,
            text: "",
            error: "stream_http_429"
        ))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: TripPlannerAgentStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }

    func testProseAccessibilityLabelPrependsTitle() {
        let out = output(stream: TripPlannerAgentStreamSnapshot(state: .done, text: "SF → LA."))
        XCTAssertEqual(out.accessibilityLabel, "Trip plan proposal: SF → LA.")
    }
}

// MARK: - Accessibility summary

@MainActor final class TripPlannerAgentAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            TripPlannerAgentAccessibility.actionLabel(ask: "Ask Helix", context: "Draft a plan"),
            "Ask Helix · Draft a plan"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            TripPlannerAgentAccessibility.outputLabel("Trip plan proposal", "SF → LA."),
            "Trip plan proposal: SF → LA."
        )
    }
}
