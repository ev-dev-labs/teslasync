//
//  QuickLinksSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  State-holder + render coverage for the QuickLinksSection surface (split from
//  `QuickLinksSection.Tests.swift` to keep each file within the lint length budget):
//    • State holder — `QuickLinksViewModel` phase + connection resolution, the guarded
//      stale auto-refresh, the offline-keeps-cache behavior, and the P1/S11
//      `view.opened` telemetry + source wiring (incl. `StaticQuickLinksCatalogSource`).
//    • Per-state render smoke — every state rasterizes (snapshot) without crashing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryQuickLinksCatalogSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + connection + telemetry + source wiring

@MainActor final class QuickLinksViewModelTests: XCTestCase {
    private func makeModel(
        _ update: QuickLinksCatalogUpdate,
        telemetry: QuickLinksViewTelemetry = OSLogQuickLinksViewTelemetry()
    ) -> (QuickLinksViewModel, InMemoryQuickLinksCatalogSource) {
        let source = InMemoryQuickLinksCatalogSource(initial: update)
        let model = QuickLinksViewModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutItemsShowsLoading() {
        let (model, _) = makeModel(QuickLinksCatalogUpdate(status: .loading, destinations: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testLoadedWithItemsShowsContent() {
        let (model, _) = makeModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog
        ))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 6)
        XCTAssertEqual(model.connection, .live)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        let (model, _) = makeModel(QuickLinksCatalogUpdate(status: .loaded, destinations: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutItemsShowsError() {
        let (model, _) = makeModel(QuickLinksCatalogUpdate(status: .failed("boom"), destinations: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyQuickLinksViewTelemetry()
        let (model, source) = makeModel(
            QuickLinksCatalogUpdate(status: .loaded, destinations: QuickLinksDestination.catalog),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [QuickLinksSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleConnectionTriggersExactlyOneAutoRefresh() {
        let (model, source) = makeModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .live
        ))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .stale
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 1)

        // Still stale → guarded, no second auto-refresh.
        source.push(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveResetsStaleGuardSoStaleRetriggers() {
        let (model, source) = makeModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .live
        ))
        model.start()
        source.push(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .stale
        ))
        source.push(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .live
        ))
        source.push(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedGridWithoutRefresh() {
        let (model, source) = makeModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .live
        ))
        model.start()
        source.push(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 6)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopDelegatesToSourceAndReArmsOnNextStart() {
        let (model, source) = makeModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog
        ))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog
        ))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaticSourcePublishesCanonicalLiveCatalog() {
        var received: QuickLinksCatalogUpdate?
        let source = StaticQuickLinksCatalogSource()
        source.onUpdate = { update in received = update }
        source.start()
        XCTAssertEqual(received?.status, .loaded)
        XCTAssertEqual(received?.connection, .live)
        XCTAssertEqual(received?.destinations, QuickLinksDestination.catalog)
    }
}

// MARK: - Per-state render smoke (snapshot)

@MainActor final class QuickLinksRenderTests: XCTestCase {
    private func render(_ update: QuickLinksCatalogUpdate) -> CGImage? {
        let source = InMemoryQuickLinksCatalogSource(initial: update)
        let model = QuickLinksViewModel(source: source)
        model.start()
        let view = QuickLinksSection(model: model)
            .frame(width: 520, height: 260)
        return ImageRenderer(content: view).cgImage
    }

    func testContentLiveStateRenders() {
        XCTAssertNotNil(render(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .live
        )))
    }

    func testContentStaleStateRenders() {
        XCTAssertNotNil(render(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .stale
        )))
    }

    func testContentOfflineStateRenders() {
        XCTAssertNotNil(render(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: QuickLinksDestination.catalog,
            connection: .offline
        )))
    }

    func testLoadingStateRenders() {
        XCTAssertNotNil(render(QuickLinksCatalogUpdate(status: .loading, destinations: [])))
    }

    func testEmptyStateRenders() {
        XCTAssertNotNil(render(QuickLinksCatalogUpdate(status: .loaded, destinations: [])))
    }

    func testErrorStateRenders() {
        XCTAssertNotNil(render(QuickLinksCatalogUpdate(status: .failed("Network unavailable"), destinations: [])))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyQuickLinksViewTelemetry: QuickLinksViewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
