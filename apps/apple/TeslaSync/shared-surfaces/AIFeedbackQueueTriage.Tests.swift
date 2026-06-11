//
//  AIFeedbackQueueTriage.Tests.swift
//  TeslaSync — P4 shared surface · 0019 · AIFeedbackQueueTriage (Apple)
//
//  Unit coverage for the AIFeedbackQueueTriage surface:
//    • Projection — gated / loading / error / ready, the `canStart = haveFeedback` rule (incl. the
//      nil, the id-0, and the negative boundaries — only a strictly-positive id is a valid selection,
//      unlike the vehicle-id surfaces), the Ask-Helix label flip, the disabled rule, and every
//      localized `AiOutputPanel` branch (empty / no-feedback / thinking / prose / error /
//      unknown-error).
//    • State holder — `FeedbackTriageModel` wiring, the P1/S11 `view.opened` telemetry (deferred past
//      the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel / refresh / stop
//      delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryFeedbackTriageSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class FeedbackTriageProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = FeedbackTriageProjection.resolve(
            FeedbackTriageInput(availability: .resolved(enabled: false), feedbackID: 482),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = FeedbackTriageProjection.resolve(
            FeedbackTriageInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = FeedbackTriageProjection.resolve(
            FeedbackTriageInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = FeedbackTriageProjection.resolve(
            FeedbackTriageInput(availability: .resolved(enabled: true), feedbackID: 482),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class FeedbackTriageProjectionReadyTests: XCTestCase {
    private func ready(
        feedbackID: Int? = 482,
        stream: FeedbackTriageStreamSnapshot = .idle
    ) -> FeedbackTriageReady {
        let resolved = FeedbackTriageProjection.resolve(
            FeedbackTriageInput(
                availability: .resolved(enabled: true),
                feedbackID: feedbackID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Helix triage advisor")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("redacted envelope"))
        XCTAssertTrue(card.description.contains("only way to save changes"))
        XCTAssertEqual(card.buttonContext, "Suggest triage")
    }

    func testDescriptionPreservesEmDashAndPrivacyContract() {
        // Parity: the web copy uses the — em dash and names the redacted-envelope fields it reads.
        let card = ready()
        XCTAssertTrue(card.description.contains("— never the reporter email"))
        XCTAssertTrue(card.description.contains("id, category, title, body excerpt"))
    }

    func testCanStartRequiresPositiveFeedbackID() {
        // Web `canStart={haveFeedback}` where haveFeedback = feedbackId is a finite number > 0.
        XCTAssertTrue(ready(feedbackID: 482).canStart)
        XCTAssertFalse(ready(feedbackID: nil).canStart)
    }

    func testCanStartRejectsZeroAndNegativeFeedbackID() {
        // Unlike the vehicle-id surfaces, 0 and negatives are NOT valid selections here.
        XCTAssertFalse(ready(feedbackID: 0).canStart)
        XCTAssertFalse(ready(feedbackID: -7).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: FeedbackTriageStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutFeedbackOrWhileStreaming() {
        XCTAssertTrue(ready(feedbackID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(feedbackID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(feedbackID: 482, stream: FeedbackTriageStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(feedbackID: 482, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Suggest triage")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class FeedbackTriageProjectionOutputTests: XCTestCase {
    private func output(
        feedbackID: Int? = 482,
        stream: FeedbackTriageStreamSnapshot
    ) -> FeedbackTriageResolvedOutput {
        FeedbackTriageProjection.resolve(
            FeedbackTriageInput(
                availability: .resolved(enabled: true),
                feedbackID: feedbackID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithFeedback() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No proposal yet"))
    }

    func testNoFeedbackHintWhenIdleWithoutFeedback() {
        let out = output(feedbackID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a feedback row"))
    }

    func testNoFeedbackHintAlsoForZeroId() {
        let out = output(feedbackID: 0, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a feedback row"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: FeedbackTriageStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: FeedbackTriageStreamSnapshot(state: .streaming, text: "Proposed status."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Proposed status.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: FeedbackTriageStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: FeedbackTriageStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class FeedbackTriageModelTests: XCTestCase {
    private func makeModel(
        _ input: FeedbackTriageInput,
        telemetry: FeedbackTriageTelemetry = OSLogFeedbackTriageTelemetry()
    ) -> (FeedbackTriageModel, InMemoryFeedbackTriageSource) {
        let source = InMemoryFeedbackTriageSource(initial: input)
        let model = FeedbackTriageModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        feedbackID: Int? = 482,
        connection: FeedbackTriageConnection = .live,
        stream: FeedbackTriageStreamSnapshot = .idle
    ) -> FeedbackTriageInput {
        FeedbackTriageInput(
            availability: .resolved(enabled: true),
            feedbackID: feedbackID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyFeedbackTriageTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIFeedbackQueueTriage.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyFeedbackTriageTelemetry()
        let (model, _) = makeModel(
            FeedbackTriageInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyFeedbackTriageTelemetry()
        let (model, source) = makeModel(
            FeedbackTriageInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIFeedbackQueueTriage.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIFeedbackQueueTriage.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(FeedbackTriageInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: FeedbackTriageStreamSnapshot(state: .done, text: "Proposed status.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Proposed status.")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(enabled())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(enabled(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(enabled(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(connection: .stale)) // refresh 1
        source.push(enabled(connection: .live)) // re-arm
        source.push(enabled(connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testGenerateDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.generate()
        XCTAssertEqual(source.generateCount, 1)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIFeedbackQueueTriage.surfaceSlug, "AIFeedbackQueueTriage")
    }
}

// MARK: - Accessibility summary

@MainActor final class FeedbackTriageAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            FeedbackTriageAccessibility.actionLabel(ask: "Ask Helix", context: "Suggest triage"),
            "Ask Helix · Suggest triage"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            FeedbackTriageAccessibility.outputLabel("Triage proposal", "Proposed status."),
            "Triage proposal: Proposed status."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFeedbackTriageTelemetry: FeedbackTriageTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
