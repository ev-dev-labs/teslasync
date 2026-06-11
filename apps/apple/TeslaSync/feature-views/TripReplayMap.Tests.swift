//
//  TripReplayMap.Tests.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  Projection + state-holder coverage for the TripReplayMap surface: the route geometry
//  (the web component body — `hasRoute`, trail, speed segments, start/end pins,
//  stationary anchor, the heading-aware playhead clamp, the centre fallback) and the
//  `TripReplayMapModel` (phase resolution, projection wiring, the P1/S11 `view.opened`
//  telemetry exactly once, the seek delegation, the one-shot stale auto-refresh + its
//  re-arm, and offline keeping the cached route). Driven through an in-memory source —
//  no network, no real store, no rendered map.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixture

private enum Fixture {
    /// A six-sample route with a range of speeds so every band colors a segment.
    static let route: [TripReplayPosition] = [
        TripReplayPosition(latitude: 37.7749, longitude: -122.4194, speed: 0),
        TripReplayPosition(latitude: 37.7769, longitude: -122.4181, speed: 25),
        TripReplayPosition(latitude: 37.7799, longitude: -122.4155, speed: 48),
        TripReplayPosition(latitude: 37.7841, longitude: -122.4119, speed: 72),
        TripReplayPosition(latitude: 37.7894, longitude: -122.4078, speed: 105),
        TripReplayPosition(latitude: 37.7939, longitude: -122.4032, speed: 60)
    ]

    static let stationary: [TripReplayPosition] = Array(
        repeating: TripReplayPosition(latitude: 37.7749, longitude: -122.4194, speed: 0),
        count: 6
    )
}

// MARK: - Projection (web component body)

final class TripReplayRouteTests: XCTestCase {
    func testEmptyPositionsYieldNoMapGeometry() {
        let route = TripReplayRoute.make(positions: [], currentIndex: 0)
        XCTAssertFalse(route.hasPositions)
        XCTAssertFalse(route.hasRoute)
        XCTAssertTrue(route.trail.isEmpty)
        XCTAssertTrue(route.segments.isEmpty)
        XCTAssertNil(route.startPin)
        XCTAssertNil(route.endPin)
        XCTAssertNil(route.anchor)
        XCTAssertNil(route.playhead)
        XCTAssertFalse(route.showStationaryBanner)
    }

    func testEmptyCentreFallsBackToSeattle() {
        let route = TripReplayRoute.make(positions: [], currentIndex: 0)
        XCTAssertEqual(route.center.latitude, 47.6, accuracy: 0.0001)
        XCTAssertEqual(route.center.longitude, -122.3, accuracy: 0.0001)
    }

    func testRouteBuildsTrailSegmentsAndPins() {
        let route = TripReplayRoute.make(positions: Fixture.route, currentIndex: 2)
        XCTAssertTrue(route.hasPositions)
        XCTAssertTrue(route.hasRoute)
        XCTAssertEqual(route.trail.count, 6, "trail maps every position 1:1 when hasRoute")
        XCTAssertEqual(route.segments.count, 5, "one colored leg per consecutive pair")
        XCTAssertEqual(route.startPin, route.trail.first)
        XCTAssertEqual(route.endPin, route.trail.last)
        XCTAssertNil(route.anchor, "no stationary anchor when there is a real route")
        XCTAssertFalse(route.showStationaryBanner)
        XCTAssertEqual(route.cameraCoordinates.count, 6, "the camera fits the whole trail")
    }

    func testSegmentBandsUseTheLaterSampleSpeed() {
        // speeds[1...5] = 25, 48, 72, 105, 60 → slow, moderate, fast, veryFast, fast.
        let route = TripReplayRoute.make(positions: Fixture.route, currentIndex: 0)
        XCTAssertEqual(route.segments.map(\.band), [.slow, .moderate, .fast, .veryFast, .fast])
    }

    func testPlayheadTracksCurrentIndex() {
        let route = TripReplayRoute.make(positions: Fixture.route, currentIndex: 2)
        let playhead = try? XCTUnwrap(route.playhead)
        XCTAssertEqual(playhead?.latitude, Fixture.route[2].latitude)
        XCTAssertEqual(playhead?.longitude, Fixture.route[2].longitude)
    }

    func testPlayheadIsNilForOutOfRangeIndex() {
        // Web `positions[currentIndex] ?? null` — an out-of-range index has no playhead.
        let route = TripReplayRoute.make(positions: Fixture.route, currentIndex: 99)
        XCTAssertNil(route.playhead)
    }

    func testPlayheadIsNilWhenStationary() {
        let route = TripReplayRoute.make(positions: Fixture.stationary, currentIndex: 0)
        XCTAssertNil(route.playhead)
    }

