//
//  AIDriveCoaching.Tests.swift
//  TeslaSync — P4 shared surface · 0017 · AIDriveCoaching (Apple)
//
//  Unit coverage for the AIDriveCoaching surface:
//    • Projection — gated / loading / error / ready, the `canStart = !!driveId` rule (incl. the
//      nil and empty-string boundaries), the Ask-Helix label flip, the disabled rule, and every
//      localized `AiOutputPanel` branch (empty / no-drive / thinking / prose / error /
//      unknown-error).
//    • State holder — `DriveCoachingModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryDriveCoachingSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class DriveCoachingProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = DriveCoachingProjection.resolve(
            DriveCoachingInput(availability: .resolved(enabled: false), driveID: "4821"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = DriveCoachingProjection.resolve(
            DriveCoachingInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = DriveCoachingProjection.resolve(
            DriveCoachingInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = DriveCoachingProjection.resolve(
            DriveCoachingInput(availability: .resolved(enabled: true), driveID: "4821"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class DriveCoachingProjectionReadyTests: XCTestCase {
    private func ready(
        driveID: String? = "4821",
        stream: DriveCoachingStreamSnapshot = .idle
    ) -> DriveCoachingReady {
        let resolved = DriveCoachingProjection.resolve(
            DriveCoachingInput(
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
        XCTAssertEqual(card.title, "Drive coaching")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("coaching summary"))
        XCTAssertTrue(card.description.contains("per-drive metrics"))
        XCTAssertEqual(card.buttonContext, "Generate coaching")
    }

    func testCanStartRequiresNonEmptyDriveID() {
        // Web `canStart={!!driveId}`.
        XCTAssertTrue(ready(driveID: "4821").canStart)
        XCTAssertFalse(ready(driveID: nil).canStart)
        XCTAssertFalse(ready(driveID: "").canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: DriveCoachingStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutDriveOrWhileStreaming() {
        XCTAssertTrue(ready(driveID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(driveID: "", stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(driveID: "4821", stream: DriveCoachingStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(driveID: "4821", stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Generate coaching")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class DriveCoachingProjectionOutputTests: XCTestCase {
    private func output(
        driveID: String? = "4821",
        stream: DriveCoachingStreamSnapshot
    ) -> DriveCoachingResolvedOutput {
        DriveCoachingProjection.resolve(
            DriveCoachingInput(
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
        XCTAssertTrue(out.body.contains("No coaching yet"))
    }

    func testNoDriveHintWhenIdleWithoutDrive() {
        let out = output(driveID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Open a drive"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: DriveCoachingStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: DriveCoachingStreamSnapshot(state: .streaming, text: "Efficient drive."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Efficient drive.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: DriveCoachingStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: DriveCoachingStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class DriveCoachingModelTests: XCTestCase {
    private func makeModel(
        _ input: DriveCoachingInput,
        telemetry: DriveCoachingTelemetry = OSLogDriveCoachingTelemetry()
    ) -> (DriveCoachingModel, InMemoryDriveCoachingSource) {
        let source = InMemoryDriveCoachingSource(initial: input)
        let model = DriveCoachingModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        driveID: String? = "4821",
        connection: DriveCoachingConnection = .live,
        stream: DriveCoachingStreamSnapshot = .idle
    ) -> DriveCoachingInput {
        DriveCoachingInput(
            availability: .resolved(enabled: true),
            driveID: driveID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDriveCoachingTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIDriveCoaching.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyDriveCoachingTelemetry()
        let (model, _) = makeModel(
            DriveCoachingInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyDriveCoachingTelemetry()
        let (model, source) = makeModel(
            DriveCoachingInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIDriveCoaching.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIDriveCoaching.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(DriveCoachingInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: DriveCoachingStreamSnapshot(state: .done, text: "Efficient drive.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Efficient drive.")
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
        XCTAssertEqual(AIDriveCoaching.surfaceSlug, "AIDriveCoaching")
    }
}

// MARK: - Accessibility summary

@MainActor final class DriveCoachingAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            DriveCoachingAccessibility.actionLabel(ask: "Ask Helix", context: "Generate coaching"),
            "Ask Helix · Generate coaching"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            DriveCoachingAccessibility.outputLabel("Drive coaching narrative", "Efficient drive."),
            "Drive coaching narrative: Efficient drive."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDriveCoachingTelemetry: DriveCoachingTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
