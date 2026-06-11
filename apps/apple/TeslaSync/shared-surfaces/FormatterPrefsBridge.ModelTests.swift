//
//  FormatterPrefsBridge.ModelTests.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  Behavioural coverage for the `@Observable` state-holder: start-idempotence + once-only `view.opened`
//  telemetry (P1/S11), the verbatim web apply-globals de-dupe (write once on change, skip a redundant
//  re-emit, skip when the resolved value already equals the current global, but DO apply the resolved
//  defaults), the no-write-in-chrome-phases rule, the settings-changed broadcast → refresh wiring (web
//  `qc.invalidateQueries(['settings'])`), the stale rising-edge one-shot auto-refresh + the offline
//  no-refresh rule, and the stop wiring. Every dependency is an injected double; nothing touches the
//  shared globals store or the real NotificationCenter.
//

import os
import XCTest
@testable import TeslaSync

// MARK: - Spy telemetry

private final class SpyFormatterPrefsBridgeTelemetry: FormatterPrefsBridgeTelemetry {
    private let opens = OSAllocatedUnfairLock<[String]>(initialState: [])

    func viewOpened(surface: String) {
        opens.withLock { $0.append(surface) }
    }

    var openedSurfaces: [String] {
        opens.withLock { $0 }
    }
}

// MARK: - Fixtures

private enum ModelFixture {
    static func resolved(
        locale: String?,
        precision: Int?,
        connection: FormatterPrefsBridgeConnection = .live
    ) -> FormatterPrefsBridgeInput {
        FormatterPrefsBridgeInput(
            status: .resolved,
            settings: FormatterPrefsBridgeSettings(locale: locale, decimalPrecision: precision),
            connection: connection
        )
    }
}

@MainActor
private func makeModel(
    initial: FormatterPrefsBridgeInput,
    applier: RecordingFormatterPrefsBridgeApplier,
    broadcast: ManualFormatterPrefsBridgeBroadcast = ManualFormatterPrefsBridgeBroadcast(),
    telemetry: SpyFormatterPrefsBridgeTelemetry = SpyFormatterPrefsBridgeTelemetry()
) -> (FormatterPrefsBridgeModel, InMemoryFormatterPrefsBridgeSource) {
    let source = InMemoryFormatterPrefsBridgeSource(initial: initial)
    let model = FormatterPrefsBridgeModel(
        source: source,
        applier: applier,
        broadcast: broadcast,
        telemetry: telemetry,
        strings: { _, fallback in fallback }
    )
    return (model, source)
}

// MARK: - Lifecycle + telemetry

@MainActor
final class FormatterPrefsBridgeModelLifecycleTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyFormatterPrefsBridgeTelemetry()
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3),
            applier: RecordingFormatterPrefsBridgeApplier(),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.openedSurfaces, ["FormatterPrefsBridge"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopStopsSourceAndBroadcast() {
        let broadcast = ManualFormatterPrefsBridgeBroadcast()
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3),
            applier: RecordingFormatterPrefsBridgeApplier(),
            broadcast: broadcast
        )
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(broadcast.startCount, 1)
        XCTAssertEqual(broadcast.stopCount, 1)
    }

    func testExposesResolvedPhaseAndConnection() {
        let (model, _) = makeModel(
            initial: ModelFixture.resolved(locale: "fr-FR", precision: 0, connection: .stale),
            applier: RecordingFormatterPrefsBridgeApplier()
        )
        model.start()
        XCTAssertEqual(model.phase, .applied(FormatterPrefsBridgeApplied(locale: "fr-FR", precision: 0)))
        XCTAssertEqual(model.applied, FormatterPrefsBridgeApplied(locale: "fr-FR", precision: 0))
        XCTAssertEqual(model.connection, .stale)
    }
}

// MARK: - Apply formatter globals (web de-dupe)

@MainActor
final class FormatterPrefsBridgeModelApplyTests: XCTestCase {
    func testAppliesResolvedValuesOnceAndSkipsRedundantReEmit() {
        let applier = RecordingFormatterPrefsBridgeApplier(locale: "en-US", precision: 2)
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3),
            applier: applier
        )
        model.start()
        // Re-emit the identical snapshot — the bridge must NOT re-write.
        source.push(ModelFixture.resolved(locale: "de-DE", precision: 3))
        XCTAssertEqual(applier.appliedLocales, ["de-DE"])
        XCTAssertEqual(applier.appliedPrecisions, [3])
    }

    func testSkipsWriteWhenResolvedAlreadyEqualsCurrentGlobal() {
        // The current globals already hold the resolved values → first resolve only records, no write.
        let applier = RecordingFormatterPrefsBridgeApplier(locale: "de-DE", precision: 3)
        let (model, _) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3),
            applier: applier
        )
        model.start()
        XCTAssertTrue(applier.appliedLocales.isEmpty)
        XCTAssertTrue(applier.appliedPrecisions.isEmpty)
    }

    func testAppliesResolvedDefaultsWhenNothingConfigured() {
        // Web applies the resolved fallbacks (en-US / 2) even with nothing set — the usingDefaults path.
        let applier = RecordingFormatterPrefsBridgeApplier(locale: "de-DE", precision: 9)
        let (model, _) = makeModel(
            initial: ModelFixture.resolved(locale: nil, precision: nil),
            applier: applier
        )
        model.start()
        XCTAssertEqual(applier.appliedLocales, ["en-US"])
        XCTAssertEqual(applier.appliedPrecisions, [2])
    }

    func testWritesNewValueWhenSettingsChange() {
        let applier = RecordingFormatterPrefsBridgeApplier(locale: "en-US", precision: 2)
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3),
            applier: applier
        )
        model.start()
        source.push(ModelFixture.resolved(locale: "ja-JP", precision: 1))
        XCTAssertEqual(applier.appliedLocales, ["de-DE", "ja-JP"])
        XCTAssertEqual(applier.appliedPrecisions, [3, 1])
    }

    func testDoesNotWriteInLoadingOrFailedPhases() {
        let applier = RecordingFormatterPrefsBridgeApplier(locale: "en-US", precision: 2)
        let (model, source) = makeModel(
            initial: FormatterPrefsBridgeInput(status: .loading),
            applier: applier
        )
        model.start()
        source.push(FormatterPrefsBridgeInput(status: .failed))
        XCTAssertTrue(applier.appliedLocales.isEmpty)
        XCTAssertTrue(applier.appliedPrecisions.isEmpty)
    }
}

// MARK: - Broadcast + freshness

@MainActor
final class FormatterPrefsBridgeModelSignalTests: XCTestCase {
    func testSettingsChangedBroadcastTriggersRefresh() {
        let broadcast = ManualFormatterPrefsBridgeBroadcast()
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3),
            applier: RecordingFormatterPrefsBridgeApplier(),
            broadcast: broadcast
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        broadcast.fire()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleRisingEdgeAutoRefreshesOnce() {
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3, connection: .live),
            applier: RecordingFormatterPrefsBridgeApplier()
        )
        model.start()
        source.push(ModelFixture.resolved(locale: "de-DE", precision: 3, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // Still stale → no second auto-refresh.
        source.push(ModelFixture.resolved(locale: "de-DE", precision: 3, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(
            initial: ModelFixture.resolved(locale: "de-DE", precision: 3, connection: .live),
            applier: RecordingFormatterPrefsBridgeApplier()
        )
        model.start()
        source.push(ModelFixture.resolved(locale: "de-DE", precision: 3, connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.offline)
    }
}
