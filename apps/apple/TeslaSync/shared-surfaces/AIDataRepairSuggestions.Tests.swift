//
//  AIDataRepairSuggestions.Tests.swift
//  TeslaSync — P4 shared surface · 0015 · AIDataRepairSuggestions (Apple)
//
//  Unit coverage for the AIDataRepairSuggestions surface:
//    • Projection — gated / loading / error / ready, the `canStart = state != streaming` rule, the
//      Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel` branch
//      (empty / thinking / prose / error / unknown-error).
//    • State holder — `DataRepairSuggestionsModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the
//      generate / cancel / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryDataRepairSuggestionsSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class DataRepairProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = DataRepairSuggestionsProjection.resolve(
            DataRepairSuggestionsInput(availability: .resolved(enabled: false)),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = DataRepairSuggestionsProjection.resolve(
            DataRepairSuggestionsInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = DataRepairSuggestionsProjection.resolve(
            DataRepairSuggestionsInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = DataRepairSuggestionsProjection.resolve(
            DataRepairSuggestionsInput(availability: .resolved(enabled: true)),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class DataRepairProjectionReadyTests: XCTestCase {
    private func ready(stream: DataRepairStreamSnapshot = .idle) -> DataRepairReady {
        let resolved = DataRepairSuggestionsProjection.resolve(
            DataRepairSuggestionsInput(availability: .resolved(enabled: true), stream: stream),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Helix repair suggestions")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("typed repair plan"))
        XCTAssertTrue(card.description.contains("The LLM never writes"))
        XCTAssertTrue(card.description.contains("Save / Close / Discard"))
        XCTAssertEqual(card.buttonContext, "Draft repair plan")
    }

    func testCanStartIsTrueWhenNotStreaming() {
        XCTAssertTrue(ready(stream: .idle).canStart)
        XCTAssertTrue(ready(stream: DataRepairStreamSnapshot(state: .done, text: "x")).canStart)
        XCTAssertTrue(ready(stream: DataRepairStreamSnapshot(state: .error, error: "e")).canStart)
    }

    func testCanStartIsFalseWhileStreaming() {
        XCTAssertFalse(ready(stream: DataRepairStreamSnapshot(state: .streaming)).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: DataRepairStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledOnlyWhileStreaming() {
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
        XCTAssertFalse(ready(stream: DataRepairStreamSnapshot(state: .done, text: "x")).action.isDisabled)
        XCTAssertFalse(ready(stream: DataRepairStreamSnapshot(state: .error, error: "e")).action.isDisabled)
        XCTAssertTrue(ready(stream: DataRepairStreamSnapshot(state: .streaming)).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Draft repair plan")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class DataRepairProjectionOutputTests: XCTestCase {
    private func output(stream: DataRepairStreamSnapshot) -> DataRepairResolvedOutput {
        DataRepairSuggestionsProjection.resolve(
            DataRepairSuggestionsInput(availability: .resolved(enabled: true), stream: stream),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdle() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No repair plan yet"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: DataRepairStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: DataRepairStreamSnapshot(state: .streaming, text: "Close session #4821."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Close session #4821.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: DataRepairStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: DataRepairStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class DataRepairModelTests: XCTestCase {
    private func makeModel(
        _ input: DataRepairSuggestionsInput,
        telemetry: DataRepairSuggestionsTelemetry = OSLogDataRepairTelemetry()
    ) -> (DataRepairSuggestionsModel, InMemoryDataRepairSuggestionsSource) {
        let source = InMemoryDataRepairSuggestionsSource(initial: input)
        let model = DataRepairSuggestionsModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        connection: DataRepairConnection = .live,
        stream: DataRepairStreamSnapshot = .idle
    ) -> DataRepairSuggestionsInput {
        DataRepairSuggestionsInput(
            availability: .resolved(enabled: true),
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDataRepairTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIDataRepairSuggestions.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyDataRepairTelemetry()
        let (model, _) = makeModel(
            DataRepairSuggestionsInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyDataRepairTelemetry()
        let (model, source) = makeModel(
            DataRepairSuggestionsInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIDataRepairSuggestions.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIDataRepairSuggestions.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(DataRepairSuggestionsInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: DataRepairStreamSnapshot(state: .done, text: "Plan ready.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Plan ready.")
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
        XCTAssertEqual(AIDataRepairSuggestions.surfaceSlug, "AIDataRepairSuggestions")
    }
}

// MARK: - Accessibility summary

@MainActor final class DataRepairAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            DataRepairAccessibility.actionLabel(ask: "Ask Helix", context: "Draft repair plan"),
            "Ask Helix · Draft repair plan"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            DataRepairAccessibility.outputLabel("Helix repair suggestions", "Plan ready."),
            "Helix repair suggestions: Plan ready."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDataRepairTelemetry: DataRepairSuggestionsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
