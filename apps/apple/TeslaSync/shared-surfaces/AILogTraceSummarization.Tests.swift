//
//  AILogTraceSummarization.Tests.swift
//  TeslaSync — P4 shared surface · 0026 · AILogTraceSummarization (Apple)
//
//  Unit coverage for the AILogTraceSummarization surface:
//    • Projection — gated / loading / error / ready, the `canStart = windowAcceptable` rule (incl.
//      the no-window, mis-ordered, and over-24-hour edges), the Ask-Helix label flip, the disabled
//      rule, and every localized `AiOutputPanel` branch (empty / no-window / thinking / prose /
//      error / unknown-error).
//    • State holder — `LogTraceSummaryModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the summarize / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryLogTraceSummarySource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// A valid in-scope window: a 30-minute span (1800 s ≤ the 24-hour cap) of Unix seconds.
private let windowFrom = 1_717_000_000
private let windowTo = 1_717_001_800

// MARK: - Projection: phases

@MainActor final class LogTraceSummaryProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = LogTraceSummaryProjection.resolve(
            LogTraceSummaryInput(availability: .resolved(enabled: false), fromUnix: windowFrom, toUnix: windowTo),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = LogTraceSummaryProjection.resolve(
            LogTraceSummaryInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = LogTraceSummaryProjection.resolve(
            LogTraceSummaryInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = LogTraceSummaryProjection.resolve(
            LogTraceSummaryInput(availability: .resolved(enabled: true), fromUnix: windowFrom, toUnix: windowTo),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class LogTraceSummaryProjectionReadyTests: XCTestCase {
    private func ready(
        fromUnix: Int? = windowFrom,
        toUnix: Int? = windowTo,
        stream: LogTraceSummaryStreamSnapshot = .idle
    ) -> LogTraceSummaryReady {
        let resolved = LogTraceSummaryProjection.resolve(
            LogTraceSummaryInput(
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
        XCTAssertEqual(card.title, "Helix log/trace summary")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("3-6 sentence factual summary"))
        XCTAssertTrue(card.description.contains("redacted envelope"))
        XCTAssertTrue(card.description.contains("never speculates about root cause"))
        XCTAssertEqual(card.buttonContext, "Summarize")
    }

    func testCanStartRequiresAcceptableWindow() {
        // Parity: web `canStart={windowAcceptable}` — present, ordered, within the 24-hour cap.
        XCTAssertTrue(ready().canStart)
        XCTAssertFalse(ready(fromUnix: nil, toUnix: nil).canStart)
        XCTAssertFalse(ready(fromUnix: windowFrom, toUnix: nil).canStart)
        XCTAssertFalse(ready(fromUnix: windowTo, toUnix: windowFrom).canStart) // mis-ordered
        XCTAssertFalse(ready(fromUnix: 0, toUnix: windowTo).canStart) // fromUnix not > 0
        XCTAssertFalse(ready(fromUnix: windowFrom, toUnix: windowFrom + 24 * 60 * 60 + 1).canStart) // > 24h
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: LogTraceSummaryStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutWindowOrWhileStreaming() {
        XCTAssertTrue(ready(fromUnix: nil, toUnix: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(stream: LogTraceSummaryStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Summarize")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class LogTraceSummaryProjectionOutputTests: XCTestCase {
    private func output(
        fromUnix: Int? = windowFrom,
        toUnix: Int? = windowTo,
        stream: LogTraceSummaryStreamSnapshot
    ) -> LogTraceSummaryResolvedOutput {
        LogTraceSummaryProjection.resolve(
            LogTraceSummaryInput(
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
        XCTAssertTrue(out.body.contains("No summary yet"))
    }

    func testNoWindowHintWhenIdleWithoutWindow() {
        let out = output(fromUnix: nil, toUnix: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Waiting for a log and trace window"))
    }

    func testNoWindowHintWhenWindowTooLarge() {
        // canStart is false for a > 24-hour window → the no-window hint, not the idle hint.
        let out = output(fromUnix: windowFrom, toUnix: windowFrom + 24 * 60 * 60 + 1, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Waiting for a log and trace window"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: LogTraceSummaryStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(
            stream: LogTraceSummaryStreamSnapshot(state: .streaming, text: "No errors in the window.")
        )
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "No errors in the window.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: LogTraceSummaryStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: LogTraceSummaryStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class LogTraceSummaryModelTests: XCTestCase {
    private func makeModel(
        _ input: LogTraceSummaryInput,
        telemetry: LogTraceSummaryTelemetry = OSLogLogTraceSummaryTelemetry()
    ) -> (LogTraceSummaryModel, InMemoryLogTraceSummarySource) {
        let source = InMemoryLogTraceSummarySource(initial: input)
        let model = LogTraceSummaryModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        fromUnix: Int? = windowFrom,
        toUnix: Int? = windowTo,
        connection: LogTraceSummaryConnection = .live,
        stream: LogTraceSummaryStreamSnapshot = .idle
    ) -> LogTraceSummaryInput {
        LogTraceSummaryInput(
            availability: .resolved(enabled: true),
            fromUnix: fromUnix,
            toUnix: toUnix,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyLogTraceSummaryTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AILogTraceSummarization.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyLogTraceSummaryTelemetry()
        let (model, _) = makeModel(
            LogTraceSummaryInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyLogTraceSummaryTelemetry()
        let (model, source) = makeModel(
            LogTraceSummaryInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AILogTraceSummarization.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AILogTraceSummarization.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(LogTraceSummaryInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: LogTraceSummaryStreamSnapshot(state: .done, text: "All quiet.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "All quiet.")
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
        XCTAssertEqual(AILogTraceSummarization.surfaceSlug, "AILogTraceSummarization")
    }
}

// MARK: - Accessibility summary

@MainActor final class LogTraceSummaryAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            LogTraceSummaryAccessibility.actionLabel(ask: "Ask Helix", context: "Summarize"),
            "Ask Helix · Summarize"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            LogTraceSummaryAccessibility.outputLabel("Log and trace summary", "All quiet."),
            "Log and trace summary: All quiet."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLogTraceSummaryTelemetry: LogTraceSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
