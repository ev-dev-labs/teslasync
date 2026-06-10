//
//  AISafetySettingExplainer.Tests.swift
//  TeslaSync — P4 shared surface · 0045 · AISafetySettingExplainer (Apple)
//
//  Unit coverage for the AISafetySettingExplainer surface:
//    • Projection — gated / loading / error / ready, the `canStart = state !== 'paused-confirm'`
//      rule, the Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel` branch
//      (empty / thinking / prose / error / unknown-error).
//    • State holder — `SafetySettingExplainerModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, the generate /
//      cancel / refresh / stop delegation, the `isBusy` double-submit guard, and the cancel-on-stop
//      (web cancel-on-unmount) behaviour.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemorySafetySettingExplainerSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class SafetySettingExplainerProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = SafetySettingExplainerProjection.resolve(
            SafetySettingExplainerInput(availability: .resolved(enabled: false)),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = SafetySettingExplainerProjection.resolve(
            SafetySettingExplainerInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = SafetySettingExplainerProjection.resolve(
            SafetySettingExplainerInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = SafetySettingExplainerProjection.resolve(
            SafetySettingExplainerInput(availability: .resolved(enabled: true)),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class SafetySettingExplainerProjectionReadyTests: XCTestCase {
    private func ready(
        stream: SafetySettingExplainerStreamSnapshot = .idle
    ) -> SafetySettingExplainerReady {
        let resolved = SafetySettingExplainerProjection.resolve(
            SafetySettingExplainerInput(
                availability: .resolved(enabled: true),
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Explain my safety settings")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertEqual(card.buttonContext, "Explain my settings")
        XCTAssertTrue(card.description.contains("safety-related TeslaSync settings"))
        XCTAssertTrue(card.description.contains("never proposes or changes a setting"))
        XCTAssertTrue(card.description.contains("Helix only narrates"))
    }

    func testCanStartFollowsPausedConfirmRule() {
        // Parity: web `canStart={stream.state !== 'paused-confirm'}`.
        XCTAssertTrue(ready(stream: .idle).canStart)
        XCTAssertTrue(ready(stream: SafetySettingExplainerStreamSnapshot(state: .streaming)).canStart)
        XCTAssertTrue(ready(stream: SafetySettingExplainerStreamSnapshot(state: .done)).canStart)
        XCTAssertTrue(ready(stream: SafetySettingExplainerStreamSnapshot(state: .error)).canStart)
        XCTAssertFalse(ready(stream: SafetySettingExplainerStreamSnapshot(state: .pausedConfirm)).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: SafetySettingExplainerStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWhileStreamingOrPaused() {
        XCTAssertTrue(ready(stream: SafetySettingExplainerStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertTrue(ready(stream: SafetySettingExplainerStreamSnapshot(state: .pausedConfirm)).action.isDisabled)
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
        XCTAssertFalse(ready(stream: SafetySettingExplainerStreamSnapshot(state: .done)).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Explain my settings")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class SafetySettingExplainerProjectionOutputTests: XCTestCase {
    private func output(
        stream: SafetySettingExplainerStreamSnapshot
    ) -> SafetySettingExplainerResolvedOutput {
        SafetySettingExplainerProjection.resolve(
            SafetySettingExplainerInput(
                availability: .resolved(enabled: true),
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdle() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No explanation yet"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: SafetySettingExplainerStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(
            stream: SafetySettingExplainerStreamSnapshot(state: .streaming, text: "Quiet hours are off.")
        )
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Quiet hours are off.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(
            stream: SafetySettingExplainerStreamSnapshot(state: .error, text: "", error: "stream_http_429")
        )
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: SafetySettingExplainerStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class SafetySettingExplainerModelTests: XCTestCase {
    private func makeModel(
        _ input: SafetySettingExplainerInput,
        telemetry: SafetySettingExplainerTelemetry = OSLogSafetySettingExplainerTelemetry()
    ) -> (SafetySettingExplainerModel, InMemorySafetySettingExplainerSource) {
        let source = InMemorySafetySettingExplainerSource(initial: input)
        let model = SafetySettingExplainerModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        connection: SafetySettingExplainerConnection = .live,
        stream: SafetySettingExplainerStreamSnapshot = .idle
    ) -> SafetySettingExplainerInput {
        SafetySettingExplainerInput(
            availability: .resolved(enabled: true),
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySafetySettingExplainerTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AISafetySettingExplainer.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpySafetySettingExplainerTelemetry()
        let (model, _) = makeModel(
            SafetySettingExplainerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpySafetySettingExplainerTelemetry()
        let (model, source) = makeModel(
            SafetySettingExplainerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AISafetySettingExplainer.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AISafetySettingExplainer.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SafetySettingExplainerInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: SafetySettingExplainerStreamSnapshot(state: .done, text: "Quiet hours off.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Quiet hours off.")
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

    func testGenerateDelegatesToSourceWhenIdle() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.generate()
        XCTAssertEqual(source.generateCount, 1)
    }

    func testGenerateNoOpsWhileStreaming() {
        // Web `handleExplain` returns early while busy (isBusy = streaming || paused-confirm).
        let (model, source) = makeModel(enabled(stream: SafetySettingExplainerStreamSnapshot(state: .streaming)))
        model.start()
        model.generate()
        XCTAssertEqual(source.generateCount, 0)
    }

    func testGenerateNoOpsWhilePausedConfirm() {
        let (model, source) = makeModel(enabled(stream: SafetySettingExplainerStreamSnapshot(state: .pausedConfirm)))
        model.start()
        model.generate()
        XCTAssertEqual(source.generateCount, 0)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelCount, 1)
    }

    func testStopCancelsInFlightStreamAndStops() {
        // Web cancel-on-unmount: the cleanup effect calls cancel() when the panel unmounts.
        let (model, source) = makeModel(enabled())
        model.start()
        model.stop()
        XCTAssertEqual(source.cancelCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testStopReArmsStart() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AISafetySettingExplainer.surfaceSlug, "AISafetySettingExplainer")
    }

    func testActionAccessibilityIdentifierMatchesWebTestId() {
        XCTAssertEqual(
            AISafetySettingExplainer.actionAccessibilityIdentifier,
            "ai-feature-safety-setting-explainer-suggest"
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class SafetySettingExplainerAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            SafetySettingExplainerAccessibility.actionLabel(ask: "Ask Helix", context: "Explain my settings"),
            "Ask Helix · Explain my settings"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            SafetySettingExplainerAccessibility.outputLabel("Safety-setting explanation", "Quiet hours off."),
            "Safety-setting explanation: Quiet hours off."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySafetySettingExplainerTelemetry: SafetySettingExplainerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
