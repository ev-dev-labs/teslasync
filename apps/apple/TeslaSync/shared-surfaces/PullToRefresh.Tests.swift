//
//  PullToRefresh.Tests.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  Stateful + view coverage for the PullToRefresh surface (the pure projection / adapter / accessibility
//  coverage lives in PullToRefresh.AdapterTests.swift):
//    • Model — the gesture state machine (arm-at-top, resist, snap-back, fire past threshold), the
//      refreshing lifecycle, the while-refreshing guards, cancel, the once-only `view.opened` telemetry,
//      and the localized copy projection.
//    • Views — the indicator, the glyph, and the public surface compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store. The
//  string stub is deterministic so the label assertions hold regardless of the runner's locale.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Deterministic string stub

private func keyEcho(_ key: String, _: String) -> String {
    key
}

// MARK: - Model (gesture state machine + lifecycle)

@MainActor
final class PullToRefreshModelTests: XCTestCase {
    private func makeModel(
        pointer: PullToRefreshPointer = .coarse,
        threshold: Double = 80,
        enabled: Bool? = nil,
        onRefresh: @escaping @MainActor () async -> Void = {},
        telemetry: PullToRefreshTelemetry = SpyPullToRefreshTelemetry()
    ) -> PullToRefreshModel {
        PullToRefreshModel(
            input: PullToRefreshInput(threshold: threshold, pointer: pointer, enabled: enabled),
            onRefresh: onRefresh,
            telemetry: telemetry,
            strings: keyEcho
        )
    }

    private func settle(_ model: PullToRefreshModel, timeout: TimeInterval = 1) async {
        let deadline = Date().addingTimeInterval(timeout)
        while model.refreshing, Date() < deadline {
            await Task.yield()
        }
    }

    func testInitialStateIsIdleWhenActive() {
        let model = makeModel()
        XCTAssertTrue(model.active)
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
        XCTAssertFalse(model.refreshing)
        XCTAssertEqual(model.phase, .idle)
    }

    func testInactiveOnFinePointer() {
        let model = makeModel(pointer: .fine)
        XCTAssertFalse(model.active)
        XCTAssertEqual(model.phase, .inactive)
    }

    func testDragDoesNotArmAwayFromTop() {
        let model = makeModel()
        model.setAtTop(false)
        model.dragChanged(translationHeight: 50)
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
        XCTAssertEqual(model.phase, .idle)
    }

    func testDragDoesNotArmOnUpwardMove() {
        let model = makeModel()
        model.setAtTop(true)
        model.dragChanged(translationHeight: -30)
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
    }

    func testDragAtTopResistsAndClamps() {
        let model = makeModel()
        model.setAtTop(true)
        model.dragChanged(translationHeight: 40)
        XCTAssertEqual(model.pull, 40, accuracy: 1e-9)
        XCTAssertEqual(model.phase, .pulling)
        model.dragChanged(translationHeight: 120)
        XCTAssertEqual(model.pull, 100, accuracy: 1e-9)
        XCTAssertEqual(model.phase, .ready)
        model.dragChanged(translationHeight: 5000)
        XCTAssertEqual(model.pull, 140, accuracy: 1e-9)
    }

    func testDragBackUpCollapsesAndDisarms() {
        let model = makeModel()
        model.setAtTop(true)
        model.dragChanged(translationHeight: 60)
        XCTAssertEqual(model.pull, 60, accuracy: 1e-9)
        model.dragChanged(translationHeight: -10)
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
    }

    func testReleaseBelowThresholdDoesNotRefresh() async {
        let spy = RefreshSpy()
        let model = makeModel(onRefresh: { spy.run() })
        model.setAtTop(true)
        model.dragChanged(translationHeight: 40)
        model.dragEnded()
        XCTAssertFalse(model.refreshing)
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
        await settle(model)
        XCTAssertEqual(spy.count, 0)
    }