    func testStationaryGpsProducesAnchorAndBanner() {
        let route = TripReplayRoute.make(positions: Fixture.stationary, currentIndex: 0)
        XCTAssertTrue(route.hasPositions)
        XCTAssertFalse(route.hasRoute)
        XCTAssertTrue(route.trail.isEmpty)
        XCTAssertTrue(route.segments.isEmpty)
        XCTAssertNil(route.startPin)
        XCTAssertEqual(route.anchor?.latitude, 37.7749)
        XCTAssertTrue(route.showStationaryBanner)
        XCTAssertEqual(route.cameraCoordinates.count, 1, "stationary camera drops on the single anchor")
    }

    func testNearestTrailIndexResolvesTappedCoordinate() {
        let route = TripReplayRoute.make(positions: Fixture.route, currentIndex: 0)
        let target = Fixture.route[4]
        let index = route.nearestTrailIndex(latitude: target.latitude, longitude: target.longitude)
        XCTAssertEqual(index, 4)
    }

    func testNearestTrailIndexEmptyIsZero() {
        let route = TripReplayRoute.make(positions: [], currentIndex: 0)
        XCTAssertEqual(route.nearestTrailIndex(latitude: 1, longitude: 1), 0)
    }
}

// MARK: - Phase resolution (pure)

final class TripReplayPhaseTests: XCTestCase {
    func testPhaseResolution() {
        typealias Model = TripReplayMapModel
        XCTAssertEqual(Model.resolvePhase(.loading, hasPositions: false), .loading)
        XCTAssertEqual(Model.resolvePhase(.loading, hasPositions: true), .data)
        XCTAssertEqual(Model.resolvePhase(.loaded, hasPositions: true), .data)
        XCTAssertEqual(Model.resolvePhase(.loaded, hasPositions: false), .empty)
        XCTAssertEqual(Model.resolvePhase(.failed("boom"), hasPositions: false), .error("boom"))
        XCTAssertEqual(Model.resolvePhase(.failed("boom"), hasPositions: true), .data)
    }
}

// MARK: - State holder

@MainActor
final class TripReplayMapModelTests: XCTestCase {
    private func makeModel(
        _ input: TripReplayMapInput,
        telemetry: TripReplayMapTelemetry = SpyTripReplayMapTelemetry()
    ) -> (TripReplayMapModel, InMemoryTripReplayMapSource) {
        let source = InMemoryTripReplayMapSource(initial: input)
        let model = TripReplayMapModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(
        connection: TripReplayMapConnection = .live,
        isFetching: Bool = false,
        currentIndex: Int = 2
    ) -> TripReplayMapInput {
        TripReplayMapInput(
            status: .loaded,
            positions: Fixture.route,
            currentIndex: currentIndex,
            reduceMotion: false,
            connection: connection,
            isFetching: isFetching
        )
    }

    func testLoadedRouteProjectsDataPhase() {
        let (model, source) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.route.hasRoute)
        XCTAssertEqual(model.positions.count, 6)
        XCTAssertEqual(model.currentIndex, 2)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedWithNoPositionsIsEmpty() {
        let (model, _) = makeModel(TripReplayMapInput(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.route.hasPositions)
    }

    func testLoadingWithoutPositionsIsLoading() {
        let (model, _) = makeModel(TripReplayMapInput(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedPositionsKeepsData() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(loaded(connection: .live, isFetching: true))
        XCTAssertEqual(model.phase, .data, "a re-fetch keeps the cached route on screen")
    }

    func testFailedWithoutPositionsIsErrorButCachedKeepsData() {
        let (model, source) = makeModel(TripReplayMapInput(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        source.push(TripReplayMapInput(status: .failed("again"), positions: Fixture.route))
        XCTAssertEqual(model.phase, .data, "a transient failure keeps the cached route")
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTripReplayMapTelemetry()
        let (model, source) = makeModel(TripReplayMapInput(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TripReplayMapSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testSeekDelegatesUpstream() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.seek(to: 4)
        XCTAssertEqual(source.seekedIndices, [4])
    }

    func testStaleAutoRefreshesExactlyOnceThenReArmsOnLive() {
        let (model, source) = makeModel(TripReplayMapInput(status: .loading))
        model.start()
        source.push(loaded(connection: .stale))
        model.autoRefreshIfStale()
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1, "stale triggers exactly one guarded auto-refresh")
        source.push(loaded(connection: .live))
        model.autoRefreshIfStale()
        source.push(loaded(connection: .stale))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the one-shot")
    }

    func testOfflineKeepsCachedRouteWithoutRefresh() {
        let (model, source) = makeModel(TripReplayMapInput(status: .loading))
        model.start()
        source.push(loaded(connection: .offline))
        model.autoRefreshIfStale()
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testSnapshotMetadataTracked() {
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        let input = TripReplayMapInput(
            status: .loaded,
            positions: Fixture.route,
            currentIndex: 1,
            reduceMotion: true,
            updatedAt: when
        )
        let (model, _) = makeModel(input)
        model.start()
        XCTAssertEqual(model.updatedAt, when)
        XCTAssertTrue(model.reduceMotion)
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
private final class SpyTripReplayMapTelemetry: TripReplayMapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
