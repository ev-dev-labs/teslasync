//
//  AISoftwareUpdateChangelogSummarizer.Tests.swift
//  TeslaSync — P4 shared surface · 0048 · AISoftwareUpdateChangelogSummarizer (Apple)
//
//  Unit coverage for the AISoftwareUpdateChangelogSummarizer surface:
//    • Projection — gated / loading / error / ready, the `canStart = numericVehicleId > 0` rule
//      (incl. the nil / 0 / negative boundaries), the header empty-hint flip (web `emptyHint`), the
//      Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel` branch (empty /
//      no-vehicle / thinking / prose / error / unknown-error).
//    • State holder — `SoftwareUpdateSummarizerModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the summarize /
//      cancel / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemorySoftwareUpdateSummarizerSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class SoftwareUpdateSummarizerProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(availability: .resolved(enabled: false), vehicleID: 42),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(availability: .resolved(enabled: true), vehicleID: 42),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class SoftwareUpdateSummarizerProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 42,
        stream: SoftwareUpdateSummarizerStreamSnapshot = .idle
    ) -> SoftwareUpdateSummarizerReady {
        let resolved = SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Summarize my software update history")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("firmware update history"))
        XCTAssertTrue(card.description.contains("never invents firmware versions"))
        XCTAssertEqual(card.buttonContext, "Summarize updates")
    }

    func testCanStartRequiresPositiveVehicleID() {
        // Web `haveInputs = numericVehicleId > 0`.
        XCTAssertTrue(ready(vehicleID: 42).canStart)
        XCTAssertTrue(ready(vehicleID: 1).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
        XCTAssertFalse(ready(vehicleID: 0).canStart)
        XCTAssertFalse(ready(vehicleID: -3).canStart)
    }

    func testEmptyHintShownOnlyWhenNoVehicle() {
        // Web `emptyHint = haveInputs ? undefined : 'Pick a vehicle above to enable Helix.'`.
        XCTAssertNil(ready(vehicleID: 42).emptyHint)
        XCTAssertEqual(ready(vehicleID: nil).emptyHint, "Pick a vehicle above to enable Helix.")
        XCTAssertEqual(ready(vehicleID: 0).emptyHint, "Pick a vehicle above to enable Helix.")
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: SoftwareUpdateSummarizerStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(vehicleID: 42, stream: SoftwareUpdateSummarizerStreamSnapshot(state: .streaming))
                .action.isDisabled
        )
        XCTAssertFalse(ready(vehicleID: 42, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Summarize updates")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class SoftwareUpdateSummarizerProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 42,
        stream: SoftwareUpdateSummarizerStreamSnapshot
    ) -> SoftwareUpdateSummarizerResolvedOutput {
        SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithVehicle() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No summary yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Pick a vehicle above"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: SoftwareUpdateSummarizerStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(
            stream: SoftwareUpdateSummarizerStreamSnapshot(state: .streaming, text: "On 2024.20.7.")
        )
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "On 2024.20.7.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(
            stream: SoftwareUpdateSummarizerStreamSnapshot(state: .error, text: "", error: "stream_http_429")
        )
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(
            stream: SoftwareUpdateSummarizerStreamSnapshot(state: .error, text: "", error: nil)
        )
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class SoftwareUpdateSummarizerModelTests: XCTestCase {
    private func makeModel(
        _ input: SoftwareUpdateSummarizerInput,
        telemetry: SoftwareUpdateSummarizerTelemetry = OSLogSoftwareUpdateSummarizerTelemetry()
    ) -> (SoftwareUpdateSummarizerModel, InMemorySoftwareUpdateSummarizerSource) {
        let source = InMemorySoftwareUpdateSummarizerSource(initial: input)
        let model = SoftwareUpdateSummarizerModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 42,
        connection: SoftwareUpdateSummarizerConnection = .live,
        stream: SoftwareUpdateSummarizerStreamSnapshot = .idle
    ) -> SoftwareUpdateSummarizerInput {
        SoftwareUpdateSummarizerInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySoftwareUpdateSummarizerTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AISoftwareUpdateChangelogSummarizer.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpySoftwareUpdateSummarizerTelemetry()
        let (model, _) = makeModel(
            SoftwareUpdateSummarizerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpySoftwareUpdateSummarizerTelemetry()
        let (model, source) = makeModel(
            SoftwareUpdateSummarizerInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AISoftwareUpdateChangelogSummarizer.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AISoftwareUpdateChangelogSummarizer.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SoftwareUpdateSummarizerInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: SoftwareUpdateSummarizerStreamSnapshot(state: .done, text: "On 2024.20.7.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "On 2024.20.7.")
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
        XCTAssertEqual(
            AISoftwareUpdateChangelogSummarizer.surfaceSlug,
            "AISoftwareUpdateChangelogSummarizer"
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class SoftwareUpdateSummarizerAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerAccessibility.actionLabel(ask: "Ask Helix", context: "Summarize updates"),
            "Ask Helix · Summarize updates"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            SoftwareUpdateSummarizerAccessibility.outputLabel(
                "Software update history summary",
                "On 2024.20.7."
            ),
            "Software update history summary: On 2024.20.7."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySoftwareUpdateSummarizerTelemetry: SoftwareUpdateSummarizerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
