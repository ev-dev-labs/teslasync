//
//  RouteAnnouncer.ModelTests.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  State-holder coverage for `RouteAnnouncerModel`, porting the web `RouteAnnouncer.test.tsx`
//  contract to the native deferred-read model driven by the deterministic scheduler:
//    • silent on first paint (the landing route is never announced — browser already voices it).
//    • announces the resolved title after a navigation, deferring the read.
//    • re-announces two consecutive routes that resolve to the same title (rotating ZWS).
//    • clears the region when the resolved title is empty.
//    • cancels a pending read when the route changes again (only the final destination speaks).
//    • honours a custom delay.
//  Plus the surface lifecycle: `view.opened` telemetry (once + idempotent), the loading / empty /
//  error phases, the connection axis (live / stale / offline) with the one-shot stale
//  auto-refresh, manual refresh, and stop cancelling the pending read. Driven through the
//  in-memory source + manual scheduler — no network, no real time, no live speech.
//

import XCTest
@testable import TeslaSync

private func snapshot(_ path: String, _ title: String) -> RouteSnapshot {
    RouteSnapshot(path: path, title: title)
}

/// Records posted announcements so the voicing contract can be asserted without driving live
/// speech. Main-actor isolated, matching the presenter seam.
@MainActor
private final class RecordingRouteAnnouncementPresenter: RouteAnnouncementPresenter {
    private(set) var posted: [RouteAnnouncement] = []

    func announce(_ announcement: RouteAnnouncement) {
        posted.append(announcement)
    }
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyRouteAnnouncerTelemetry: RouteAnnouncerTelemetry, @unchecked Sendable {
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

// MARK: - Harness

@MainActor
private struct Harness {
    let model: RouteAnnouncerModel
    let source: InMemoryRouteAnnouncerSource
    let scheduler: ManualRouteAnnouncerScheduler
    let presenter: RecordingRouteAnnouncementPresenter

    init(initial: RouteSnapshot? = snapshot("/", "Dashboard — TeslaSync"), delaySeconds: Double = 0.1) {
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput(snapshot: initial))
        let scheduler = ManualRouteAnnouncerScheduler()
        let presenter = RecordingRouteAnnouncementPresenter()
        self.source = source
        self.scheduler = scheduler
        self.presenter = presenter
        model = RouteAnnouncerModel(
            source: source,
            presenter: presenter,
            scheduler: scheduler,
            delaySeconds: delaySeconds,
            clock: { Date(timeIntervalSinceReferenceDate: 0) }
        )
        model.start()
    }

    var titles: [String] {
        presenter.posted.map(\.title)
    }
}

// MARK: - Web-parity behaviour

@MainActor
final class RouteAnnouncerBehaviourTests: XCTestCase {
    func testSilentOnFirstPaint() {
        let harness = Harness()
        harness.scheduler.advance(by: 1.0)
        XCTAssertTrue(harness.presenter.posted.isEmpty)
        XCTAssertEqual(harness.model.phase, .empty)
    }

    func testAnnouncesTitleAfterNavigationDeferringTheRead() {
        let harness = Harness()
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/drives", "Drives — TeslaSync")))
        // Pre-timeout the region must still be silent — the read is deliberately deferred.
        XCTAssertTrue(harness.presenter.posted.isEmpty)

        harness.scheduler.advance(by: 0.15)

        XCTAssertEqual(harness.titles, ["Drives — TeslaSync"])
        XCTAssertEqual(harness.model.resolved.current?.title, "Drives — TeslaSync")
        XCTAssertEqual(harness.model.phase, .data)
    }

    func testReAnnouncesTwoRoutesWithTheSameTitle() {
        let harness = Harness()
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/charging/1", "Charging Session — TeslaSync")))
        harness.scheduler.advance(by: 0.15)
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/charging/2", "Charging Session — TeslaSync")))
        harness.scheduler.advance(by: 0.15)

        XCTAssertEqual(harness.titles, ["Charging Session — TeslaSync", "Charging Session — TeslaSync"])
        // The literal posted strings must differ so the AT re-reads the second navigation.
        let posted = harness.presenter.posted.map(\.announcementText)
        XCTAssertNotEqual(posted[0], posted[1])
    }

    func testClearsTheRegionWhenTitleIsEmpty() {
        let harness = Harness()
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/b", "")))
        harness.scheduler.advance(by: 0.15)

        XCTAssertTrue(harness.presenter.posted.isEmpty)
        XCTAssertNil(harness.model.resolved.current)
        XCTAssertEqual(harness.model.phase, .empty)
    }

