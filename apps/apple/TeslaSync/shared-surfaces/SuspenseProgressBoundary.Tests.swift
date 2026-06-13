//
//  SuspenseProgressBoundary.Tests.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  Coverage for the SuspenseProgressBoundary surface:
//    • Reducer — the verbatim port of the web `globalProgress` math: the first-activation jump, the
//      asymptotic trickle (advance shape + the 80 % cap), concurrent stacking, the idempotent stop floor,
//      and the `NaN` guard the web omits. The per-phase readings are the deterministic state coverage.
//    • Meta — the diagnostics slug, the i18n key, the trickle constants, and the whole-percent
//      accessibility value (rounding + 0…100 clamp + non-finite guard).
//    • Phase — readiness → loading / resolved mapping (the web Suspense fallback / resolved branches).
//    • Controller — start activation + initial jump, concurrent stacking, snap-back on the last stop,
//      stop idempotence, the reducer-driven `advance`, the idle no-op, and `reset`.
//    • Model — the once-only `view.opened` telemetry, the loading ⇄ progress bridge open / close across
//      appear / resolve / re-suspend / disappear, and that the bridge never double-counts.
//    • Views — every public surface + the container compose in each phase (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store; each
//  assertion reads the pure reducer / meta / model / controller directly. Controllers are created with a
//  very large trickle interval so the background ticker never fires mid-test — the trickle is asserted by
//  driving `advance()` explicitly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Reducer (web `globalProgress` start / trickle / stop math)

final class SuspenseProgressReducerTests: XCTestCase {
    func testStartedFromIdleJumpsToInitial() {
        let next = SuspenseProgressReducer.started(.idle)
        XCTAssertEqual(next.activeCount, 1)
        XCTAssertEqual(next.progress, SuspenseProgressBoundaryMeta.trickleInitial, accuracy: 1e-9)
        XCTAssertTrue(next.isActive)
    }

    func testStartedWhileActiveStacksWithoutResettingProgress() {
        let active = SuspenseProgressState(activeCount: 1, progress: 50)
        let next = SuspenseProgressReducer.started(active)
        XCTAssertEqual(next.activeCount, 2)
        XCTAssertEqual(next.progress, 50, accuracy: 1e-9)
    }

    func testTickedAdvancesByFractionOfRemaining() {
        // remaining = 80 - 8 = 72; step = max(1, 72 * 0.15) = 10.8; next = 18.8
        let next = SuspenseProgressReducer.ticked(SuspenseProgressState(activeCount: 1, progress: 8))
        XCTAssertEqual(next.progress, 18.8, accuracy: 1e-9)
        XCTAssertEqual(next.activeCount, 1)
    }

    func testTickedHonorsMinimumStep() {
        // remaining = 80 - 79.5 = 0.5; 0.5 * 0.15 = 0.075 < 1, so the floor of 1 applies → 80 (capped).
        let next = SuspenseProgressReducer.ticked(SuspenseProgressState(activeCount: 1, progress: 79.5))
        XCTAssertEqual(next.progress, SuspenseProgressBoundaryMeta.trickleTarget, accuracy: 1e-9)
    }

    func testTickedNeverExceedsTarget() {
        var state = SuspenseProgressState(activeCount: 1, progress: 8)
        for _ in 0 ..< 200 {
            state = SuspenseProgressReducer.ticked(state)
        }
        XCTAssertLessThanOrEqual(state.progress, SuspenseProgressBoundaryMeta.trickleTarget)
        XCTAssertEqual(state.progress, SuspenseProgressBoundaryMeta.trickleTarget, accuracy: 1e-9)
    }

    func testTickedIsNoOpWhenIdle() {
        XCTAssertEqual(SuspenseProgressReducer.ticked(.idle), .idle)
    }

    func testTickedGuardsNonFiniteProgress() {
        let next = SuspenseProgressReducer.ticked(SuspenseProgressState(activeCount: 1, progress: .nan))
        XCTAssertTrue(next.progress.isFinite)
    }

    func testStoppedDecrementsButKeepsProgressWhileActive() {
        let next = SuspenseProgressReducer.stopped(SuspenseProgressState(activeCount: 2, progress: 40))
        XCTAssertEqual(next.activeCount, 1)
        XCTAssertEqual(next.progress, 40, accuracy: 1e-9)
    }

    func testStoppedSnapsBackOnLastConsumer() {
        let next = SuspenseProgressReducer.stopped(SuspenseProgressState(activeCount: 1, progress: 40))
        XCTAssertEqual(next.activeCount, 0)
        XCTAssertEqual(next.progress, 0, accuracy: 1e-9)
        XCTAssertFalse(next.isActive)
    }

