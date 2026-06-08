//
//  LiveControls.Tests.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  Unit coverage for the LiveControls surface:
//    • Counter math — the web `inWindow` / `total` / `outside` / `dual` derivation,
//      the windowCount/totalCount precedence over the legacy bufferCount fallback,
//      the outside clamp, the single-vs-dual label choice, and the empty value.
//    • Window options — the web WINDOW_OPTIONS table (minutes + keyed labels).
//    • Projection — controlled props → display state (+ attached option table).
//    • Render — the parent-query phase ladder (loading / failed / ready).
//    • Format / accessibility — the counter label + tooltip the view speaks.
//    • State holder — model wiring, the P1/S11 view.opened telemetry, the stale
//      rising-edge auto-refresh, and every toolbar command's delegation.
//    • Copy — the catalog key set (incl. the web source keys).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by InMemoryLiveControlsSource.
//

import XCTest
@testable import TeslaSync

/// Localizer that returns the English fallback, so resolution tests are
/// locale-independent.
private let fallbackLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Counter math (web `inWindow` / `total` / `outside` / `dual`)

final class LiveControlsCounterTests: XCTestCase {
    func testDualCountsFromWindowAndTotal() {
        let counter = LiveControlsProjection.counter(windowCount: 12, totalCount: 87, bufferCount: nil)
        XCTAssertEqual(counter.inWindow, 12)
        XCTAssertEqual(counter.total, 87)
        XCTAssertEqual(counter.outside, 75)
        XCTAssertTrue(counter.isDual)
        XCTAssertTrue(counter.prefersDualLabel)
        XCTAssertFalse(counter.isEmpty)
    }

    func testNewCountsTakePrecedenceOverLegacyBufferCount() {
        // Web `windowCount ?? bufferCount` / `totalCount ?? bufferCount`: the new
        // props win whenever present, even with a legacy scalar also supplied.
        let counter = LiveControlsProjection.counter(windowCount: 12, totalCount: 87, bufferCount: 999)
        XCTAssertEqual(counter.inWindow, 12)
        XCTAssertEqual(counter.total, 87)
    }

    func testLegacyBufferCountDrivesBothScopes() {
        // Web deprecated fallback: a lone scalar feeds both inWindow and total, so
        // outside collapses to 0 and the single-scope "{{n}} buffered" copy wins.
        let counter = LiveControlsProjection.counter(windowCount: nil, totalCount: nil, bufferCount: 34)
        XCTAssertEqual(counter.inWindow, 34)
        XCTAssertEqual(counter.total, 34)
        XCTAssertEqual(counter.outside, 0)
        XCTAssertFalse(counter.isDual)
        XCTAssertFalse(counter.prefersDualLabel)
        XCTAssertFalse(counter.isEmpty)
    }

    func testBufferCountFallsBackPerScopeIndependently() {
        let counter = LiveControlsProjection.counter(windowCount: nil, totalCount: 50, bufferCount: 10)
        XCTAssertEqual(counter.inWindow, 10, "inWindow falls back to bufferCount")
        XCTAssertEqual(counter.total, 50, "total uses the present totalCount")
        XCTAssertEqual(counter.outside, 40)
        XCTAssertTrue(counter.isDual, "a present totalCount makes the counter dual")
    }

    func testOutsideClampsToZero() {
        // inWindow greater than total (web `Math.max(0, total - inWindow)`).
        let counter = LiveControlsProjection.counter(windowCount: 9, totalCount: 4, bufferCount: nil)
        XCTAssertEqual(counter.outside, 0)
        XCTAssertFalse(counter.prefersDualLabel, "outside == 0 falls back to the single label")
    }

    func testDualWithNoOutsidePrefersSingleLabel() {
        let counter = LiveControlsProjection.counter(windowCount: 87, totalCount: 87, bufferCount: nil)
        XCTAssertTrue(counter.isDual)
        XCTAssertEqual(counter.outside, 0)
        XCTAssertFalse(counter.prefersDualLabel)
    }

    func testEmptyWhenNothingBuffered() {
        let counter = LiveControlsProjection.counter(windowCount: nil, totalCount: nil, bufferCount: nil)
        XCTAssertEqual(counter.inWindow, 0)
        XCTAssertEqual(counter.total, 0)
        XCTAssertFalse(counter.isDual)
        XCTAssertTrue(counter.isEmpty)
    }

    func testZeroDualCountsAreEmpty() {
        let counter = LiveControlsProjection.counter(windowCount: 0, totalCount: 0, bufferCount: nil)
        XCTAssertTrue(counter.isDual)
        XCTAssertTrue(counter.isEmpty)
        XCTAssertFalse(counter.prefersDualLabel)
    }
}

// MARK: - Window options (web `WINDOW_OPTIONS`)

