import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `TripReplayPageModel` — the data states the page renders
/// (loading / error / ready / no-GPS), the pure replay derivations the web computes inline (the
/// position↔telemetry merge, the timeline/elevation series, the timeline markers), the transport
/// controls (seek by index / progress / frame / seconds, speed stepping, play-reset-at-end, the
/// virtual clock tick), the display formatters, and the navigation registration.
@MainActor
final class TripReplayPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private static let base = Date(timeIntervalSince1970: 1_700_000_000)

    private actor StubSource: TripReplayDataSource {
        let record: TripReplayRecord?

        init(record: TripReplayRecord?) {
            self.record = record
        }

        func loadDrive(driveID _: Int64) async throws -> TripReplayRecord {
            guard let record else { throw StubError() }
            return record
        }
    }

    private func position(
        minute: Double,
        speedMps: Double?,
        battery: Double,
        elevationM: Double?,
        powerW: Double?,
        lat: Double = 37.4,
        lon: Double = -122.0
    ) -> TripDrivePosition {
        TripDrivePosition(
            id: "p\(minute)",
            timestamp: Self.base.addingTimeInterval(minute * 60),
            latitude: lat,
            longitude: lon,
            speedMps: speedMps,
            powerW: powerW,
            batteryPct: battery,
            elevationM: elevationM,
            outsideTempC: 18,
            ratedRangeM: 290_000
        )
    }

    private func makeRecord(
        distanceM: Double = 18000,
        positions: [TripDrivePosition]? = nil,
        telemetry: [TripDrivePosition] = []
    ) -> TripReplayRecord {
        let rows = positions ?? [
            position(minute: 0, speedMps: 0, battery: 80, elevationM: 20, powerW: 5000, lat: 37.40, lon: -122.00),
            position(minute: 1, speedMps: 25, battery: 76, elevationM: 40, powerW: 38000, lat: 37.41, lon: -122.01),
            position(minute: 2, speedMps: 18, battery: 72, elevationM: 30, powerW: -8000, lat: 37.42, lon: -122.02),
            position(minute: 3, speedMps: 12, battery: 18, elevationM: 35, powerW: 12000, lat: 37.43, lon: -122.03)
        ]
        return TripReplayRecord(
            id: 7,
            vehicleID: 1,
            startedAt: Self.base,
            startAddress: "Mountain View",
            endAddress: "Palo Alto",
            distanceM: distanceM,
            durationS: 3 * 60,
            startBatteryPct: 80,
            endBatteryPct: 64,
            avgSpeedMps: 14,
            maxSpeedMps: 25,
            positions: rows,
            telemetry: telemetry
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        XCTAssertEqual(model.status, .loading)
        XCTAssertEqual(model.driveID, 7)
    }

    func testLoadResolvesToReady() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        XCTAssertEqual(model.status, .ready)
        XCTAssertEqual(model.record?.id, 7)
        XCTAssertTrue(model.hasPositions)
        XCTAssertEqual(model.positions.count, 4)
        XCTAssertEqual(model.totalTimeMs, 3 * 60 * 1000, accuracy: 0.5)
        XCTAssertEqual(model.currentIndex, 0)
    }

    func testDriveFailureResolvesToError() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: nil))
        await model.load()
        guard case .error = model.status else {
            return XCTFail("expected error phase, got \(model.status)")
        }
        XCTAssertFalse(model.hasPositions)
    }

    func testEmptyTrailResolvesToReadyWithoutPositions() async {
        let empty = makeRecord(positions: [])
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: empty))
        await model.load()
        XCTAssertEqual(model.status, .ready)
        XCTAssertFalse(model.hasPositions)
        XCTAssertNil(model.currentPosition)
    }

    func testRefreshKeepsReady() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.status, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Merge + derivations

    func testMergeFillsFromNearestTelemetry() {
        let positions = [
            position(minute: 0, speedMps: 10, battery: 0, elevationM: nil, powerW: nil, lat: 37.4, lon: -122.0),
            position(minute: 2, speedMps: 12, battery: 0, elevationM: nil, powerW: nil, lat: 37.5, lon: -122.1)
        ]
        let telemetry = [
            position(minute: 0, speedMps: nil, battery: 78, elevationM: 100, powerW: 9000, lat: 0, lon: 0),
            position(minute: 2, speedMps: nil, battery: 70, elevationM: 140, powerW: 21000, lat: 0, lon: 0)
        ]
        let record = makeRecord(positions: positions, telemetry: telemetry)
        let merged = TripReplayDerivations.mergedPositions(record)
        XCTAssertEqual(merged.count, 2)
        XCTAssertEqual(merged[0].batteryPct, 78, accuracy: 0.001)
        XCTAssertEqual(merged[0].elevationM ?? 0, 100, accuracy: 0.001)
        XCTAssertEqual(merged[0].powerW ?? 0, 9000, accuracy: 0.001)
        XCTAssertEqual(merged[0].speedMps ?? 0, 10, accuracy: 0.001) // position speed kept
    }

    func testMergeDropsNullIslandPositions() {
        let positions = [
            position(minute: 0, speedMps: 10, battery: 80, elevationM: 10, powerW: 0, lat: 0, lon: 0),
            position(minute: 1, speedMps: 10, battery: 80, elevationM: 10, powerW: 0, lat: 37.4, lon: -122.0)
        ]
        let merged = TripReplayDerivations.mergedPositions(makeRecord(positions: positions))
        XCTAssertEqual(merged.count, 1)
    }

    func testTimelineOffsetsAndIndexAtTime() {
        let offsets = TripReplayDerivations.timelineOffsets(makeRecord().positions)
        XCTAssertEqual(offsets, [0, 60_000, 120_000, 180_000])
        XCTAssertEqual(TripReplayDerivations.indexAtTime(offsets, 0), 0)
        XCTAssertEqual(TripReplayDerivations.indexAtTime(offsets, 59_000), 1)
        XCTAssertEqual(TripReplayDerivations.indexAtTime(offsets, 180_000), 3)
    }

    func testTimelineAndElevationSeries() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        XCTAssertEqual(model.timelineData.count, 4)
        XCTAssertEqual(model.timelineData[1].timeMin, 1, accuracy: 0.001)
        XCTAssertEqual(model.timelineData[1].speedMps, 25, accuracy: 0.001)
        XCTAssertEqual(model.timelineData[2].powerW, -8000, accuracy: 0.001)

        let elevation = model.elevationData
        XCTAssertEqual(elevation.count, 4)
        XCTAssertEqual(elevation[0].cumulativeDistanceM, 0, accuracy: 0.001)
        XCTAssertGreaterThan(elevation[3].cumulativeDistanceM, 0)
    }

    func testMarkersDetectFamilies() {
        let positions = [
            position(minute: 0, speedMps: 5, battery: 90, elevationM: 10, powerW: 1000),
            position(minute: 1, speedMps: 40, battery: 80, elevationM: 12, powerW: -25000),
            position(minute: 2, speedMps: 8, battery: 15, elevationM: 14, powerW: 5000),
            position(minute: 3, speedMps: 6, battery: 12, elevationM: 9, powerW: 2000)
        ]
        let markers = TripReplayDerivations.markers(positions)
        let kinds = Set(markers.map(\.kind))
        XCTAssertTrue(kinds.contains(.start))
        XCTAssertTrue(kinds.contains(.stop))
        XCTAssertTrue(kinds.contains(.fastSegment))
        XCTAssertTrue(kinds.contains(.regenPeak))
        XCTAssertTrue(kinds.contains(.lowSoc))
    }

    func testNearestMarkerWithinTolerance() {
        let markers = [
            TripReplayMarker(at: 0, index: 0, kind: .start),
            TripReplayMarker(at: 0.5, index: 5, kind: .fastSegment)
        ]
        XCTAssertEqual(TripReplayDerivations.nearestMarker(markers, progress: 0.51)?.kind, .fastSegment)
        XCTAssertNil(TripReplayDerivations.nearestMarker(markers, progress: 0.8))
    }

    // MARK: Transport controls

    func testSeekToIndexAndProgress() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        model.seekTo(index: 2)
        XCTAssertEqual(model.currentIndex, 2)
        XCTAssertEqual(model.elapsedMs, 120_000, accuracy: 0.5)
        XCTAssertEqual(model.progressFraction, 120_000.0 / 180_000.0, accuracy: 0.001)

        model.seekTo(progress: 0)
        XCTAssertEqual(model.currentIndex, 0)
        XCTAssertEqual(model.progressFraction, 0, accuracy: 0.001)
    }

    func testSeekToIndexClampsOutOfBounds() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        model.seekTo(index: 999)
        XCTAssertEqual(model.currentIndex, 3)
        model.seekTo(index: -5)
        XCTAssertEqual(model.currentIndex, 0)
    }

    func testStepFrameAndSeekBy() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        model.stepFrame(by: 1)
        XCTAssertEqual(model.currentIndex, 1)
        model.seekBy(seconds: 120)
        XCTAssertEqual(model.currentIndex, 3) // 60s + 120s = 180s = last
    }

    func testSpeedStepping() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        XCTAssertEqual(model.speed, .x1)
        model.stepSpeed(by: 2)
        XCTAssertEqual(model.speed, .x25)
        model.stepSpeed(by: 99)
        XCTAssertEqual(model.speed, .x100)
        model.setSpeed(.x10)
        XCTAssertEqual(model.speed, .x10)
    }

    func testPlayResetsWhenAtEnd() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        model.seekTo(progress: 1)
        XCTAssertEqual(model.currentIndex, 3)
        model.play()
        XCTAssertTrue(model.isPlaying)
        XCTAssertEqual(model.currentIndex, 0)
        model.pause()
        XCTAssertFalse(model.isPlaying)
    }

    func testStopRewinds() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        model.seekTo(index: 2)
        model.stop()
        XCTAssertFalse(model.isPlaying)
        XCTAssertEqual(model.currentIndex, 0)
        XCTAssertEqual(model.elapsedMs, 0, accuracy: 0.001)
    }

    func testTickAdvancesAndClampsAtEnd() async {
        let model = TripReplayPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        model.setSpeed(.x100)
        for _ in 0 ..< 200 { model.tick() }
        XCTAssertEqual(model.currentIndex, 3)
        XCTAssertEqual(model.progressFraction, 1, accuracy: 0.001)
        XCTAssertFalse(model.isPlaying)
    }
}

// MARK: - Format + navigation registration

@MainActor
extension TripReplayPageModelTests {
    func testDurationFormat() {
        XCTAssertEqual(TripReplayPageFormat.duration(milliseconds: 0), "00:00")
        XCTAssertEqual(TripReplayPageFormat.duration(milliseconds: -5), "00:00")
        XCTAssertEqual(TripReplayPageFormat.duration(milliseconds: 65_000), "01:05")
        XCTAssertEqual(TripReplayPageFormat.duration(milliseconds: 3_661_000), "1:01:01")
    }

    func testDriveTimeFormat() {
        XCTAssertEqual(TripReplayPageFormat.driveTime(minutes: 45), "45m")
        XCTAssertEqual(TripReplayPageFormat.driveTime(minutes: 95), "1h 35m")
    }

    func testRouteRegistration() {
        let link = TripReplayLink(driveID: 42)
        XCTAssertEqual(link.driveID, 42)
        XCTAssertEqual(link, TripReplayLink(driveID: 42))
        let model = TripReplayPageModel(driveID: 42)
        XCTAssertEqual(model.driveID, 42)
        _ = TripReplayRouteRegistration.make(driveID: 42)
    }
}
