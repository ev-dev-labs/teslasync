//
//  SLOTrackingCard.ModelTests.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  State-holder coverage for `SLOTrackingModel`: phase across loading / loaded /
//  empty / failed, the figure + tone projection, the personal-target load /
//  edit / save / cancel round-trip (web `loadTarget` / `handleSaveTarget`,
//  persisted through `SLOTargetStore`), the window re-key (web `setWin`), the
//  P1/S11 `view.opened` telemetry (once), the silent error retry, the one-shot
//  stale auto-refresh (re-armed on live), and offline keeping the cached figure.
//  Driven through in-memory doubles; no network, no bundle. Fixtures live in
//  `.Tests`.
//

import XCTest
@testable import TeslaSync

@MainActor final class SLOTrackingModelTests: XCTestCase {
    /// The bound model + its in-memory doubles, returned together so each test can
    /// inspect whichever it needs (kept a struct rather than a tuple for lint).
    private struct Harness {
        let model: SLOTrackingModel
        let source: InMemorySLOTrackingSource
        let store: InMemorySLOTargetStore
    }

    private func makeModel(
        initial: SLOTrackingUpdate?,
        window: SLOWindow = .d30,
        windowUpdates: [SLOWindow: SLOTrackingUpdate] = [:],
        target: Double? = 99,
        telemetry: SLOTrackingTelemetry = SpySLOTrackingTelemetry()
    ) -> Harness {
        let source = InMemorySLOTrackingSource(initial: initial, window: window, windowUpdates: windowUpdates)
        let store = InMemorySLOTargetStore(stored: target)
        let model = SLOTrackingModel(
            source: source,
            telemetry: telemetry,
            targetStore: store,
            initialWindow: window,
            locale: Locale(identifier: "en_US")
        )
        return Harness(model: model, source: source, store: store)
    }

    // MARK: Phase + figure projection