final class LiveControlsWindowOptionsTests: XCTestCase {
    func testOptionMinutesMatchWebOrder() {
        XCTAssertEqual(LiveControlsCopy.windowOptions.map(\.minutes), [5, 10, 30, 120])
    }

    func testOptionIdentityIsMinutes() {
        XCTAssertEqual(LiveControlsCopy.windowOptions.map(\.id), [5, 10, 30, 120])
    }

    func testOptionLabelsResolveToWebLiterals() {
        let labels = LiveControlsCopy.windowOptions.map { $0.label.resolved(fallbackLocalize) }
        XCTAssertEqual(labels, ["5 min", "10 min", "30 min", "2 h"])
    }
}

// MARK: - Projection

final class LiveControlsProjectionTests: XCTestCase {
    func testProjectionMapsControlledProps() {
        let state = LiveControlsState(
            isLive: false,
            windowMinutes: 30,
            canStepPrev: true,
            canStepNext: false,
            windowCount: 12,
            totalCount: 87
        )
        let projection = LiveControlsProjection.make(from: state)
        XCTAssertFalse(projection.isLive)
        XCTAssertTrue(projection.canStepPrev)
        XCTAssertFalse(projection.canStepNext)
        XCTAssertEqual(projection.windowMinutes, 30)
        XCTAssertEqual(projection.counter.inWindow, 12)
        XCTAssertEqual(projection.counter.total, 87)
    }

    func testProjectionAttachesCanonicalOptions() {
        let projection = LiveControlsProjection.make(
            from: LiveControlsState(isLive: true, windowMinutes: 10)
        )
        XCTAssertEqual(projection.options.map(\.minutes), [5, 10, 30, 120])
    }
}

// MARK: - Render resolution

final class LiveControlsRenderTests: XCTestCase {
    func testLoadingPhase() {
        XCTAssertEqual(LiveControlsModel.render(for: .loading), .loading)
    }

    func testFailedPhase() {
        XCTAssertEqual(LiveControlsModel.render(for: .failed), .failed)
    }

    func testLoadedResolvesToReadyProjection() {
        let state = LiveControlsState(isLive: true, windowMinutes: 10, windowCount: 3, totalCount: 9)
        XCTAssertEqual(
            LiveControlsModel.render(for: .loaded(state)),
            .ready(LiveControlsProjection.make(from: state))
        )
    }

    func testLoadedEmptyStillResolvesToReady() {
        let state = LiveControlsState(isLive: true, windowMinutes: 10, windowCount: 0, totalCount: 0)
        guard case let .ready(projection) = LiveControlsModel.render(for: .loaded(state)) else {
            return XCTFail("empty buffer must still render the controls (ready), never hide them")
        }
        XCTAssertTrue(projection.counter.isEmpty)
    }
}

// MARK: - Format / accessibility copy (what the view speaks)

final class LiveControlsFormatTests: XCTestCase {
    private let single = LiveControlsCopy.buffered.resolved(fallbackLocalize)
    private let dual = LiveControlsCopy.bufferedDual.resolved(fallbackLocalize)
    private let tooltip = LiveControlsCopy.bufferedTooltip.resolved(fallbackLocalize)

    func testSingleScopeCounterLabel() {
        let counter = LiveControlsProjection.counter(windowCount: nil, totalCount: nil, bufferCount: 34)
        let label = LiveControlsFormat.counterLabel(counter: counter, single: single, dual: dual)
        XCTAssertEqual(label, "34 buffered")
    }

    func testDualScopeCounterLabel() {
        let counter = LiveControlsProjection.counter(windowCount: 12, totalCount: 87, bufferCount: nil)
        let label = LiveControlsFormat.counterLabel(counter: counter, single: single, dual: dual)
        XCTAssertEqual(label, "12 in window · 87 in 24 h")
    }

    func testDualWithoutOutsideUsesSingleLabel() {
        let counter = LiveControlsProjection.counter(windowCount: 87, totalCount: 87, bufferCount: nil)
        let label = LiveControlsFormat.counterLabel(counter: counter, single: single, dual: dual)
        XCTAssertEqual(label, "87 buffered")
    }

    func testTooltipLabelInterpolation() {
        let label = LiveControlsFormat.tooltipLabel(format: tooltip, minutes: 10, outside: 75)
        XCTAssertEqual(
            label,
            "Counts inside the 10-minute Window dropdown. 75 more transitions fetched in the last 24 h."
        )
    }

    func testStepButtonAccessibilityCopy() {
        XCTAssertEqual(LiveControlsCopy.stepPrev.resolved(fallbackLocalize), "Step to previous transition")
        XCTAssertEqual(LiveControlsCopy.stepNext.resolved(fallbackLocalize), "Step to next transition")
    }
}