    func testCancelsPendingReadWhenRouteChangesAgain() {
        let harness = Harness()
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/b", "Drives — TeslaSync")))
        // Second navigation before the first read fires — the intermediate timer is cancelled.
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/charging/1", "Charging Session — TeslaSync")))
        XCTAssertEqual(harness.scheduler.cancelCount, 1)

        harness.scheduler.advance(by: 0.15)

        XCTAssertEqual(harness.titles, ["Charging Session — TeslaSync"])
    }

    func testHonoursACustomDelay() {
        let harness = Harness(delaySeconds: 0.5)
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/drives", "Drives — TeslaSync")))

        harness.scheduler.advance(by: 0.2)
        XCTAssertTrue(harness.presenter.posted.isEmpty) // 0.2 < 0.5 — still in flight

        harness.scheduler.advance(by: 0.4)
        XCTAssertEqual(harness.titles, ["Drives — TeslaSync"]) // 0.6 >= 0.5 — fired
    }

    func testHistoryAccumulatesMostRecentFirst() {
        let harness = Harness()
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/drives", "Drives — TeslaSync")))
        harness.scheduler.advance(by: 0.15)
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/analytics", "Analytics — TeslaSync")))
        harness.scheduler.advance(by: 0.15)

        XCTAssertEqual(harness.model.resolved.history.map(\.title), ["Analytics — TeslaSync", "Drives — TeslaSync"])
        XCTAssertEqual(harness.model.resolved.current?.title, "Analytics — TeslaSync")
    }
}

// MARK: - Lifecycle + connection axis

@MainActor
final class RouteAnnouncerModelLifecycleTests: XCTestCase {
    func testStartEmitsTelemetryOnceAndIsIdempotent() {
        let spy = SpyRouteAnnouncerTelemetry()
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput())
        let model = RouteAnnouncerModel(source: source, telemetry: spy, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RouteAnnouncer.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingPhaseFromInput() {
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput(isLoading: true))
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorPhaseFromInput() {
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput(errorMessage: "boom"))
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEmptyPhaseWhenNothingAnnounced() {
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput())
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let route = snapshot("/drives", "Drives — TeslaSync")
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput(snapshot: route))
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        XCTAssertEqual(model.connection, .live)

        source.push(RouteAnnouncerInput(snapshot: route, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(RouteAnnouncerInput(snapshot: route, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1) // staying stale must not re-trigger
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let route = snapshot("/drives", "Drives — TeslaSync")
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput(snapshot: route))
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        source.push(RouteAnnouncerInput(snapshot: route, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(RouteAnnouncerInput(snapshot: route, connection: .live))
        source.push(RouteAnnouncerInput(snapshot: route, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsLastAnnouncedAndDoesNotAutoRefresh() {
        let harness = Harness()
        harness.source.push(RouteAnnouncerInput(snapshot: snapshot("/drives", "Drives — TeslaSync")))
        harness.scheduler.advance(by: 0.15)
        XCTAssertEqual(harness.model.phase, .data)

        harness.source.push(RouteAnnouncerInput(
            snapshot: snapshot("/drives", "Drives — TeslaSync"),
            connection: .offline
        ))
        XCTAssertEqual(harness.model.connection, .offline)
        XCTAssertEqual(harness.model.phase, .data)
        XCTAssertEqual(harness.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let source = InMemoryRouteAnnouncerSource(initial: RouteAnnouncerInput())
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopCancelsPendingReadAndReArms() {
        let scheduler = ManualRouteAnnouncerScheduler()
        let source = InMemoryRouteAnnouncerSource(
            initial: RouteAnnouncerInput(snapshot: snapshot("/", "Dashboard — TeslaSync"))
        )
        let presenter = RecordingRouteAnnouncementPresenter()
        let model = RouteAnnouncerModel(source: source, presenter: presenter, scheduler: scheduler)
        model.start()
        source.push(RouteAnnouncerInput(snapshot: snapshot("/drives", "Drives — TeslaSync")))
        XCTAssertEqual(scheduler.pendingCount, 1)
        model.stop()
        XCTAssertEqual(scheduler.cancelCount, 1)
        XCTAssertEqual(source.stopCount, 1)

        scheduler.advance(by: 0.5)
        XCTAssertTrue(presenter.posted.isEmpty) // cancelled read never fires
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(RouteAnnouncer.surfaceSlug, "RouteAnnouncer")
    }
}
