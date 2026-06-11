//
//  AIAlertTuningSuggestions.Tests.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  Unit coverage for the AIAlertTuningSuggestions surface:
//    • Projection — gated / loading / error / ready, the `canStart = !!ruleId && state !==
//      'paused-confirm'` rule, the Suggest label flip, the disabled rule, every localized
//      `AiOutputPanel` branch (empty / no-rule / thinking / prose / error / unknown-error), and the
//      captured-proposal preview (rows, label, Apply disabled rule, withdrawn when absent).
//    • State holder — `AlertTuningSuggestionsModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the suggest / cancel /
//      refresh / stop / apply delegation (apply forwards the captured patch).
//    • Accessibility — the VoiceOver action + output + proposal-row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryAlertTuningSource`, and the locale is injected for determinism. In the
//  test bundle the per-surface strings table is absent, so the i18n facade returns the web English
//  `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class AlertTuningProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = AlertTuningProjection.resolve(
            AlertTuningInput(availability: .resolved(enabled: false), ruleID: 42),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = AlertTuningProjection.resolve(AlertTuningInput(availability: .loading), locale: enUS)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = AlertTuningProjection.resolve(AlertTuningInput(availability: .failed("boom")), locale: enUS)
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = AlertTuningProjection.resolve(
            AlertTuningInput(availability: .resolved(enabled: true), ruleID: 42),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class AlertTuningProjectionReadyTests: XCTestCase {
    private func ready(
        ruleID: Int? = 42,
        stream: AlertTuningStreamSnapshot = .idle
    ) -> AlertTuningReady {
        AlertTuningProjection.resolve(
            AlertTuningInput(availability: .resolved(enabled: true), ruleID: ruleID, stream: stream),
            locale: enUS
        ).ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Suggest lower-noise tuning")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("typed AlertRule patch"))
        XCTAssertTrue(card.description.contains("review before saving"))
        XCTAssertEqual(card.buttonContext, "Suggest tuning")
    }

    func testCanStartFollowsRulePresence() {
        XCTAssertTrue(ready(ruleID: 42).canStart)
        XCTAssertFalse(ready(ruleID: nil).canStart)
    }

    func testCanStartFalseWhilePausedConfirm() {
        XCTAssertFalse(ready(ruleID: 42, stream: AlertTuningStreamSnapshot(state: .pausedConfirm)).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: AlertTuningStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutRuleOrWhileStreaming() {
        XCTAssertTrue(ready(ruleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(ruleID: 42, stream: AlertTuningStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(ruleID: 42, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Suggest tuning")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class AlertTuningProjectionOutputTests: XCTestCase {
    private func output(
        ruleID: Int? = 42,
        stream: AlertTuningStreamSnapshot
    ) -> AlertTuningResolvedOutput {
        AlertTuningProjection.resolve(
            AlertTuningInput(availability: .resolved(enabled: true), ruleID: ruleID, stream: stream),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithRule() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No suggestion yet"))
    }

    func testNoRuleHintWhenIdleWithoutRule() {
        let out = output(ruleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select an alert rule"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: AlertTuningStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: AlertTuningStreamSnapshot(state: .streaming, text: "Raise the threshold."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Raise the threshold.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: AlertTuningStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: AlertTuningStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - Projection: captured-proposal region

@MainActor final class AlertTuningProjectionProposalTests: XCTestCase {
    private func proposal(
        stream: AlertTuningStreamSnapshot
    ) -> AlertTuningResolvedProposal {
        AlertTuningProjection.resolve(
            AlertTuningInput(availability: .resolved(enabled: true), ruleID: 42, stream: stream),
            locale: enUS
        ).ready!.proposal
    }

    func testAbsentWhenNoProposalCaptured() {
        XCTAssertFalse(proposal(stream: .idle).isPresent)
    }

    func testPresentWithLocalizedLabelAndApplyTitle() {
        let patch = AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45)
        let resolved = proposal(stream: AlertTuningStreamSnapshot(state: .done, text: "done", proposal: patch))
        XCTAssertTrue(resolved.isPresent)
        XCTAssertEqual(resolved.previewLabel, "Proposed patch (review before saving):")
        XCTAssertEqual(resolved.applyTitle, "Apply to form")
    }

    func testRowsAreOrderedAndRendered() {
        let patch = AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45, severity: "warn", op: "<")
        let resolved = proposal(stream: AlertTuningStreamSnapshot(state: .done, text: "done", proposal: patch))
        XCTAssertEqual(resolved.rows.map(\.field), ["value_num", "cooldown_min", "severity", "op"])
        XCTAssertEqual(resolved.rows.map(\.value), ["15", "45", "warn", "<"])
        XCTAssertEqual(resolved.rows.first?.accessibilityLabel, "value_num: 15")
    }

    func testApplyEnabledWhenDoneWithProposal() {
        let patch = AlertRuleDraftPatch(valueNum: 15)
        let resolved = proposal(stream: AlertTuningStreamSnapshot(state: .done, text: "done", proposal: patch))
        XCTAssertFalse(resolved.applyDisabled)
    }

    func testApplyDisabledWhileStreamingEvenWithProposal() {
        // A proposal can arrive mid-stream; Apply stays disabled until the stream settles (web isBusy).
        let patch = AlertRuleDraftPatch(valueNum: 15)
        let resolved = proposal(stream: AlertTuningStreamSnapshot(state: .streaming, text: "…", proposal: patch))
        XCTAssertTrue(resolved.applyDisabled)
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation, apply

@MainActor final class AlertTuningModelTests: XCTestCase {
    private func makeModel(
        _ input: AlertTuningInput,
        telemetry: AlertTuningTelemetry = OSLogAlertTuningTelemetry()
    ) -> (AlertTuningSuggestionsModel, InMemoryAlertTuningSource) {
        let source = InMemoryAlertTuningSource(initial: input)
        let model = AlertTuningSuggestionsModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        ruleID: Int? = 42,
        connection: AlertTuningConnection = .live,
        stream: AlertTuningStreamSnapshot = .idle
    ) -> AlertTuningInput {
        AlertTuningInput(
            availability: .resolved(enabled: true),
            ruleID: ruleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAlertTuningTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIAlertTuningSuggestions.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyAlertTuningTelemetry()
        let (model, _) = makeModel(AlertTuningInput(availability: .resolved(enabled: false)), telemetry: spy)
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyAlertTuningTelemetry()
        let (model, source) = makeModel(
            AlertTuningInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIAlertTuningSuggestions.surfaceSlug])
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIAlertTuningSuggestions.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AlertTuningInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testProposalSnapshotFlowsIntoReady() {
        let (model, source) = makeModel(enabled())
        model.start()
        let patch = AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45)
        source.push(enabled(stream: AlertTuningStreamSnapshot(state: .done, text: "done", proposal: patch)))
        XCTAssertTrue(model.ready?.proposal.isPresent ?? false)
        XCTAssertEqual(model.ready?.proposal.rows.first?.field, "value_num")
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
        source.push(enabled(connection: .stale))
        source.push(enabled(connection: .live))
        source.push(enabled(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testSuggestDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.suggest()
        XCTAssertEqual(source.suggestCount, 1)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelCount, 1)
    }

    func testApplyForwardsCapturedPatch() {
        let (model, source) = makeModel(enabled())
        model.start()
        let patch = AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45)
        source.push(enabled(stream: AlertTuningStreamSnapshot(state: .done, text: "done", proposal: patch)))
        model.apply()
        XCTAssertEqual(source.applyCount, 1)
        XCTAssertEqual(source.lastAppliedPatch, patch)
    }

    func testApplyIsNoOpWithoutCapturedPatch() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.apply()
        XCTAssertEqual(source.applyCount, 0)
        XCTAssertNil(source.lastAppliedPatch)
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
        XCTAssertEqual(AIAlertTuningSuggestions.surfaceSlug, "AIAlertTuningSuggestions")
    }
}

// MARK: - Accessibility summary

@MainActor final class AlertTuningAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            AlertTuningAccessibility.actionLabel(ask: "Ask Helix", context: "Suggest tuning"),
            "Ask Helix · Suggest tuning"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            AlertTuningAccessibility.outputLabel("Suggest lower-noise tuning", "Raise the threshold."),
            "Suggest lower-noise tuning: Raise the threshold."
        )
    }

    func testProposalRowLabel() {
        XCTAssertEqual(AlertTuningAccessibility.proposalRow(field: "value_num", value: "15"), "value_num: 15")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAlertTuningTelemetry: AlertTuningTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
