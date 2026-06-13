//
//  MaintenanceBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  State-holder coverage for the MaintenanceBanner surface, kept apart from the pure adapter / projection
//  tests for the lint file-length budget. Drives the `@MainActor` `MaintenanceBannerModel` over the
//  in-memory source + a fresh dismissal store + a deterministic manual clock + a telemetry spy:
//    • `view.opened` telemetry — emitted once per `start`, re-armed by `stop`.
//    • Snapshot application — an active snapshot drives the banner phase; `mode === 'ok'` → empty.
//    • Dismissal — `dismiss()` hides the banner and persists the fingerprint (web `sessionStorage`); a
//      fresh snapshot fingerprint resets the dismissal so a re-pushed banner re-surfaces (web `useEffect`);
//      a dismissal already in the store on init suppresses the matching snapshot.
//    • Countdown — the clock-driven `countdownText` is computed only for a banner with a window end and
//      updates as the clock advances (web `setInterval`); the tick is stopped when the banner clears.
//    • Freshness — the one-shot auto-refresh on the transition into stale, and the tracked connection.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real query, so each
//  assertion drives the model through the in-memory source. The string resolver is the identity-fallback
//  so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let fallbackStrings: MaintenanceBannerResolve = { _, fallback in fallback }

/// Records `view.opened` calls in a thread-safe box so the model assertions can read them after the
/// MainActor `start()` without an isolation mismatch on the `Sendable` telemetry seam.
private final class SpyMaintenanceTelemetry: MaintenanceBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var surfaces: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        defer { lock.unlock() }
        surfaces.append(surface)
    }

    var openedCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return surfaces.count
    }

    var lastSurface: String? {
        lock.lock()
        defer { lock.unlock() }
        return surfaces.last
    }
}

