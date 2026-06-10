//
//  AISpeedProfileInsights.Tests.swift
//  TeslaSync — P4 shared surface · 0049 · AISpeedProfileInsights (Apple)
//
//  Unit coverage for the AISpeedProfileInsights surface:
//    • Projection — gated / loading / error / ready, the `canStart = !!driveId` rule (incl. the
//      nil and empty-string boundaries), the Ask-Helix label flip, the disabled rule, and every
//      localized `AiOutputPanel` branch (empty / no-drive / thinking / prose / error /
//      unknown-error).
//    • State holder — `SpeedProfileInsightsModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel
//      / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemorySpeedProfileInsightsSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class SpeedProfileInsightsProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = SpeedProfileInsightsProjection.resolve(
            SpeedProfileInsightsInput(availability: .resolved(enabled: false), driveID: "7"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = SpeedProfileInsightsProjection.resolve(
            SpeedProfileInsightsInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = SpeedProfileInsightsProjection.resolve(
            SpeedProfileInsightsInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = SpeedProfileInsightsProjection.resolve(
            SpeedProfileInsightsInput(availability: .resolved(enabled: true), driveID: "7"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class SpeedProfileInsightsProjectionReadyTests: XCTestCase {
    private func ready(
        driveID: String? = "7",
        stream: SpeedProfileInsightsStreamSnapshot = .idle
    ) -> SpeedProfileInsightsReady {
        let resolved = SpeedProfileInsightsProjection.resolve(
            SpeedProfileInsightsInput(
                availability: .resolved(enabled: true),
                driveID: driveID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Speed-profile insights")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("speed regime"))
        XCTAssertTrue(card.description.contains("per-drive aggregates"))
        XCTAssertEqual(card.buttonContext, "Generate insights")
    }

    func testCanStartRequiresNonEmptyDriveID() {
        // Web `canStart={!!driveId}`.
        XCTAssertTrue(ready(driveID: "7").canStart)
        XCTAssertFalse(ready(driveID: nil).canStart)
        XCTAssertFalse(ready(driveID: "").canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: SpeedProfileInsightsStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutDriveOrWhileStreaming() {
        XCTAssertTrue(ready(driveID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(driveID: "", stream: .idle).action.isDisabled)
        let streaming = SpeedProfileInsightsStreamSnapshot(state: .streaming)
        XCTAssertTrue(ready(driveID: "7", stream: streaming).action.isDisabled)
        XCTAssertFalse(ready(driveID: "7", stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Generate insights")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class SpeedProfileInsightsProjectionOutputTests: XCTestCase {
    private func output(
        driveID: String? = "7",
        stream: SpeedProfileInsightsStreamSnapshot
    ) -> SpeedProfileInsightsResolvedOutput {
        SpeedProfileInsightsProjection.resolve(
            SpeedProfileInsightsInput(
                availability: .resolved(enabled: true),
                driveID: driveID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithDrive() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No insights yet"))
    }

    func testNoDriveHintWhenIdleWithoutDrive() {
        let out = output(driveID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Open a drive"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: SpeedProfileInsightsStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let snapshot = SpeedProfileInsightsStreamSnapshot(state: .streaming, text: "Lower your cruise speed.")
        let out = output(stream: snapshot)
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Lower your cruise speed.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let snapshot = SpeedProfileInsightsStreamSnapshot(state: .error, text: "", error: "stream_http_429")
        let out = output(stream: snapshot)
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: SpeedProfileInsightsStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class SpeedProfileInsightsModelTests: XCTestCase {
    private func makeModel(
        _ input: SpeedProfileInsightsInput,
        telemetry: SpeedProfileInsightsTelemetry = OSLogSpeedProfileInsightsTelemetry()
    ) -> (SpeedProfileInsightsModel, InMemorySpeedProfileInsightsSource) {
        let source = InMemorySpeedProfileInsightsSource(initial: input)
        let model = SpeedProfileInsightsModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        driveID: String? = "7",
        connection: SpeedProfileInsightsConnection = .live,
        stream: SpeedProfileInsightsStreamSnapshot = .idle
    ) -> SpeedProfileInsightsInput {
        SpeedProfileInsightsInput(
            availability: .resolved(enabled: true),
            driveID: driveID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySpeedProfileInsightsTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AISpeedProfileInsights.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpySpeedProfileInsightsTelemetry()
        let (model, _) = makeModel(
            SpeedProfileInsightsInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpySpeedProfileInsightsTelemetry()
        let (model, source) = makeModel(
            SpeedProfileInsightsInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AISpeedProfileInsights.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AISpeedProfileInsights.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SpeedProfileInsightsInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        let snapshot = SpeedProfileInsightsStreamSnapshot(state: .done, text: "Lower your cruise speed.")
        source.push(enabled(stream: snapshot))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Lower your cruise speed.")
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
        XCTAssertEqual(AISpeedProfileInsights.surfaceSlug, "AISpeedProfileInsights")
    }
}

// MARK: - Accessibility summary

@MainActor final class SpeedProfileInsightsAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            SpeedProfileInsightsAccessibility.actionLabel(ask: "Ask Helix", context: "Generate insights"),
            "Ask Helix · Generate insights"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            SpeedProfileInsightsAccessibility.outputLabel("Speed-profile insights", "Drive smoother."),
            "Speed-profile insights: Drive smoother."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySpeedProfileInsightsTelemetry: SpeedProfileInsightsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