// MARK: - Copy catalog

final class LiveControlsCopyTests: XCTestCase {
    func testCatalogKeysAndFallbacksNonEmpty() {
        XCTAssertFalse(LiveControlsCopy.all.isEmpty)
        for entry in LiveControlsCopy.all {
            XCTAssertFalse(entry.key.isEmpty, "empty key")
            XCTAssertFalse(entry.fallback.isEmpty, "empty fallback for \(entry.key)")
        }
    }

    func testCatalogContainsWebSourceKeys() {
        let keys = Set(LiveControlsCopy.all.map(\.key))
        for expected in [
            "debugger.controls.live",
            "debugger.controls.freeze",
            "debugger.controls.stepPrev",
            "debugger.controls.stepNext",
            "debugger.controls.window",
            "debugger.controls.clear",
            "debugger.controls.buffered",
            "debugger.controls.bufferedDual",
            "debugger.controls.bufferedTooltip"
        ] {
            XCTAssertTrue(keys.contains(expected), "missing web source key \(expected)")
        }
    }

    func testCatalogKeysAreUnique() {
        let keys = LiveControlsCopy.all.map(\.key)
        XCTAssertEqual(keys.count, Set(keys).count, "duplicate catalog key")
    }
}

// MARK: - State holder

@MainActor
final class LiveControlsModelTests: XCTestCase {
    private func sampleState() -> LiveControlsState {
        LiveControlsState(isLive: true, windowMinutes: 10, windowCount: 3, totalCount: 9)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let state = sampleState()
        let source = InMemoryLiveControlsSource(
            initial: LiveControlsInput(phase: .loaded(state), isOffline: true)
        )
        let spy = SpyLiveControlsTelemetry()
        let model = LiveControlsModel(source: source, telemetry: spy)

        model.start()
        model.start()

        XCTAssertEqual(model.render, .ready(LiveControlsProjection.make(from: state)))
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(spy.opened, ["LiveControls"])
    }

    func testPushUpdatesRenderAndFlags() {
        let source = InMemoryLiveControlsSource()
        let model = LiveControlsModel(source: source, telemetry: SpyLiveControlsTelemetry())
        model.start()

        source.push(LiveControlsInput(phase: .failed))
        XCTAssertEqual(model.render, .failed)

        let state = sampleState()
        source.push(LiveControlsInput(phase: .loaded(state)))
        XCTAssertEqual(model.render, .ready(LiveControlsProjection.make(from: state)))
    }

    func testStaleRisingEdgeAutoRefreshesOncePerEdge() {
        let source = InMemoryLiveControlsSource()
        let model = LiveControlsModel(source: source, telemetry: SpyLiveControlsTelemetry())
        model.start()
        let loaded = LiveControlsInput(phase: .loaded(sampleState()), isStale: false)

        source.push(loaded)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LiveControlsInput(phase: .loaded(sampleState()), isStale: true))
        XCTAssertEqual(source.refreshCount, 1, "rising edge should auto-refresh")
        XCTAssertTrue(model.isStale)

        source.push(LiveControlsInput(phase: .loaded(sampleState()), isStale: true))
        XCTAssertEqual(source.refreshCount, 1, "staying stale must not re-refresh")

        source.push(loaded)
        source.push(LiveControlsInput(phase: .loaded(sampleState()), isStale: true))
        XCTAssertEqual(source.refreshCount, 2, "a new rising edge refreshes again")
    }

    func testToggleLiveDelegatesBothDirections() {
        let source = InMemoryLiveControlsSource()
        let model = LiveControlsModel(source: source, telemetry: SpyLiveControlsTelemetry())
        model.start()

        model.toggleLive(true)
        model.toggleLive(false)
        XCTAssertEqual(source.toggledLive, [true, false])
    }

    func testStepAndWindowAndClearDelegate() {
        let source = InMemoryLiveControlsSource()
        let model = LiveControlsModel(source: source, telemetry: SpyLiveControlsTelemetry())
        model.start()

        model.stepPrev()
        model.stepNext()
        model.stepNext()
        model.changeWindow(30)
        model.clearBuffer()

        XCTAssertEqual(source.stepPrevCount, 1)
        XCTAssertEqual(source.stepNextCount, 2)
        XCTAssertEqual(source.windowChanges, [30])
        XCTAssertEqual(source.clearCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let source = InMemoryLiveControlsSource()
        let model = LiveControlsModel(source: source, telemetry: SpyLiveControlsTelemetry())
        model.start()

        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)

        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

/// Telemetry spy recording the surfaces opened, thread-safe for the `Sendable`
/// protocol requirement.
final class SpyLiveControlsTelemetry: LiveControlsTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var opened: [String] {
        lock.withLock { storage }
    }

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }
}