    func testStoppedFloorsAtZero() {
        let next = SuspenseProgressReducer.stopped(.idle)
        XCTAssertEqual(next.activeCount, 0)
        XCTAssertEqual(next.progress, 0, accuracy: 1e-9)
    }

    func testStateClampsNegativeActiveCount() {
        XCTAssertEqual(SuspenseProgressState(activeCount: -3, progress: 0).activeCount, 0)
    }
}

// MARK: - Meta (slug + i18n key + constants + accessibility value)

final class SuspenseProgressBoundaryMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(SuspenseProgressBoundaryMeta.surfaceSlug, "SuspenseProgressBoundary")
        XCTAssertEqual(SuspenseProgressBoundary<Text, Text>.surfaceSlug, "SuspenseProgressBoundary")
    }

    func testLoadingLabelKeyMirrorsWebTopProgress() {
        XCTAssertEqual(SuspenseProgressBoundaryMeta.loadingLabelKey, "global.loading")
        XCTAssertFalse(NSLocalizedString("global.loading", comment: "").isEmpty)
    }

    func testTrickleConstantsMatchWeb() {
        XCTAssertEqual(SuspenseProgressBoundaryMeta.trickleTarget, 80, accuracy: 1e-9)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.trickleInitial, 8, accuracy: 1e-9)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.trickleIntervalMs, 120)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.trickleStepFraction, 0.15, accuracy: 1e-9)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.trickleMinStep, 1, accuracy: 1e-9)
    }

    func testValueNowRoundsClampsAndGuards() {
        XCTAssertEqual(SuspenseProgressBoundaryMeta.valueNow(0), 0)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.valueNow(8.4), 8)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.valueNow(79.6), 80)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.valueNow(150), 100)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.valueNow(-5), 0)
        XCTAssertEqual(SuspenseProgressBoundaryMeta.valueNow(.nan), 0)
    }
}

// MARK: - Phase (web Suspense fallback / resolved)

final class SuspensePhaseTests: XCTestCase {
    func testPhaseFromReadiness() {
        XCTAssertEqual(SuspensePhase(isReady: false), .loading)
        XCTAssertEqual(SuspensePhase(isReady: true), .resolved)
    }

    func testIsLoading() {
        XCTAssertTrue(SuspensePhase.loading.isLoading)
        XCTAssertFalse(SuspensePhase.resolved.isLoading)
    }
}

// MARK: - Controller (web `globalProgress` singleton behaviour)

@MainActor
final class SuspenseProgressControllerTests: XCTestCase {
    private func makeController() -> SuspenseProgressController {
        // A very large interval keeps the background ticker dormant so the trickle is driven explicitly.
        SuspenseProgressController(intervalMilliseconds: 1_000_000)
    }

    func testStartActivatesAndJumpsToInitial() {
        let controller = makeController()
        let stop = controller.start()
        XCTAssertTrue(controller.isActive)
        XCTAssertEqual(controller.state.activeCount, 1)
        XCTAssertEqual(controller.progress, SuspenseProgressBoundaryMeta.trickleInitial, accuracy: 1e-9)
        XCTAssertEqual(controller.valueNow, 8)
        stop()
    }

    func testConcurrentStartsStackIntoOneBar() {
        let controller = makeController()
        let stopA = controller.start()
        let stopB = controller.start()
        XCTAssertEqual(controller.state.activeCount, 2)
        XCTAssertEqual(controller.progress, SuspenseProgressBoundaryMeta.trickleInitial, accuracy: 1e-9)
        stopA()
        XCTAssertTrue(controller.isActive)
        XCTAssertEqual(controller.state.activeCount, 1)
        stopB()
        XCTAssertFalse(controller.isActive)
        XCTAssertEqual(controller.progress, 0, accuracy: 1e-9)
    }

    func testStopIsIdempotent() {
        let controller = makeController()
        let stopA = controller.start()
        let stopB = controller.start()
        stopA()
        stopA() // double-fire must not underflow while B is still active
        XCTAssertEqual(controller.state.activeCount, 1)
        XCTAssertTrue(controller.isActive)
        stopB()
        XCTAssertEqual(controller.state.activeCount, 0)
    }

    func testAdvanceTricklesTowardTargetAndCaps() {
        let controller = makeController()
        let stop = controller.start()
        let first = controller.progress
        XCTAssertTrue(controller.advance())
        XCTAssertGreaterThan(controller.progress, first)
        for _ in 0 ..< 200 {
            controller.advance()
        }
        XCTAssertEqual(controller.progress, SuspenseProgressBoundaryMeta.trickleTarget, accuracy: 1e-9)
        stop()
    }

