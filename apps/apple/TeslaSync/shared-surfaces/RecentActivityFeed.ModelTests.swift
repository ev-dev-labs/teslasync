//
//  RecentActivityFeed.ModelTests.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  State-holder coverage for `RecentActivityFeedModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent, re-armed by `stop()`), the phase transitions across every state
//  (loading / empty / error / content), the click-through capability derivation, the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live), offline
//  keeping the feed without auto-refreshing, the forwarded navigation, the carried empty-message
//  override, and the controlled source. Driven through the in-memory seams — no network, no real time.
//

import XCTest
@testable import TeslaSync

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func sampleEntries(count: Int = 2) -> [RecentActivityFeedEntry] {
    (0 ..< count).map { index in
        RecentActivityFeedEntry(
            id: Int64(index + 1),
            timestamp: fixedNow.addingTimeInterval(-Double(index) * 60 - 30),
            action: "vehicle.command.wake",
            entityType: "vehicle",
            entityID: "\(index + 1)"
        )
    }
}

// MARK: - Model (state-holder)

@MainActor
final class RecentActivityFeedModelTests: XCTestCase {
    private func makeModel(
        _ input: RecentActivityFeedInput,
        telemetry: RecentActivityFeedTelemetry = OSLogRecentActivityFeedTelemetry(),
        onNavigate: (@MainActor (String) -> Void)? = nil
    ) -> (RecentActivityFeedModel, InMemoryRecentActivityFeedSource) {
        let source = InMemoryRecentActivityFeedSource(initial: input)
        let model = RecentActivityFeedModel(
            source: source,
            telemetry: telemetry,
            now: { fixedNow },
            onNavigate: onNavigate
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyRecentActivityFeedTelemetry()
        let (model, source) = makeModel(RecentActivityFeedInput(entries: sampleEntries()), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.rows.first?.relative, .justNow)
        XCTAssertEqual(spy.surfaces, [RecentActivityFeed.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCanNavigateDerivedFromHandler() {
        let (withHandler, _) = makeModel(RecentActivityFeedInput(), onNavigate: { _ in })
        XCTAssertTrue(withHandler.canNavigate)
        let (withoutHandler, _) = makeModel(RecentActivityFeedInput())
        XCTAssertFalse(withoutHandler.canNavigate)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(RecentActivityFeedInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoEntriesProjectsEmptyAndCarriesMessage() {
        let (model, _) = makeModel(RecentActivityFeedInput(emptyMessage: "Nothing here"))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.emptyMessage, "Nothing here")
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(RecentActivityFeedInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToContent() {
        let (model, source) = makeModel(RecentActivityFeedInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(RecentActivityFeedInput(entries: sampleEntries()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.first?.destination, "/vehicles/1")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(RecentActivityFeedInput(entries: sampleEntries()))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RecentActivityFeedInput(entries: sampleEntries(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(RecentActivityFeedInput(entries: sampleEntries(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(RecentActivityFeedInput(entries: sampleEntries()))
        model.start()
        source.push(RecentActivityFeedInput(entries: sampleEntries(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(RecentActivityFeedInput(entries: sampleEntries(), connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(RecentActivityFeedInput(entries: sampleEntries(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsFeedAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(RecentActivityFeedInput(entries: sampleEntries()))
        model.start()
        source.push(RecentActivityFeedInput(entries: sampleEntries(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.rows.isEmpty)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(RecentActivityFeedInput(entries: sampleEntries()))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopReArmsStartAndTelemetry() {
        let spy = SpyRecentActivityFeedTelemetry()
        let (model, source) = makeModel(RecentActivityFeedInput(), telemetry: spy)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(RecentActivityFeed.surfaceSlug, "RecentActivityFeed")
    }
}

// MARK: - Navigation (web `<Link>`)

@MainActor
final class RecentActivityFeedNavigationTests: XCTestCase {
    func testNavigateForwardsRouteToHandler() {
        var routes: [String] = []
        let source = InMemoryRecentActivityFeedSource(initial: RecentActivityFeedInput(entries: sampleEntries()))
        let model = RecentActivityFeedModel(source: source, onNavigate: { routes.append($0) })
        model.start()
        model.navigate(to: "/vehicles/12")
        XCTAssertEqual(routes, ["/vehicles/12"])
    }

    func testNavigateIsNoOpWhenNoHandlerSupplied() {
        let source = InMemoryRecentActivityFeedSource(initial: RecentActivityFeedInput(entries: sampleEntries()))
        let model = RecentActivityFeedModel(source: source)
        model.start()
        model.navigate(to: "/vehicles/12")
        XCTAssertFalse(model.canNavigate)
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticRecentActivityFeedSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticRecentActivityFeedSource(RecentActivityFeedInput(entries: sampleEntries()))
        var inputs: [RecentActivityFeedInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.entries.count, 2)
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticRecentActivityFeedSource(RecentActivityFeedInput(entries: sampleEntries()))
        var inputs: [RecentActivityFeedInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(RecentActivityFeedInput(connection: .offline))
        XCTAssertEqual(inputs.last?.connection, .offline)
        XCTAssertTrue(inputs.last?.entries.isEmpty ?? false)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyRecentActivityFeedTelemetry: RecentActivityFeedTelemetry, @unchecked Sendable {
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
