//
//  SkipToContent.ModelTests.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  State-holder coverage for `SkipToContentModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the connection axis (live / stale / offline) with the
//  one-shot stale auto-refresh (re-armed on return to live), offline keeping the cached
//  landmarks, the manual refresh / stop-and-restart wiring, and the skip activation routing to
//  the focus coordinator. The landmark registry (the `#main-content` DOM port) and the
//  production source are covered too. Driven through the in-memory seams — no network, no live
//  focus move.
//

import XCTest
@testable import TeslaSync

private func target(_ id: String, _ label: String, primary: Bool = false) -> SkipTarget {
    SkipTarget(id: id, label: label, isPrimary: primary)
}

// MARK: - Model (state-holder)

@MainActor
final class SkipToContentModelTests: XCTestCase {
    private let targets = [
        target("main-content", "Main content", primary: true),
        target("nav", "Navigation")
    ]

    private func makeModel(
        _ input: SkipToContentInput,
        telemetry: SkipToContentTelemetry = OSLogSkipToContentTelemetry(),
        focuser: SkipFocusing = OSLogSkipFocuser()
    ) -> (SkipToContentModel, InMemorySkipToContentSource) {
        let source = InMemorySkipToContentSource(initial: input)
        let model = SkipToContentModel(source: source, telemetry: telemetry, focuser: focuser)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySkipTelemetry()
        let (model, source) = makeModel(SkipToContentInput(targets: targets), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.primary?.id, "main-content")
        XCTAssertEqual(model.resolved.secondary.map(\.id), ["nav"])
        XCTAssertEqual(spy.surfaces, [SkipToContent.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(SkipToContentInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoTargetsProjectsEmpty() {
        let (model, _) = makeModel(SkipToContentInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(SkipToContentInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(SkipToContentInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SkipToContentInput(targets: targets))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.primary?.id, "main-content")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(SkipToContentInput(targets: targets))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(SkipToContentInput(targets: targets, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(SkipToContentInput(targets: targets, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(SkipToContentInput(targets: targets))
        model.start()
        source.push(SkipToContentInput(targets: targets, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SkipToContentInput(targets: targets, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(SkipToContentInput(targets: targets, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedTargetsAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(SkipToContentInput(targets: targets))
        model.start()
        source.push(SkipToContentInput(targets: targets, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(SkipToContentInput(targets: targets))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(SkipToContentInput(targets: targets))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSkipRoutesToFocuser() {
        let focuser = RecordingSkipFocuser()
        let (model, _) = makeModel(SkipToContentInput(targets: targets), focuser: focuser)
        model.start()
        model.skip(to: targets[0])
        model.skip(to: targets[1])
        XCTAssertEqual(focuser.posted.map(\.id), ["main-content", "nav"])
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SkipToContent.surfaceSlug, "SkipToContent")
    }
}

// MARK: - Landmark registry (the `#main-content` DOM port)

@MainActor
final class SkipLandmarkRegistryTests: XCTestCase {
    func testRegisterAddsAndNotifiesSubscribers() {
        let registry = SkipLandmarkRegistry()
        var snapshots: [[SkipTarget]] = []
        _ = registry.subscribe { snapshots.append($0) }
        registry.register(target("main-content", "Main content", primary: true))
        XCTAssertEqual(registry.targets.map(\.id), ["main-content"])
        XCTAssertEqual(snapshots.last?.map(\.id), ["main-content"])
    }

    func testRegisterUpsertsByIDWithoutDuplicating() {
        let registry = SkipLandmarkRegistry()
        registry.register(target("main-content", "Main content", primary: true))
        registry.register(target("nav", "Navigation"))
        registry.register(target("main-content", "Body", primary: true))
        XCTAssertEqual(registry.targets.map(\.id), ["main-content", "nav"])
        XCTAssertEqual(registry.targets.first?.label, "Body")
    }

    func testUnregisterRemoves() {
        let registry = SkipLandmarkRegistry()
        registry.register(target("main-content", "Main content", primary: true))
        registry.register(target("nav", "Navigation"))
        registry.unregister(id: "main-content")
        XCTAssertEqual(registry.targets.map(\.id), ["nav"])
    }

    func testSubscribeCancelStopsNotifications() {
        let registry = SkipLandmarkRegistry()
        var count = 0
        let subscription = registry.subscribe { _ in count += 1 }
        registry.register(target("main-content", "Main content"))
        XCTAssertEqual(registry.listenerCount, 1)
        subscription.cancel()
        registry.register(target("nav", "Navigation"))
        XCTAssertEqual(count, 1)
        XCTAssertEqual(registry.listenerCount, 0)
    }

    func testResetClearsTargetsAndListeners() {
        let registry = SkipLandmarkRegistry()
        _ = registry.subscribe { _ in }
        registry.register(target("main-content", "Main content"))
        registry.reset()
        XCTAssertTrue(registry.targets.isEmpty)
        XCTAssertEqual(registry.listenerCount, 0)
    }
}

// MARK: - Live source (production bridge)

@MainActor
final class LiveSkipToContentSourceTests: XCTestCase {
    func testStartEmitsCurrentTargetsAsLive() {
        let registry = SkipLandmarkRegistry()
        registry.register(target("main-content", "Main content", primary: true))
        let source = LiveSkipToContentSource(registry: registry)
        var snapshots: [SkipToContentInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.targets.map(\.id), ["main-content"])
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testRegisterAfterStartReEmits() {
        let registry = SkipLandmarkRegistry()
        let source = LiveSkipToContentSource(registry: registry)
        var latest: SkipToContentInput?
        source.onUpdate = { latest = $0 }
        source.start()
        XCTAssertEqual(latest?.targets.count, 0)
        registry.register(target("main-content", "Main content", primary: true))
        XCTAssertEqual(latest?.targets.map(\.id), ["main-content"])
    }

    func testStopUnsubscribesFromRegistry() {
        let registry = SkipLandmarkRegistry()
        let source = LiveSkipToContentSource(registry: registry)
        var snapshots: [SkipToContentInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        source.stop()
        let countAfterStop = snapshots.count
        registry.register(target("ignored", "Ignored"))
        XCTAssertEqual(snapshots.count, countAfterStop)
    }

    func testRefreshReEmitsCurrent() {
        let registry = SkipLandmarkRegistry()
        registry.register(target("main-content", "Main content", primary: true))
        let source = LiveSkipToContentSource(registry: registry)
        var snapshots: [SkipToContentInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(snapshots.count, 2)
        XCTAssertEqual(snapshots.last?.targets.map(\.id), ["main-content"])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpySkipTelemetry: SkipToContentTelemetry, @unchecked Sendable {
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

/// Records focus requests so the skip-routing contract can be asserted without moving live
/// assistive-technology focus. Main-actor isolated, matching the focus seam.
@MainActor
private final class RecordingSkipFocuser: SkipFocusing {
    private(set) var posted: [SkipTarget] = []

    func focus(_ target: SkipTarget) {
        posted.append(target)
    }
}
