//
//  TourLauncher.ModelTests.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  State-holder coverage for `TourLauncherModel`: the P1/S11 `view.opened` telemetry + the
//  web `markTourListSeen` (once + idempotent), the phase transitions across loading /
//  loaded-empty / failed (incl. the inline-error envelope when cached rows survive a failed
//  reload), the projected rows (completed + route-recommended), the Start / Replay command seam
//  (web `dispatchTourStart`), "Reset all tours" (web `resetAllTours`), the stale auto-refresh
//  (once, re-armed on return to live), and offline keeping cached rows. Driven through the
//  in-memory source — no persistence.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam
/// under Swift 6 strict concurrency.
private final class SpyTourLauncherTelemetry: TourLauncherTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Records the started tour ids + the list-seen calls.
private final class SpyTourLauncherController: TourLauncherController, @unchecked Sendable {
    private let lock = NSLock()
    private var started: [String] = []
    private var seen = 0

    func startTour(id: String) {
        lock.lock()
        started.append(id)
        lock.unlock()
    }

    func markListSeen() {
        lock.lock()
        seen += 1
        lock.unlock()
    }

    var startedIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return started
    }

    var seenCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }
}

@MainActor
final class TourLauncherModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryTourLauncherSource,
        telemetry: SpyTourLauncherTelemetry = SpyTourLauncherTelemetry(),
        controller: SpyTourLauncherController = SpyTourLauncherController()
    ) -> TourLauncherModel {
        TourLauncherModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedAndListSeenOnceAndIsIdempotent() {
        let spy = SpyTourLauncherTelemetry()
        let controller = SpyTourLauncherController()
        let source = InMemoryTourLauncherSource()
        let model = makeModel(source: source, telemetry: spy, controller: controller)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["TourLauncher"])
        XCTAssertEqual(controller.seenCount, 1)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryTourLauncherSource(initial: TourLauncherUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(TourLauncherUpdate(status: .loaded, entries: TourCatalog.all, pathname: "/"))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, TourCatalog.all.count)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryTourLauncherSource(initial: TourLauncherUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testFailedNoRowsResolvesError() {
        let source = InMemoryTourLauncherSource(initial: TourLauncherUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsContentAndSurfacesInlineError() {
        let loaded = TourLauncherUpdate(status: .loaded, entries: TourCatalog.all)
        let source = InMemoryTourLauncherSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(TourLauncherUpdate(status: .failed("stale read"), entries: TourCatalog.all))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testRowsReflectCompletionAndRoute() {
        let source = InMemoryTourLauncherSource(
            initial: TourLauncherUpdate(
                status: .loaded,
                entries: TourCatalog.all,
                completedIDs: ["drives"],
                pathname: "/vehicles"
            )
        )
        let model = makeModel(source: source)
        model.start()
        let vehicles = model.rows.first { $0.id == "vehicles" }
        let drives = model.rows.first { $0.id == "drives" }
        XCTAssertEqual(vehicles?.recommended, true)
        XCTAssertEqual(vehicles?.action, .start)
        XCTAssertEqual(drives?.completed, true)
        XCTAssertEqual(drives?.action, .replay)
    }

    func testStartTourDelegatesToController() {
        let controller = SpyTourLauncherController()
        let source = InMemoryTourLauncherSource(
            initial: TourLauncherUpdate(status: .loaded, entries: TourCatalog.all)
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.startTour("charging")
        XCTAssertEqual(controller.startedIDs, ["charging"])
    }

    func testResetAllClearsCompletionThroughSource() {
        let source = InMemoryTourLauncherSource(
            initial: TourLauncherUpdate(
                status: .loaded,
                entries: TourCatalog.all,
                completedIDs: ["main", "drives"]
            )
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.rows.filter(\.completed).count, 2)
        model.resetAllTours()
        XCTAssertEqual(source.resetCount, 1)
        XCTAssertTrue(model.completedIDs.isEmpty)
        XCTAssertEqual(model.rows.filter(\.completed).count, 0)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = TourLauncherUpdate(status: .loaded, entries: TourCatalog.all)
        let source = InMemoryTourLauncherSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(TourLauncherUpdate(status: .loaded, entries: TourCatalog.all, connection: .stale))
        source.push(TourLauncherUpdate(status: .loaded, entries: TourCatalog.all, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(TourLauncherUpdate(status: .loaded, entries: TourCatalog.all, connection: .live))
        source.push(TourLauncherUpdate(status: .loaded, entries: TourCatalog.all, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsRowsAndDoesNotRefresh() {
        let loaded = TourLauncherUpdate(status: .loaded, entries: TourCatalog.all)
        let source = InMemoryTourLauncherSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(TourLauncherUpdate(status: .loaded, entries: TourCatalog.all, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
