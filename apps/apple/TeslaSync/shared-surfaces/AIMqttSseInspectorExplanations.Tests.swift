//
//  AIMqttSseInspectorExplanations.Tests.swift
//  TeslaSync — P4 shared surface · 0028 · AIMqttSseInspectorExplanations (Apple)
//
//  Unit coverage for the AIMqttSseInspectorExplanations surface:
//    • Projection — gated / loading / error / ready, the `canStart = haveWindow` rule (incl. the nil
//      / non-positive / inverted-window boundaries), the header `emptyHint`, the Ask-Helix label
//      flip, the disabled rule, and every localized `AiOutputPanel` branch (empty / no-window /
//      thinking / prose / error / unknown-error).
//    • State holder — `MqttSseExplainerModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the explain / cancel / refresh /
//      stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryMqttSseExplainerSource`, and the locale is injected for determinism.
//  In the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class MqttSseExplainerProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = MqttSseExplainerProjection.resolve(
            MqttSseExplainerInput(availability: .resolved(enabled: false), fromUnix: 1000, toUnix: 2000),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = MqttSseExplainerProjection.resolve(
            MqttSseExplainerInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = MqttSseExplainerProjection.resolve(
            MqttSseExplainerInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = MqttSseExplainerProjection.resolve(
            MqttSseExplainerInput(availability: .resolved(enabled: true), fromUnix: 1000, toUnix: 2000),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class MqttSseExplainerProjectionReadyTests: XCTestCase {
    private func ready(
        fromUnix: Int? = 1000,
        toUnix: Int? = 2000,
        stream: MqttSseExplainerStreamSnapshot = .idle
    ) -> MqttSseExplainerReady {
        let resolved = MqttSseExplainerProjection.resolve(
            MqttSseExplainerInput(
                availability: .resolved(enabled: true),
                fromUnix: fromUnix,
                toUnix: toUnix,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Helix stream explainer")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("factual explanation"))
        XCTAssertTrue(card.description.contains("deterministic broker-status"))
        XCTAssertTrue(card.description.contains("redacted"))
        XCTAssertEqual(card.buttonContext, "Explain streams")
    }

    func testCanStartRequiresValidWindow() {
        // Web `haveWindow = fromUnix > 0 && toUnix > fromUnix`.
        XCTAssertTrue(ready(fromUnix: 1000, toUnix: 2000).canStart)
        XCTAssertTrue(ready(fromUnix: 1, toUnix: 2).canStart)
        XCTAssertFalse(ready(fromUnix: nil, toUnix: 2000).canStart)
        XCTAssertFalse(ready(fromUnix: 1000, toUnix: nil).canStart)
        XCTAssertFalse(ready(fromUnix: 0, toUnix: 2000).canStart)
        XCTAssertFalse(ready(fromUnix: -3, toUnix: 2000).canStart)
        XCTAssertFalse(ready(fromUnix: 2000, toUnix: 1000).canStart)
        XCTAssertFalse(ready(fromUnix: 1000, toUnix: 1000).canStart)
    }

    func testWindowHintShownOnlyWhenNoValidWindow() {
        // Web `emptyHint={haveWindow ? undefined : t('…emptyHint', 'A valid time window is required.')}`.
        XCTAssertNil(ready(fromUnix: 1000, toUnix: 2000).windowHint)
        XCTAssertEqual(ready(fromUnix: nil, toUnix: nil).windowHint, "A valid time window is required.")
        XCTAssertEqual(ready(fromUnix: 2000, toUnix: 1000).windowHint, "A valid time window is required.")
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: MqttSseExplainerStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutWindowOrWhileStreaming() {
        XCTAssertTrue(ready(fromUnix: nil, toUnix: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(fromUnix: 2000, toUnix: 1000, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(fromUnix: 1000, toUnix: 2000, stream: MqttSseExplainerStreamSnapshot(state: .streaming))
                .action.isDisabled
        )
        XCTAssertFalse(ready(fromUnix: 1000, toUnix: 2000, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Explain streams")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class MqttSseExplainerProjectionOutputTests: XCTestCase {
    private func output(
        fromUnix: Int? = 1000,
        toUnix: Int? = 2000,
        stream: MqttSseExplainerStreamSnapshot
    ) -> MqttSseExplainerResolvedOutput {
        MqttSseExplainerProjection.resolve(
            MqttSseExplainerInput(
                availability: .resolved(enabled: true),
                fromUnix: fromUnix,
                toUnix: toUnix,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithWindow() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No explanation yet"))
    }

    func testNoWindowHintWhenIdleWithoutWindow() {
        let out = output(fromUnix: nil, toUnix: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Set a valid time window"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: MqttSseExplainerStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: MqttSseExplainerStreamSnapshot(state: .streaming, text: "Broker connected."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Broker connected.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: MqttSseExplainerStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: MqttSseExplainerStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class MqttSseExplainerModelTests: XCTestCase {
    private func makeModel(
        _ input: MqttSseExplainerInput,
        telemetry: MqttSseExplainerTelemetry = OSLogMqttSseExplainerTelemetry()
    ) -> (MqttSseExplainerModel, InMemoryMqttSseExplainerSource) {
        let source = InMemoryMqttSseExplainerSource(initial: input)
        let model = MqttSseExplainerModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        fromUnix: Int? = 1000,
        toUnix: Int? = 2000,
        connection: MqttSseExplainerConnection = .live,
        stream: MqttSseExplainerStreamSnapshot = .idle
    ) -> MqttSseExplainerInput {
        MqttSseExplainerInput(
            availability: .resolved(enabled: true),
            fromUnix: fromUnix,
            toUnix: toUnix,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyMqttSseExplainerTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIMqttSseInspectorExplanations.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyMqttSseExplainerTelemetry()
        let (model, _) = makeModel(
            MqttSseExplainerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyMqttSseExplainerTelemetry()
        let (model, source) = makeModel(
            MqttSseExplainerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIMqttSseInspectorExplanations.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIMqttSseInspectorExplanations.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(MqttSseExplainerInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: MqttSseExplainerStreamSnapshot(state: .done, text: "Broker connected.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Broker connected.")
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

    func testExplainDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.explain()
        XCTAssertEqual(source.explainCount, 1)
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
        XCTAssertEqual(AIMqttSseInspectorExplanations.surfaceSlug, "AIMqttSseInspectorExplanations")
    }
}

// MARK: - Accessibility summary

@MainActor final class MqttSseExplainerAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            MqttSseExplainerAccessibility.actionLabel(ask: "Ask Helix", context: "Explain streams"),
            "Ask Helix · Explain streams"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            MqttSseExplainerAccessibility.outputLabel("MQTT / SSE stream explanation", "Broker connected."),
            "MQTT / SSE stream explanation: Broker connected."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMqttSseExplainerTelemetry: MqttSseExplainerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