    func testAdvanceIsNoOpWhenIdle() {
        let controller = makeController()
        XCTAssertFalse(controller.advance())
        XCTAssertEqual(controller.state, .idle)
    }

    func testResetClearsState() {
        let controller = makeController()
        _ = controller.start()
        controller.advance()
        controller.reset()
        XCTAssertEqual(controller.state, .idle)
        XCTAssertFalse(controller.isActive)
    }
}

// MARK: - Model (state-holder bridge + telemetry)

@MainActor
final class SuspenseProgressBoundaryModelTests: XCTestCase {
    private func makeController() -> SuspenseProgressController {
        SuspenseProgressController(intervalMilliseconds: 1_000_000)
    }

    private func makeModel(
        isReady: Bool,
        controller: SuspenseProgressController,
        telemetry: SuspenseProgressBoundaryTelemetry
    ) -> SuspenseProgressBoundaryModel {
        SuspenseProgressBoundaryModel(isReady: isReady, controller: controller, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpySuspenseProgressBoundaryTelemetry()
        let model = makeModel(isReady: true, controller: makeController(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SuspenseProgressBoundaryMeta.surfaceSlug])
    }

    func testStartOpensBridgeWhenLoading() {
        let controller = makeController()
        let model = makeModel(isReady: false, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isProgressActive)
        XCTAssertEqual(controller.state.activeCount, 1)
    }

    func testStartDoesNotOpenBridgeWhenResolved() {
        let controller = makeController()
        let model = makeModel(isReady: true, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertFalse(model.isProgressActive)
    }

    func testSyncResolvedClosesBridge() {
        let controller = makeController()
        let model = makeModel(isReady: false, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        XCTAssertTrue(model.isProgressActive)
        model.sync(isReady: true)
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertFalse(model.isProgressActive)
        XCTAssertEqual(controller.progress, 0, accuracy: 1e-9)
    }

    func testSyncReSuspendReopensBridge() {
        let controller = makeController()
        let model = makeModel(isReady: true, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        XCTAssertFalse(model.isProgressActive)
        model.sync(isReady: false)
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isProgressActive)
        XCTAssertEqual(controller.state.activeCount, 1)
    }

    func testSyncIsIdempotentForUnchangedPhase() {
        let controller = makeController()
        let model = makeModel(isReady: false, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        model.sync(isReady: false)
        XCTAssertEqual(controller.state.activeCount, 1)
    }

    func testStartDoesNotDoubleCountBridge() {
        let controller = makeController()
        let model = makeModel(isReady: false, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        model.start()
        XCTAssertEqual(controller.state.activeCount, 1)
    }

    func testStopReleasesBridge() {
        let controller = makeController()
        let model = makeModel(isReady: false, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        XCTAssertTrue(model.isProgressActive)
        model.stop()
        XCTAssertFalse(model.isProgressActive)
        XCTAssertEqual(controller.state.activeCount, 0)
    }

    func testStopIsSafeBeforeAnyBridge() {
        let controller = makeController()
        let model = makeModel(isReady: true, controller: controller, telemetry: SpySuspenseProgressBoundaryTelemetry())
        model.start()
        model.stop()
        XCTAssertFalse(model.isProgressActive)
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class SuspenseProgressBoundaryViewTests: XCTestCase {
    func testPublicSurfacesCompose() {
        _ = SuspenseProgressBoundary(isReady: false) {
            Text(verbatim: "content")
        } fallback: {
            Text(verbatim: "fallback")
        }
        _ = SuspenseProgressBoundary(
            isReady: true,
            showsProgressBar: false,
            controller: SuspenseProgressController(intervalMilliseconds: 1_000_000),
            telemetry: SpySuspenseProgressBoundaryTelemetry()
        ) {
            Text(verbatim: "content")
        } fallback: {
            ProgressView()
        }
        _ = SuspenseProgressTopBar(controller: SuspenseProgressController(intervalMilliseconds: 1_000_000))
        _ = SuspenseProgressBar(controller: SuspenseProgressController(intervalMilliseconds: 1_000_000))
    }

    func testContainerComposesPerPhase() {
        let controller = SuspenseProgressController(intervalMilliseconds: 1_000_000)
        _ = SuspenseBoundaryContainer(
            phase: .loading,
            showsProgressBar: true,
            controller: controller,
            content: { Text(verbatim: "content") },
            fallback: { Text(verbatim: "fallback") }
        )
        _ = SuspenseBoundaryContainer(
            phase: .resolved,
            showsProgressBar: false,
            controller: controller,
            content: { Text(verbatim: "content") },
            fallback: { Text(verbatim: "fallback") }
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpySuspenseProgressBoundaryTelemetry: SuspenseProgressBoundaryTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