    func testLoadedContentProjectsFigureAndTone() {
        let env = makeModel(initial: SLOTrackingFixture.loaded(SLOTrackingFixture.series()))
        env.model.start()
        XCTAssertEqual(env.model.phase, .content)
        XCTAssertEqual(env.model.snapshot?.uptimePercent, 99.95)
        XCTAssertEqual(env.model.percentText, "99.95%")
        XCTAssertEqual(env.model.tone, .onTarget)
        XCTAssertEqual(env.model.componentsClause, "6 / 6 components healthy")
        XCTAssertFalse(env.model.showsCaveat)
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testLoadedWithoutSnapshotResolvesEmpty() {
        let env = makeModel(initial: SLOTrackingUpdate(status: .loaded))
        env.model.start()
        XCTAssertEqual(env.model.phase, .empty)
        XCTAssertNil(env.model.snapshot)
        XCTAssertEqual(env.model.percentText, "—")
        XCTAssertEqual(env.model.tone, .unknown)
    }

    func testLoadingPhaseBeforeData() {
        let env = makeModel(initial: SLOTrackingUpdate(status: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let env = makeModel(initial: SLOTrackingUpdate(status: .failed("timeout")))
        env.model.start()
        XCTAssertEqual(env.model.phase, .error("timeout"))
    }

    func testNonSeriesSnapshotShowsCaveat() {
        let env = makeModel(
            initial: SLOTrackingFixture.loaded(SLOTrackingFixture.snapshotCaveat),
            window: .d90
        )
        env.model.start()
        XCTAssertTrue(env.model.showsCaveat)
        XCTAssertTrue(env.model.caveatText.contains("heartbeat history backend"))
    }

    // MARK: Window selection (web `setWin`)

    func testSelectWindowReKeysAndPushesNewFigure() {
        let updates: [SLOWindow: SLOTrackingUpdate] = [
            .d30: SLOTrackingFixture.loaded(SLOTrackingFixture.series(.d30, percent: 99.9)),
            .d7: SLOTrackingFixture.loaded(SLOTrackingFixture.series(.d7, percent: 88.0))
        ]
        let env = makeModel(initial: nil, window: .d30, windowUpdates: updates)
        env.model.start()
        XCTAssertEqual(env.model.snapshot?.window, "30d")
        env.model.selectWindow(.d7)
        XCTAssertEqual(env.model.selectedWindow, .d7)
        XCTAssertEqual(env.model.snapshot?.window, "7d")
        XCTAssertEqual(env.model.phase, .content)
        XCTAssertEqual(env.source.selectedWindows, [.d7])
    }

    func testSelectingSameWindowIsNoOp() {
        let env = makeModel(
            initial: SLOTrackingFixture.loaded(SLOTrackingFixture.series()),
            window: .d30
        )
        env.model.start()
        env.model.selectWindow(.d30)
        XCTAssertEqual(env.source.selectedWindows, [])
    }

    func testSelectWindowUpdatesLongLabel() {
        let env = makeModel(
            initial: SLOTrackingFixture.loaded(SLOTrackingFixture.series()),
            window: .d30,
            windowUpdates: [.y1: SLOTrackingFixture.loaded(SLOTrackingFixture.series(.y1))]
        )
        env.model.start()
        env.model.selectWindow(.y1)
        XCTAssertEqual(env.model.windowLabel, "Last year")
    }

    // MARK: Personal target — load / edit / save / cancel

    func testTargetLoadsFromStoreClamped() {
        let env = makeModel(initial: nil, target: 95)
        XCTAssertEqual(env.model.target, 95)
        XCTAssertEqual(env.model.targetToken, "95")
    }

    func testTargetDefaultsWhenStoreEmptyOrInvalid() {
        let empty = makeModel(initial: nil, target: nil)
        XCTAssertEqual(empty.model.target, 99)
        let outOfRange = makeModel(initial: nil, target: 150)
        XCTAssertEqual(outOfRange.model.target, 99)
    }

    func testBeginEditingSeedsDraftFromTarget() {
        let env = makeModel(initial: nil, target: 99.5)
        env.model.beginEditingTarget()
        XCTAssertTrue(env.model.isEditingTarget)
        XCTAssertEqual(env.model.draftTarget, "99.5")
    }

    func testSaveValidTargetAdoptsAndPersists() {
        let env = makeModel(initial: SLOTrackingFixture.loaded(SLOTrackingFixture.series()), target: 95)
        env.model.start()
        env.model.beginEditingTarget()
        env.model.draftTarget = "99.5"
        env.model.saveTarget()
        XCTAssertEqual(env.model.target, 99.5)
        XCTAssertFalse(env.model.isEditingTarget)
        XCTAssertEqual(env.store.stored, 99.5)
        XCTAssertEqual(env.store.saveCount, 1)
    }

    func testSaveInvalidTargetRevertsWithoutPersisting() {
        let env = makeModel(initial: nil, target: 99)
        env.model.beginEditingTarget()
        env.model.draftTarget = "0"
        env.model.saveTarget()
        XCTAssertEqual(env.model.target, 99)
        XCTAssertEqual(env.model.draftTarget, "99")
        XCTAssertFalse(env.model.isEditingTarget)
        XCTAssertEqual(env.store.saveCount, 0)
    }

    func testCancelEditingDiscardsDraft() {
        let env = makeModel(initial: nil, target: 99)
        env.model.beginEditingTarget()
        env.model.draftTarget = "80"
        env.model.cancelEditingTarget()
        XCTAssertFalse(env.model.isEditingTarget)
        XCTAssertEqual(env.model.draftTarget, "99")
        XCTAssertEqual(env.model.target, 99)
    }

    func testEditingTargetUpdatesToneLive() {
        let env = makeModel(
            initial: SLOTrackingFixture.loaded(SLOTrackingFixture.series(.d30, percent: 99.5)),
            target: 99
        )
        env.model.start()
        XCTAssertEqual(env.model.tone, .onTarget) // 99.5 >= 99
        env.model.beginEditingTarget()
        env.model.draftTarget = "99.9"
        env.model.saveTarget()
        XCTAssertEqual(env.model.tone, .nearTarget) // 99.5 within one point of 99.9
    }

    // MARK: Telemetry + lifecycle

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySLOTrackingTelemetry()
        let env = makeModel(initial: nil, telemetry: spy)
        env.model.start()
        env.model.start()
        XCTAssertEqual(spy.surfaces, [SLOTrackingSurface.slug])
    }

    func testRetryIsSilentRefresh() {
        let env = makeModel(initial: SLOTrackingUpdate(status: .failed("x")))
        env.model.start()
        env.model.retry()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let env = makeModel(initial: nil)
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
    }

    // MARK: Freshness (stale / offline)

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let env = makeModel(initial: nil)
        env.model.start()
        env.source.push(SLOTrackingFixture.loaded(SLOTrackingFixture.series(), connection: .stale))
        env.source.push(SLOTrackingFixture.loaded(SLOTrackingFixture.series(), connection: .stale))
        XCTAssertEqual(env.model.connection, .stale)
        XCTAssertEqual(env.source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let env = makeModel(initial: nil)
        env.model.start()
        env.source.push(SLOTrackingFixture.loaded(SLOTrackingFixture.series(), connection: .stale))
        env.source.push(SLOTrackingFixture.loaded(SLOTrackingFixture.series(), connection: .live))
        env.source.push(SLOTrackingFixture.loaded(SLOTrackingFixture.series(), connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineKeepsCachedFigureWithoutRefresh() {
        let env = makeModel(initial: nil)
        env.model.start()
        env.source.push(SLOTrackingFixture.loaded(SLOTrackingFixture.series(), connection: .offline))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.phase, .content)
        XCTAssertEqual(env.model.snapshot?.uptimePercent, 99.95)
        XCTAssertEqual(env.source.refreshCount, 0, "offline must not refetch")
    }
}

// MARK: - Test doubles

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySLOTrackingTelemetry: SLOTrackingTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