    func testReleasePastThresholdRefreshes() async {
        let spy = RefreshSpy()
        let model = makeModel(onRefresh: { spy.run() })
        model.setAtTop(true)
        model.dragChanged(translationHeight: 120)
        model.dragEnded()
        XCTAssertTrue(model.refreshing) // set synchronously, before the task runs
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
        await settle(model)
        XCTAssertFalse(model.refreshing)
        XCTAssertEqual(spy.count, 1)
    }

    func testDragIgnoredWhileRefreshing() async {
        let model = makeModel()
        model.triggerRefresh()
        XCTAssertTrue(model.refreshing)
        model.setAtTop(true)
        model.dragChanged(translationHeight: 90)
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
        await settle(model)
    }

    func testTriggerRefreshIsIdempotentWhileRefreshing() async {
        let spy = RefreshSpy()
        let model = makeModel(onRefresh: { spy.run() })
        model.triggerRefresh()
        model.triggerRefresh()
        XCTAssertTrue(model.refreshing)
        await settle(model)
        XCTAssertEqual(spy.count, 1)
    }

    func testTriggerRefreshNoOpWhenInactive() async {
        let spy = RefreshSpy()
        let model = makeModel(pointer: .fine, onRefresh: { spy.run() })
        model.triggerRefresh()
        XCTAssertFalse(model.refreshing)
        await settle(model)
        XCTAssertEqual(spy.count, 0)
    }

    func testCancelResetsPull() {
        let model = makeModel()
        model.setAtTop(true)
        model.dragChanged(translationHeight: 70)
        model.cancel()
        XCTAssertEqual(model.pull, 0, accuracy: 1e-9)
    }

    func testRefreshingGeometryUsesFixedBand() async {
        let model = makeModel()
        model.triggerRefresh()
        XCTAssertEqual(model.indicatorHeight, 48, accuracy: 1e-9) // 80 * 0.6
        XCTAssertEqual(model.contentOffset, 48, accuracy: 1e-9)
        await settle(model)
    }

    func testLabelTextTracksPhase() {
        let model = makeModel()
        XCTAssertEqual(model.labelText, PullToRefreshStringKey.pull)
        model.setAtTop(true)
        model.dragChanged(translationHeight: 90)
        XCTAssertEqual(model.labelText, PullToRefreshStringKey.release)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyPullToRefreshTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PullToRefreshMeta.surfaceSlug])
    }

    func testStopIsSafe() {
        let model = makeModel()
        model.start()
        model.stop()
        model.stop()
        XCTAssertFalse(model.refreshing)
    }
}

// MARK: - Views (compose — signature contract)

@MainActor
final class PullToRefreshViewTests: XCTestCase {
    func testSurfaceSlugFromViewType() {
        XCTAssertEqual(PullToRefresh<EmptyView>.surfaceSlug, "PullToRefresh")
    }

    func testIndicatorComposesAtEveryPhase() {
        _ = PullToRefreshIndicator(pull: 0, refreshing: false, threshold: 80)
        _ = PullToRefreshIndicator(pull: 40, refreshing: false, threshold: 80)
        _ = PullToRefreshIndicator(pull: 80, refreshing: false, threshold: 80)
        _ = PullToRefreshIndicator(pull: 0, refreshing: true, threshold: 80)
    }

    func testGlyphComposes() {
        _ = PullToRefreshGlyph(progress: 0.5, refreshing: false, reduceMotion: false)
        _ = PullToRefreshGlyph(progress: 1, refreshing: true, reduceMotion: true)
    }

    func testSurfaceComposes() {
        _ = PullToRefresh(threshold: 80, enabled: true, onRefresh: {}, content: {
            Text(verbatim: "content")
        })
        _ = PullToRefresh(
            model: PullToRefreshModel(input: PullToRefreshInput(pointer: .fine), onRefresh: {}),
            content: { Text(verbatim: "passthrough") }
        )
    }
}

// MARK: - Test doubles

/// Records `onRefresh` invocations. Main-actor isolated (so implicitly `Sendable`) — the closure runs
/// on the model's main actor.
@MainActor
private final class RefreshSpy {
    private(set) var count = 0
    func run() {
        count += 1
    }
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyPullToRefreshTelemetry: PullToRefreshTelemetry, @unchecked Sendable {
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
