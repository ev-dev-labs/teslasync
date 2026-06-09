//
//  SlideRenderer.ModelTests.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  State-holder coverage for SlideRendererModel: phase resolution, select() clamp/reproject/delegation, refresh + stale
//  auto-refresh, connection/fetching tracking, currentContext, and the view.opened telemetry. Shares
//  SlideRendererFixture (SlideRenderer.Tests.swift).
//

import XCTest
@testable import TeslaSync

// MARK: - State holder

@MainActor
final class SlideRendererModelTests: XCTestCase {
    private func makeModel(
        _ update: SlideRendererUpdate,
        telemetry: SlideRendererTelemetry = OSLogSlideRendererTelemetry()
    ) -> (SlideRendererModel, InMemorySlideRendererSource) {
        let source = InMemorySlideRendererSource(initial: update)
        let model = SlideRendererModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(index: Int = 0, connection: SlideRendererConnection = .live) -> SlideRendererUpdate {
        SlideRendererUpdate(
            status: .loaded,
            connection: connection,
            slides: SlideRendererFixture.deck(),
            index: index,
            data: SlideRendererFixture.recap()
        )
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(SlideRendererModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsSelectedSlide() {
        let (model, _) = makeModel(loaded(index: 1))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.index, 1)
        XCTAssertEqual(model.projection?.kind, .statHero)
        XCTAssertNotNil(model.currentContext)
    }

    func testLoadingHasNoContextOrProjection() {
        let (model, _) = makeModel(SlideRendererUpdate(status: .loading, slides: SlideRendererFixture.deck()))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
        XCTAssertNil(model.currentContext)
    }

    func testSelectClampsReprojectsAndDelegates() {
        let (model, source) = makeModel(loaded(index: 0))
        model.start()

        model.select(index: 3)
        XCTAssertEqual(model.index, 3)
        XCTAssertEqual(model.projection?.kind, .driveHighlight)

        model.select(index: 99)
        XCTAssertEqual(model.index, 11)
        XCTAssertEqual(model.projection?.kind, .summary)

        model.select(index: -4)
        XCTAssertEqual(model.index, 0)
        XCTAssertEqual(model.projection?.kind, .title)

        XCTAssertEqual(source.selectedIndices, [3, 11, 0])
    }

    func testCachedDeckStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded(index: 2))
        model.start()
        source.push(
            SlideRendererUpdate(
                status: .failed("net"),
                slides: SlideRendererFixture.deck(),
                index: 2,
                data: SlideRendererFixture.recap()
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.kind, .statChart)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshIsGuarded() {
        let (model, source) = makeModel(loaded())
        model.start()

        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(loaded(connection: .stale))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)

        source.push(
            SlideRendererUpdate(
                status: .loaded, connection: .stale, isFetching: true,
                slides: SlideRendererFixture.deck(), index: 0, data: SlideRendererFixture.recap()
            )
        )
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(SlideRendererUpdate(status: .loading, slides: SlideRendererFixture.deck()))
        model.start()
        source.push(
            SlideRendererUpdate(
                status: .loaded, connection: .offline, isFetching: true,
                slides: SlideRendererFixture.deck(), index: 0, data: SlideRendererFixture.recap(),
                localeIdentifier: "de_DE", updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertEqual(model.localeIdentifier, "de_DE")
        XCTAssertNotNil(model.updatedAt)
        XCTAssertEqual(model.currentContext?.connection, .offline)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpySlideRendererTelemetry()
        let (model, source) = makeModel(SlideRendererUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SlideRendererSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Test doubles

private final class SpySlideRendererTelemetry: SlideRendererTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
