//
//  RouteMapSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  State-holder + view coverage for the route-map surface:
//    • `RouteMapSectionModel` phase resolution across loading / empty / error / content, projection
//      recompute, refresh delegation, the stale auto-refresh guard, and the P1/S11 `view.opened`
//      telemetry.
//    • View — every render state (loading / empty / error / stale / offline / content / stationary)
//      materializes through `ImageRenderer`.
//  Shares `RouteMapFixture` from RouteMapSection.Tests.swift.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class RouteMapModelTests: XCTestCase {
    private func makeModel(
        _ update: RouteMapUpdate,
        telemetry: RouteMapSectionTelemetry = OSLogRouteMapSectionTelemetry()
    ) -> (RouteMapSectionModel, InMemoryRouteMapSource) {
        let source = InMemoryRouteMapSource(initial: update)
        let model = RouteMapSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(
        connection: RouteMapConnection = .live,
        isFetching: Bool = false,
        drive: RouteMapDrive = RouteMapFixture.routedDrive()
    ) -> RouteMapUpdate {
        RouteMapUpdate(
            status: .loaded,
            connection: connection,
            isFetching: isFetching,
            drive: drive,
            prefs: RouteMapFixture.prefs,
            updatedAt: Date()
        )
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(RouteMapSectionModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsRoute() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.trail.count, 6)
        XCTAssertTrue(model.projection?.hasRoute ?? false)
    }

    func testEmptyDriveStaysContentWithNoTrail() {
        let (model, _) = makeModel(loaded(drive: RouteMapFixture.emptyDrive()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.projection?.hasTrail ?? true)
    }

    func testEmptyLoadingErrorPhases() {
        let (empty, _) = makeModel(RouteMapUpdate(status: .empty, drive: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(RouteMapUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(RouteMapUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedMapStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            RouteMapUpdate(
                status: .failed("net"),
                connection: .offline,
                drive: RouteMapFixture.routedDrive(),
                prefs: RouteMapFixture.prefs
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testFreshnessTracksUpdates() {
        let (model, source) = makeModel(RouteMapUpdate(status: .loading))
        model.start()
        source.push(loaded(connection: .stale, isFetching: true))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndIdle() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(connection: .stale, isFetching: false))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(connection: .stale, isFetching: true))
        model.autoRefreshIfStale() // stale + fetching → guarded
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyRouteMapTelemetry()
        let (model, source) = makeModel(RouteMapUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RouteMapSectionSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor
    final class RouteMapViewStateTests: XCTestCase {
        private func renders(_ update: RouteMapUpdate) -> Bool {
            let source = InMemoryRouteMapSource(initial: update)
            let model = RouteMapSectionModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: RouteMapSection(model: model).frame(width: 520, height: 460))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func loaded(
            drive: RouteMapDrive = RouteMapFixture.routedDrive(),
            connection: RouteMapConnection = .live
        ) -> RouteMapUpdate {
            RouteMapUpdate(
                status: .loaded,
                connection: connection,
                drive: drive,
                prefs: RouteMapFixture.prefs,
                updatedAt: Date()
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testStationaryRenders() {
            XCTAssertTrue(renders(loaded(drive: RouteMapFixture.stationaryDrive())))
        }

        func testNoRouteRenders() {
            XCTAssertTrue(renders(loaded(drive: RouteMapFixture.emptyDrive())))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(RouteMapUpdate(status: .empty, drive: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(RouteMapUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(RouteMapUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(loaded(connection: .stale)))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(loaded(connection: .offline)))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRouteMapTelemetry: RouteMapSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
