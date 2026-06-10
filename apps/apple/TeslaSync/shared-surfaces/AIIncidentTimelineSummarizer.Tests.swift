//
//  AIIncidentTimelineSummarizer.Tests.swift
//  TeslaSync — P4 shared surface · 0022 · AIIncidentTimelineSummarizer (Apple)
//
//  Unit coverage for the AIIncidentTimelineSummarizer surface:
//    • Projection — gated / loading / error / ready, the `canStart = numericIncidentId > 0` rule
//      (incl. the nil / 0 / negative boundaries), the Ask-Helix label flip, the disabled rule, and
//      every localized `AiOutputPanel` branch (empty / no-incident / thinking / prose / error /
//      unknown-error).
//    • State holder — `IncidentSummarizerModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the summarize / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryIncidentSummarizerSource`, and the locale is injected for determinism.
//  In the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class IncidentSummarizerProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = IncidentSummarizerProjection.resolve(
            IncidentSummarizerInput(availability: .resolved(enabled: false), incidentID: 4821),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = IncidentSummarizerProjection.resolve(
            IncidentSummarizerInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = IncidentSummarizerProjection.resolve(
            IncidentSummarizerInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = IncidentSummarizerProjection.resolve(
            IncidentSummarizerInput(availability: .resolved(enabled: true), incidentID: 4821),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class IncidentSummarizerProjectionReadyTests: XCTestCase {
    private func ready(
        incidentID: Int? = 4821,
        stream: IncidentSummarizerStreamSnapshot = .idle
    ) -> IncidentSummarizerReady {
        let resolved = IncidentSummarizerProjection.resolve(
            IncidentSummarizerInput(
                availability: .resolved(enabled: true),
                incidentID: incidentID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Helix timeline summary")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("factual summary"))
        XCTAssertTrue(card.description.contains("deterministic envelope"))
        XCTAssertEqual(card.buttonContext, "Summarize")
    }

    func testCanStartRequiresPositiveIncidentID() {
        // Web `haveIncident = Number.isFinite(numericIncidentId) && numericIncidentId > 0`.
        XCTAssertTrue(ready(incidentID: 4821).canStart)
        XCTAssertTrue(ready(incidentID: 1).canStart)
        XCTAssertFalse(ready(incidentID: nil).canStart)
        XCTAssertFalse(ready(incidentID: 0).canStart)
        XCTAssertFalse(ready(incidentID: -3).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: IncidentSummarizerStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutIncidentOrWhileStreaming() {
        XCTAssertTrue(ready(incidentID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(incidentID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(incidentID: 4821, stream: IncidentSummarizerStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(incidentID: 4821, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Summarize")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class IncidentSummarizerProjectionOutputTests: XCTestCase {
    private func output(
        incidentID: Int? = 4821,
        stream: IncidentSummarizerStreamSnapshot
    ) -> IncidentSummarizerResolvedOutput {
        IncidentSummarizerProjection.resolve(
            IncidentSummarizerInput(
                availability: .resolved(enabled: true),
                incidentID: incidentID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithIncident() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No summary yet"))
    }

    func testNoIncidentHintWhenIdleWithoutIncident() {
        let out = output(incidentID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Open an incident"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: IncidentSummarizerStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: IncidentSummarizerStreamSnapshot(state: .streaming, text: "Resolved at 10:02."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Resolved at 10:02.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: IncidentSummarizerStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: IncidentSummarizerStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class IncidentSummarizerModelTests: XCTestCase {
    private func makeModel(
        _ input: IncidentSummarizerInput,
        telemetry: IncidentSummarizerTelemetry = OSLogIncidentSummarizerTelemetry()
    ) -> (IncidentSummarizerModel, InMemoryIncidentSummarizerSource) {
        let source = InMemoryIncidentSummarizerSource(initial: input)
        let model = IncidentSummarizerModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        incidentID: Int? = 4821,
        connection: IncidentSummarizerConnection = .live,
        stream: IncidentSummarizerStreamSnapshot = .idle
    ) -> IncidentSummarizerInput {
        IncidentSummarizerInput(
            availability: .resolved(enabled: true),
            incidentID: incidentID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyIncidentSummarizerTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIIncidentTimelineSummarizer.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyIncidentSummarizerTelemetry()
        let (model, _) = makeModel(
            IncidentSummarizerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyIncidentSummarizerTelemetry()
        let (model, source) = makeModel(
            IncidentSummarizerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIIncidentTimelineSummarizer.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIIncidentTimelineSummarizer.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(IncidentSummarizerInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: IncidentSummarizerStreamSnapshot(state: .done, text: "Resolved at 10:02.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Resolved at 10:02.")
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

    func testSummarizeDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.summarize()
        XCTAssertEqual(source.summarizeCount, 1)
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
        XCTAssertEqual(AIIncidentTimelineSummarizer.surfaceSlug, "AIIncidentTimelineSummarizer")
    }
}

// MARK: - Accessibility summary

@MainActor final class IncidentSummarizerAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            IncidentSummarizerAccessibility.actionLabel(ask: "Ask Helix", context: "Summarize"),
            "Ask Helix · Summarize"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            IncidentSummarizerAccessibility.outputLabel("Incident timeline summary", "Resolved at 10:02."),
            "Incident timeline summary: Resolved at 10:02."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyIncidentSummarizerTelemetry: IncidentSummarizerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
