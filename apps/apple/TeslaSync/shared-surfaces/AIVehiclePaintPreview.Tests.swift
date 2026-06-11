//
//  AIVehiclePaintPreview.Tests.swift
//  TeslaSync — P4 shared surface · 0058 · AIVehiclePaintPreview (Apple)
//
//  Unit coverage for the AIVehiclePaintPreview surface: the projection (gated / loading / error /
//  ready, the `canStart = numericVehicleId > 0` rule across the vehicle-id boundaries, the header
//  `emptyHint`, the Ask-Helix label flip + disabled rule, and every localized `AiOutputPanel`
//  branch), the state holder (wiring, deferred `view.opened` telemetry, stale one-shot auto-refresh,
//  and the preview / cancel / refresh / stop delegation), and the accessibility labels. No network,
//  no real store: the model is driven by `InMemoryPaintPreviewSource` with an injected locale.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

/// A vehicle in scope: a positive id (the handler validates vehicleID > 0).
private let scopeVehicle = 7

// MARK: - Projection: phases

@MainActor final class PaintPreviewProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = PaintPreviewProjection.resolve(
            PaintPreviewInput(availability: .resolved(enabled: false), vehicleID: scopeVehicle),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = PaintPreviewProjection.resolve(
            PaintPreviewInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = PaintPreviewProjection.resolve(
            PaintPreviewInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = PaintPreviewProjection.resolve(
            PaintPreviewInput(availability: .resolved(enabled: true), vehicleID: scopeVehicle),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class PaintPreviewProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = scopeVehicle,
        styleHint: String? = nil,
        stream: PaintPreviewStreamSnapshot = .idle
    ) -> PaintPreviewReady {
        let resolved = PaintPreviewProjection.resolve(
            PaintPreviewInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                styleHint: styleHint,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Draft a Helix paint preview")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("propose-only paint-color image prompt"))
        XCTAssertTrue(card.description.contains("redacted vehicle context"))
        XCTAssertTrue(card.description.contains("never applied automatically"))
        XCTAssertTrue(card.description.contains("existing Color setting"))
        XCTAssertEqual(card.buttonContext, "Preview paint color")
    }

    func testCanStartRequiresPositiveVehicle() {
        // Web `haveInputs = numericVehicleId > 0`.
        XCTAssertTrue(ready(vehicleID: scopeVehicle).canStart)
        XCTAssertTrue(ready(vehicleID: 1).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
        XCTAssertFalse(ready(vehicleID: 0).canStart)
        XCTAssertFalse(ready(vehicleID: -3).canStart)
    }

    func testCanStartIgnoresStyleHint() {
        // The optional style hint never gates the button.
        XCTAssertTrue(ready(vehicleID: scopeVehicle, styleHint: nil).canStart)
        XCTAssertTrue(ready(vehicleID: scopeVehicle, styleHint: "studio").canStart)
        XCTAssertFalse(ready(vehicleID: nil, styleHint: "studio").canStart)
    }

    func testVehicleHintShownOnlyWhenNoVehicle() {
        // Web `emptyHint={haveInputs ? undefined : t('…noVehicleHint', 'Open a vehicle detail page to
        // enable Helix.')}`.
        XCTAssertNil(ready(vehicleID: scopeVehicle).vehicleHint)
        XCTAssertEqual(
            ready(vehicleID: nil).vehicleHint,
            "Open a vehicle detail page to enable Helix."
        )
        XCTAssertEqual(
            ready(vehicleID: 0).vehicleHint,
            "Open a vehicle detail page to enable Helix."
        )
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: PaintPreviewStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(stream: PaintPreviewStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Preview paint color")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class PaintPreviewProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = scopeVehicle,
        stream: PaintPreviewStreamSnapshot
    ) -> PaintPreviewResolvedOutput {
        PaintPreviewProjection.resolve(
            PaintPreviewInput(
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
        XCTAssertTrue(out.body.contains("No preview yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Open a vehicle detail page"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: PaintPreviewStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: PaintPreviewStreamSnapshot(state: .streaming, text: "A studio render."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "A studio render.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: PaintPreviewStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: PaintPreviewStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class PaintPreviewModelTests: XCTestCase {
    private func makeModel(
        _ input: PaintPreviewInput,
        telemetry: PaintPreviewTelemetry = OSLogPaintPreviewTelemetry()
    ) -> (PaintPreviewModel, InMemoryPaintPreviewSource) {
        let source = InMemoryPaintPreviewSource(initial: input)
        let model = PaintPreviewModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = scopeVehicle,
        connection: PaintPreviewConnection = .live,
        stream: PaintPreviewStreamSnapshot = .idle
    ) -> PaintPreviewInput {
        PaintPreviewInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyPaintPreviewTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIVehiclePaintPreview.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyPaintPreviewTelemetry()
        let (model, _) = makeModel(
            PaintPreviewInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyPaintPreviewTelemetry()
        let (model, source) = makeModel(
            PaintPreviewInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIVehiclePaintPreview.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIVehiclePaintPreview.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(PaintPreviewInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: PaintPreviewStreamSnapshot(state: .done, text: "Deep blue.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Deep blue.")
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

    func testPreviewDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.preview()
        XCTAssertEqual(source.previewCount, 1)
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
        XCTAssertEqual(AIVehiclePaintPreview.surfaceSlug, "AIVehiclePaintPreview")
    }
}

// MARK: - Accessibility summary

@MainActor final class PaintPreviewAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            PaintPreviewAccessibility.actionLabel(ask: "Ask Helix", context: "Preview paint color"),
            "Ask Helix · Preview paint color"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            PaintPreviewAccessibility.outputLabel("Paint preview prompt", "Deep blue."),
            "Paint preview prompt: Deep blue."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPaintPreviewTelemetry: PaintPreviewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
