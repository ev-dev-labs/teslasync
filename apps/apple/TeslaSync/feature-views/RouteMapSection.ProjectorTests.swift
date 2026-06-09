//
//  RouteMapSection.ProjectorTests.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  Adapter (cached → projection) coverage for `RouteMapProjector`: the telemetry-preferred `routeSource`,
//  the trail / segments / start-end-anchor markers, the center fallback, the speed legend, and the
//  stationary-GPS gating — all reproducing the web `useDriveDetailData` + `RouteMapSection` derivation.
//  Shares `RouteMapFixture` from RouteMapSection.Tests.swift.
//

import XCTest
@testable import TeslaSync

final class RouteMapProjectorTests: XCTestCase {
    private func project(_ drive: RouteMapDrive) -> RouteMapProjection {
        RouteMapProjector.project(drive: drive, prefs: RouteMapFixture.prefs)
    }

    func testRoutedDriveProducesTrailAndSegments() {
        let projection = project(RouteMapFixture.routedDrive())
        XCTAssertTrue(projection.hasTrail)
        XCTAssertTrue(projection.hasRoute)
        XCTAssertEqual(projection.trail.count, 6)
        XCTAssertEqual(projection.segments.count, 5)
        XCTAssertEqual(projection.segments.map(\.band), [.lowMid, .lowMid, .midHigh, .high, .midHigh])
    }

    func testStartAndEndMarkersResolvedForRoute() {
        let projection = project(RouteMapFixture.routedDrive())
        XCTAssertEqual(projection.startMarker?.kind, .start)
        XCTAssertEqual(projection.startMarker?.title, "Start")
        XCTAssertTrue(projection.startMarker?.detail?.hasPrefix("Apr 4, 2026") ?? false)
        XCTAssertEqual(projection.endMarker?.kind, .end)
        XCTAssertEqual(projection.endMarker?.title, "End")
        XCTAssertNil(projection.anchorMarker)
    }

    func testInProgressDriveEndMarkerShowsInProgress() {
        let projection = project(RouteMapFixture.routedDrive(ended: false))
        XCTAssertEqual(projection.endMarker?.detail, "In progress")
        XCTAssertNil(projection.endTimeText)
    }

    func testStationaryDriveShowsAnchorAndBannerNotSegments() {
        let projection = project(RouteMapFixture.stationaryDrive())
        XCTAssertTrue(projection.hasTrail)
        XCTAssertFalse(projection.hasRoute)
        XCTAssertTrue(projection.showStationaryBanner)
        XCTAssertNil(projection.startMarker)
        XCTAssertNil(projection.endMarker)
        XCTAssertEqual(projection.anchorMarker?.kind, .anchor)
        XCTAssertEqual(projection.anchorMarker?.title, "Last known location")
        XCTAssertTrue(projection.segments.isEmpty)
        XCTAssertFalse(projection.showLegend)
    }

    func testEmptyDriveHasNoTrailAndCentersOnFallback() {
        let projection = project(RouteMapFixture.emptyDrive())
        XCTAssertFalse(projection.hasTrail)
        XCTAssertTrue(projection.trail.isEmpty)
        XCTAssertEqual(projection.center, RouteMapProjector.fallbackCenter)
        XCTAssertEqual(projection.cameraCoordinates, [RouteMapProjector.fallbackCenter])
    }

    func testRouteSourcePrefersTelemetryThenPositions() {
        // Telemetry present with one (0,0) sample → it is filtered out; positions are ignored.
        let drive = RouteMapDrive(
            driveID: "x",
            positions: RouteMapFixture.routePositions,
            telemetry: [
                RouteMapTelemetrySample(latitude: 0, longitude: 0, speedMps: 0),
                RouteMapTelemetrySample(latitude: 37.7749, longitude: -122.4194, speedMps: 5),
                RouteMapTelemetrySample(latitude: nil, longitude: nil, speedMps: 5)
            ]
        )
        let projection = project(drive)
        XCTAssertEqual(projection.trail.count, 1) // only the one valid telemetry coord
    }

    func testRouteSourceFallsBackToPositionsWhenNoTelemetry() {
        let projection = project(RouteMapFixture.routedDrive(withTelemetry: false))
        XCTAssertEqual(projection.trail.count, 6)
        XCTAssertTrue(projection.hasRoute)
    }

    func testCenterUsesFirstTrailPointWhenAvailable() {
        let projection = project(RouteMapFixture.routedDrive())
        XCTAssertEqual(projection.center.latitude, 37.7749, accuracy: 0.0001)
        XCTAssertEqual(projection.cameraCoordinates.count, projection.trail.count)
    }

    func testLegendLabelsMatchWebThresholdsMph() {
        let projection = project(RouteMapFixture.routedDrive())
        XCTAssertEqual(projection.speedUnitLabel, "mph")
        XCTAssertEqual(projection.legend.map(\.label), ["<30", "30–60", "60–100", ">100"])
        XCTAssertTrue(projection.showLegend)
    }

    func testLegendLabelsConvertForKmh() {
        let prefs = RouteMapFormatPrefs(
            localeIdentifier: "en_US",
            timeZoneIdentifier: "America/Los_Angeles",
            speedUnit: "km/h",
            precision: 0
        )
        let projection = RouteMapProjector.project(drive: RouteMapFixture.routedDrive(), prefs: prefs)
        XCTAssertEqual(projection.legend.map(\.label), ["<48", "48–97", "97–161", ">161"])
    }

    func testFooterTimesPresentForFinishedDrive() {
        let projection = project(RouteMapFixture.routedDrive())
        XCTAssertTrue(projection.startTimeText.contains("2:30"))
        XCTAssertNotNil(projection.endTimeText)
        XCTAssertTrue(projection.endTimeText?.contains("3:10") ?? false)
    }
}
