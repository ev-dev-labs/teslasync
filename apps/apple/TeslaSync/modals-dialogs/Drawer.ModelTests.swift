//
//  Drawer.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  State-holder coverage for `DrawerModel`: the P1/S11 `view.opened` telemetry (once per presentation +
//  idempotent + re-armed on stop), the dismissal command (web `onClose`), the phase transitions across
//  loading / loaded-empty (default + parent override) / failed (incl. the reload-failure banner when
//  cached rows survive) / content, the header title + `aria-label` (web `title || 'Panel'`), the footer
//  count, the stale auto-refresh (once, re-armed on return to live), offline keeping the cached rows,
//  retry, the stored edge, and the surface slug. Driven through the in-memory source — no HTTP.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyDrawerTelemetry: DrawerTelemetry, @unchecked Sendable {
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

@MainActor
final class DrawerModelTests: XCTestCase {
    /// A MainActor-isolated close counter the dismissal command increments (web `onClose`).
    private final class CloseSpy {
        var count = 0
    }

    private func makeModel(
        source: InMemoryDrawerSource,
        title: String? = "Vehicle details",
        edge: DrawerEdge = .trailing,
        showsFooter: Bool = true,
        emptyMessage: String? = nil,
        telemetry: SpyDrawerTelemetry = SpyDrawerTelemetry(),
        onClose: @escaping @MainActor () -> Void = {}
    ) -> DrawerModel {
        DrawerModel(
            source: source,
            title: title,
            edge: edge,
            showsFooter: showsFooter,
            emptyMessage: emptyMessage,
            telemetry: telemetry,
            onClose: onClose,
            localize: passthroughLocalize
        )
    }

    private func items(_ count: Int = 2) -> [DrawerContentItem] {
        (0 ..< count).map { DrawerContentItem(id: "k\($0)", label: "L\($0)", value: "V\($0)") }
    }

    // MARK: Telemetry + lifecycle

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyDrawerTelemetry()
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["Drawer"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopReArmsViewOpenedForNextPresentation() {
        let spy = SpyDrawerTelemetry()
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["Drawer", "Drawer"])
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testDismissInvokesOnClose() {
        let closeSpy = CloseSpy()
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source, onClose: { closeSpy.count += 1 })
        model.start()
        model.dismiss()
        XCTAssertEqual(closeSpy.count, 1)
    }

    func testRetryRefreshesSource() {
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source)
        model.start()
        model.retry()
        XCTAssertEqual(source.refreshCount, 1)
    }

    // MARK: Phases

    func testLoadingThenContent() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(DrawerUpdate(status: .loaded, items: items()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.countSummary, "2 items")
    }

    func testLoadedNoItemsResolvesEmptyWithDefaultMessage() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.emptyMessage, "Nothing to show here yet")
    }

    func testEmptyMessageOverrideIsUsed() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loaded))
        let model = makeModel(source: source, emptyMessage: "No drives recorded")
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.emptyMessage, "No drives recorded")
    }

    func testFailedNoItemsResolvesErrorWithNoBanner() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.reloadFailureMessage)
    }

    func testFailedWithItemsKeepsContentAndSurfacesBanner() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loaded, items: items()))
        let model = makeModel(source: source)
        model.start()
        source.push(DrawerUpdate(status: .failed("stale read"), items: items()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.reloadFailureMessage, "stale read")
    }

    // MARK: Header + edge + slug

    func testHeaderTitleDrivesDialogLabel() {
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source, title: "Vehicle details")
        XCTAssertTrue(model.hasHeader)
        XCTAssertEqual(model.dialogLabel, "Vehicle details")
    }

    func testHeaderlessFallsBackToPanelLabel() {
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source, title: nil)
        XCTAssertFalse(model.hasHeader)
        XCTAssertEqual(model.dialogLabel, "Panel")
    }

    func testEdgeIsStoredAndSlugIsStable() {
        let source = InMemoryDrawerSource()
        let model = makeModel(source: source, edge: .leading)
        XCTAssertEqual(model.edge, .leading)
        XCTAssertEqual(Drawer.surfaceSlug, "Drawer")
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loaded, items: items()))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(DrawerUpdate(status: .loaded, items: items(), connection: .stale))
        source.push(DrawerUpdate(status: .loaded, items: items(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(DrawerUpdate(status: .loaded, items: items(), connection: .live))
        source.push(DrawerUpdate(status: .loaded, items: items(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsItemsAndDoesNotRefresh() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loaded, items: items()))
        let model = makeModel(source: source)
        model.start()
        source.push(DrawerUpdate(status: .loaded, items: items(3), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 3)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testAccessibilitySummaryReflectsPhaseAndFreshness() {
        let source = InMemoryDrawerSource(initial: DrawerUpdate(status: .loaded, items: items()))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Content loaded")
        source.push(DrawerUpdate(status: .loaded, items: items(), connection: .offline))
        XCTAssertEqual(model.accessibilitySummary, "Content loaded, Offline")
    }
}