private func isoString(from date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

@MainActor
final class MaintenanceBannerModelTests: XCTestCase {
    private func activeInput(
        message: String = "Upgrading.",
        until: String = "",
        updatedAt: String = "2026-06-13T04:00:00Z",
        connection: MaintenanceBannerConnection = .live
    ) -> MaintenanceBannerInput {
        MaintenanceBannerInput(
            mode: "maintenance",
            message: message,
            until: until,
            updatedAt: updatedAt,
            hasData: true,
            connection: connection
        )
    }

    private func makeModel(
        source: InMemoryMaintenanceBannerSource,
        telemetry: SpyMaintenanceTelemetry = SpyMaintenanceTelemetry(),
        store: SessionMaintenanceBannerDismissalStore = SessionMaintenanceBannerDismissalStore(),
        clock: ManualMaintenanceBannerClock = ManualMaintenanceBannerClock()
    ) -> MaintenanceBannerModel {
        MaintenanceBannerModel(
            source: source,
            telemetry: telemetry,
            strings: fallbackStrings,
            dismissalStore: store,
            clock: clock
        )
    }

    // MARK: view.opened telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyMaintenanceTelemetry()
        let model = makeModel(source: InMemoryMaintenanceBannerSource(), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(telemetry.openedCount, 1)
        XCTAssertEqual(telemetry.lastSurface, "MaintenanceBanner")
    }

    func testStopReArmsViewOpened() {
        let telemetry = SpyMaintenanceTelemetry()
        let model = makeModel(source: InMemoryMaintenanceBannerSource(), telemetry: telemetry)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.openedCount, 2)
    }

    // MARK: Snapshot application

    func testActiveSnapshotDrivesBannerPhase() {
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source)
        model.start()
        source.push(activeInput())
        XCTAssertEqual(model.phase, .banner)
        XCTAssertEqual(model.data?.mode, .maintenance)
    }

    func testOkSnapshotIsEmpty() {
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source)
        model.start()
        source.push(MaintenanceBannerInput(mode: "ok", hasData: true))
        XCTAssertEqual(model.phase, .empty)
    }

    // MARK: Dismissal

    func testDismissHidesBannerAndPersistsFingerprint() {
        let source = InMemoryMaintenanceBannerSource()
        let store = SessionMaintenanceBannerDismissalStore()
        let model = makeModel(source: source, store: store)
        model.start()
        let input = activeInput()
        source.push(input)
        XCTAssertEqual(model.phase, .banner)

        model.dismiss()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(store.read(), input.fingerprint)
    }

    func testDismissIsNoOpOutsideBannerPhase() {
        let source = InMemoryMaintenanceBannerSource()
        let store = SessionMaintenanceBannerDismissalStore()
        let model = makeModel(source: source, store: store)
        model.start()
        source.push(MaintenanceBannerInput(mode: "ok", hasData: true))
        model.dismiss()
        XCTAssertNil(store.read())
        XCTAssertEqual(model.phase, .empty)
    }

    func testFreshSnapshotResetsDismissal() {
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source)
        model.start()
        source.push(activeInput(updatedAt: "2026-06-13T04:00:00Z"))
        model.dismiss()
        XCTAssertEqual(model.phase, .empty)

        // Operator pushes a NEW banner (different update instant) → it re-surfaces.
        source.push(activeInput(updatedAt: "2026-06-13T06:00:00Z"))
        XCTAssertEqual(model.phase, .banner)
    }

    func testDismissalInStoreSuppressesMatchingSnapshotOnInit() {
        let input = activeInput(updatedAt: "2026-06-13T04:00:00Z")
        let store = SessionMaintenanceBannerDismissalStore(initial: input.fingerprint)
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source, store: store)
        model.start()
        source.push(input)
        XCTAssertEqual(model.phase, .empty)
    }

    // MARK: Countdown

    func testCountdownComputedForBannerWithWindowEnd() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let clock = ManualMaintenanceBannerClock(now: base)
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source, clock: clock)
        model.start()
        source.push(activeInput(until: isoString(from: base.addingTimeInterval(3600))))
        XCTAssertEqual(model.countdownText, "Ends in 1h 00m")
        XCTAssertTrue(clock.isRunning)
    }

    func testCountdownAdvancesWithClock() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let clock = ManualMaintenanceBannerClock(now: base)
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source, clock: clock)
        model.start()
        source.push(activeInput(until: isoString(from: base.addingTimeInterval(3600))))
        clock.advance(by: 60)
        XCTAssertEqual(model.countdownText, "Ends in 59m 00s")
    }

    func testNoCountdownWithoutWindowEnd() {
        let clock = ManualMaintenanceBannerClock()
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source, clock: clock)
        model.start()
        source.push(activeInput(until: ""))
        XCTAssertNil(model.countdownText)
        XCTAssertFalse(clock.isRunning)
    }

    func testCountdownStopsWhenBannerClears() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let clock = ManualMaintenanceBannerClock(now: base)
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source, clock: clock)
        model.start()
        source.push(activeInput(until: isoString(from: base.addingTimeInterval(3600))))
        XCTAssertTrue(clock.isRunning)

        source.push(MaintenanceBannerInput(mode: "ok", hasData: true))
        XCTAssertNil(model.countdownText)
        XCTAssertFalse(clock.isRunning)
        XCTAssertGreaterThanOrEqual(clock.stopCount, 1)
    }

    func testStopTearsDownClock() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let clock = ManualMaintenanceBannerClock(now: base)
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source, clock: clock)
        model.start()
        source.push(activeInput(until: isoString(from: base.addingTimeInterval(3600))))
        model.stop()
        XCTAssertFalse(clock.isRunning)
    }

    // MARK: Freshness

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source)
        model.start()
        source.push(activeInput(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale does not re-trigger the auto-refresh.
        source.push(activeInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionTracked() {
        let source = InMemoryMaintenanceBannerSource()
        let model = makeModel(source: source)
        model.start()
        source.push(activeInput(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
    }
}
