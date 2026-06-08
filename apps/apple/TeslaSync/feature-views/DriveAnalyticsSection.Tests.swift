//
//  DriveAnalyticsSection.Tests.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  Unit coverage for the DriveAnalyticsSection surface:
//    • Adapter (cached → projection) — `DriveAnalyticsSectionProjector` value parity with the web
//      source's three useMemo pipelines (the speed-bucket histogram incl. the boundary-conversion
//      cancellation, the peak-power-vs-distance scatter + mean reference, the recent-drives power
//      profile, the km / mph unit glyphs, the JS `Math.round` + `formatDateShort` helpers).
//    • State holder — `DriveAnalyticsSectionModel` phase resolution (web parent loading → error → body
//      precedence), the P1/S11 `view.opened` telemetry, refresh + range + stale auto-refresh wiring.
//    • Accessibility — the per-chart + section VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by `InMemoryDriveAnalyticsSectionSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum DriveAnalyticsFixture {
    static let utc = TimeZone(identifier: "UTC")!
    static let rangeStart = Date(timeIntervalSince1970: 1_772_400_000)
    static let rangeEnd = Date(timeIntervalSince1970: 1_775_000_000)

    static func drive(
        id: Int,
        speed: Double?,
        power: Double?,
        distance: Double,
        iso: String = "2026-04-04T14:30:00Z"
    ) -> DriveAnalyticsSectionDrive {
        DriveAnalyticsSectionDrive(id: id, startTs: iso, distanceM: distance, avgSpeedMps: speed, avgPowerW: power)
    }

    static func data(
        _ drives: [DriveAnalyticsSectionDrive],
        units: DriveAnalyticsSectionUnits = .metric
    ) -> DriveAnalyticsSectionData {
        DriveAnalyticsSectionData(drives: drives, units: units, rangeStart: rangeStart, rangeEnd: rangeEnd)
    }

    static func project(
        _ data: DriveAnalyticsSectionData?,
        copy: DriveAnalyticsSectionCopy = .fallback
    ) -> DriveAnalyticsSectionProjection {
        DriveAnalyticsSectionProjector.project(data: data, copy: copy, localeIdentifier: "en_US", timeZone: utc)
    }

    /// One drive per speed bucket (plus a speed-less drive) → counts [2, 1, 1, 1, 1].
    static let speedDrives: [DriveAnalyticsSectionDrive] = [
        drive(id: 0, speed: 10, power: nil, distance: 1000),
        drive(id: 1, speed: 25, power: nil, distance: 1000),
        drive(id: 2, speed: 45, power: nil, distance: 1000),
        drive(id: 3, speed: 70, power: nil, distance: 1000),
        drive(id: 4, speed: 95, power: nil, distance: 1000),
        drive(id: 5, speed: 130, power: nil, distance: 1000),
        drive(id: 6, speed: nil, power: nil, distance: 1000)
    ]

    /// Three power readings (one drive without power is skipped).
    static let powerDrives: [DriveAnalyticsSectionDrive] = [
        drive(id: 0, speed: nil, power: 10000, distance: 5000, iso: "2026-04-04T12:00:00Z"),
        drive(id: 1, speed: nil, power: 20000, distance: 15000, iso: "2026-04-05T12:00:00Z"),
        drive(id: 2, speed: nil, power: nil, distance: 8000, iso: "2026-04-06T12:00:00Z"),
        drive(id: 3, speed: nil, power: 30000, distance: 25000, iso: "2026-04-07T12:00:00Z")
    ]
}

// MARK: - Adapter: speed distribution

final class DriveAnalyticsSpeedTests: XCTestCase {
    func testSpeedBucketsMatchWeb() {
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(DriveAnalyticsFixture.speedDrives))
        XCTAssertEqual(projection.speedDistribution.map(\.count), [2, 1, 1, 1, 1])
        XCTAssertEqual(projection.speedDistribution.first?.range, "0–30 km/h")
        XCTAssertEqual(projection.speedDistribution.last?.range, "120+ km/h")
        XCTAssertEqual(projection.totalSpeedDrives, 6)
        XCTAssertTrue(projection.hasSpeedData)
    }

    func testBoundaryConversionCancels() {
        // Imperial converters scale speed AND bounds, so the bucket assignment is identical; only the
        // unit glyph changes (web parity: both sides pass through toSpeedDisplay).
        let imperial = DriveAnalyticsFixture.data(DriveAnalyticsFixture.speedDrives, units: .imperial)
        let projection = DriveAnalyticsFixture.project(imperial)
        XCTAssertEqual(projection.speedDistribution.map(\.count), [2, 1, 1, 1, 1])
        XCTAssertEqual(projection.speedDistribution.first?.range, "0–30 mph")
    }

    func testNoSpeedYieldsZeroedBuckets() {
        let drives = [DriveAnalyticsFixture.drive(id: 0, speed: nil, power: 5000, distance: 1000)]
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(drives))
        XCTAssertEqual(projection.speedDistribution.count, 5)
        XCTAssertEqual(projection.totalSpeedDrives, 0)
        XCTAssertFalse(projection.hasSpeedData)
    }
}

// MARK: - Adapter: acceleration scatter + average

final class DriveAnalyticsAccelTests: XCTestCase {
    func testAccelPatternsMatchWeb() {
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives))
        XCTAssertEqual(projection.accelPatterns.map(\.id), [0, 1, 3])
        XCTAssertEqual(projection.accelPatterns.map(\.distance), [5, 15, 25])
        XCTAssertEqual(projection.accelPatterns.map(\.powerMax), [10, 20, 30])
        XCTAssertEqual(projection.accelAverage ?? 0, 20, accuracy: 0.0001)
        XCTAssertTrue(projection.hasAccelData)
    }

    func testAccelDistanceUsesJSRound() {
        // 5500 m → 5.5 km → JS Math.round (half toward +∞) → 6; 5499 m → 5.499 → 5.
        let drives = [
            DriveAnalyticsFixture.drive(id: 0, speed: nil, power: 1000, distance: 5500),
            DriveAnalyticsFixture.drive(id: 1, speed: nil, power: 1000, distance: 5499)
        ]
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(drives))
        XCTAssertEqual(projection.accelPatterns.map(\.distance), [6, 5])
    }

    func testEmptyAccelHasNilAverage() {
        let drives = [DriveAnalyticsFixture.drive(id: 0, speed: 10, power: nil, distance: 1000)]
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(drives))
        XCTAssertTrue(projection.accelPatterns.isEmpty)
        XCTAssertNil(projection.accelAverage)
        XCTAssertFalse(projection.hasAccelData)
    }
}

// MARK: - Adapter: power profile

final class DriveAnalyticsPowerTests: XCTestCase {
    func testPowerProfileMatchesWeb() {
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives))
        XCTAssertEqual(projection.powerProfile.map(\.index), [1, 2, 3, 4])
        XCTAssertEqual(projection.powerProfile.map(\.powerMax), [10, 20, 0, 30])
        XCTAssertEqual(projection.powerProfile.map(\.powerMin), [0, 0, 0, 0])
        XCTAssertEqual(projection.powerProfile.first?.label, "Apr 4")
        XCTAssertTrue(projection.hasPowerData)
    }

    func testPowerProfileTakesLastTwenty() {
        let drives = (0 ..< 25).map { index in
            DriveAnalyticsFixture.drive(id: index, speed: nil, power: Double(index * 1000), distance: 1000)
        }
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(drives))
        XCTAssertEqual(projection.powerProfile.count, 20)
        XCTAssertEqual(projection.powerProfile.first?.index, 1)
        XCTAssertEqual(projection.powerProfile.last?.index, 20)
        // suffix(20) of 25 drives starts at drive #5 → 5000 W → 5 kW.
        XCTAssertEqual(projection.powerProfile.first?.powerMax, 5)
    }

    func testBadTimestampUsesInjectedEmDash() {
        let drives = [DriveAnalyticsFixture.drive(id: 0, speed: nil, power: 1000, distance: 1000, iso: "")]
        let copy = DriveAnalyticsSectionCopy(kilowattUnit: "kW", emDash: "∅")
        let projection = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(drives), copy: copy)
        XCTAssertEqual(projection.powerProfile.first?.label, "∅")
    }
}

// MARK: - Adapter: units, formatting, nil

final class DriveAnalyticsAdapterTests: XCTestCase {
    func testProjectionCarriesUnitGlyphs() {
        let metric = DriveAnalyticsFixture.project(DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives))
        XCTAssertEqual(metric.distanceUnit, "km")
        XCTAssertEqual(metric.kilowattUnit, "kW")
        let imperial = DriveAnalyticsFixture.project(
            DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives, units: .imperial)
        )
        XCTAssertEqual(imperial.distanceUnit, "mi")
    }

    func testJSRoundSemantics() {
        XCTAssertEqual(DriveAnalyticsSectionFormat.jsRound(5.5), 6)
        XCTAssertEqual(DriveAnalyticsSectionFormat.jsRound(5.4), 5)
        XCTAssertEqual(DriveAnalyticsSectionFormat.jsRound(2.5), 3)
        XCTAssertEqual(DriveAnalyticsSectionFormat.jsRound(.infinity), 0)
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(DriveAnalyticsSectionFormat.safeNumber(.nan), 0)
        XCTAssertEqual(DriveAnalyticsSectionFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(DriveAnalyticsSectionFormat.safeNumber(12.5), 12.5)
    }

    func testDateShortFallback() {
        XCTAssertEqual(DriveAnalyticsSectionFormat.dateShort("", emDash: "—"), "—")
        XCTAssertEqual(DriveAnalyticsSectionFormat.dateShort("not-a-date", emDash: "—"), "—")
    }

    func testNilDataYieldsEmptyProjection() {
        let projection = DriveAnalyticsFixture.project(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertTrue(projection.speedDistribution.isEmpty)
        XCTAssertTrue(projection.accelPatterns.isEmpty)
        XCTAssertTrue(projection.powerProfile.isEmpty)
        XCTAssertNil(projection.accelAverage)
    }
}

// MARK: - State holder: phase resolution

final class DriveAnalyticsPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(DriveAnalyticsSectionProjector.resolvePhase(.loading, hasDrives: false), .loading)
        XCTAssertEqual(DriveAnalyticsSectionProjector.resolvePhase(.loading, hasDrives: true), .loading)
        XCTAssertEqual(DriveAnalyticsSectionProjector.resolvePhase(.failed("x"), hasDrives: false), .error("x"))
        XCTAssertEqual(DriveAnalyticsSectionProjector.resolvePhase(.failed("x"), hasDrives: true), .error("x"))
        XCTAssertEqual(DriveAnalyticsSectionProjector.resolvePhase(.loaded, hasDrives: false), .empty)
        XCTAssertEqual(DriveAnalyticsSectionProjector.resolvePhase(.loaded, hasDrives: true), .content)
    }
}

// MARK: - State holder: model wiring + telemetry

@MainActor
final class DriveAnalyticsModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveAnalyticsSectionUpdate,
        telemetry: DriveAnalyticsSectionTelemetry = OSLogDriveAnalyticsSectionTelemetry()
    ) -> (DriveAnalyticsSectionModel, InMemoryDriveAnalyticsSectionSource) {
        let source = InMemoryDriveAnalyticsSectionSource(initial: update)
        let model = DriveAnalyticsSectionModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            locale: Locale(identifier: "en_US"),
            timeZone: DriveAnalyticsFixture.utc
        )
        return (model, source)
    }

    private var loadedDrives: DriveAnalyticsSectionUpdate {
        DriveAnalyticsSectionUpdate(
            status: .loaded,
            data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives)
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(DriveAnalyticsSectionUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDrivesShowsContent() {
        let (model, _) = makeModel(loadedDrives)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.powerProfile.count, 4)
    }

    func testLoadedWithNoDrivesShowsEmpty() {
        let (model, _) = makeModel(DriveAnalyticsSectionUpdate(status: .loaded, data: DriveAnalyticsFixture.data([])))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedShowsErrorEvenWithCachedDrives() {
        let (model, _) = makeModel(
            DriveAnalyticsSectionUpdate(
                status: .failed("boom"),
                data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives)
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDriveAnalyticsTelemetry()
        let (model, source) = makeModel(DriveAnalyticsSectionUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveAnalyticsSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(loadedDrives)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testSetRangeUpdatesModelAndSource() {
        let (model, source) = makeModel(loadedDrives)
        model.start()
        let newStart = Date(timeIntervalSince1970: 1_770_000_000)
        let newEnd = Date(timeIntervalSince1970: 1_771_000_000)
        model.setRange(start: newStart, end: newEnd)
        XCTAssertEqual(model.rangeStart, newStart)
        XCTAssertEqual(model.rangeEnd, newEnd)
        XCTAssertEqual(source.lastRange, newStart ... newEnd)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(loadedDrives)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DriveAnalyticsSectionUpdate(
            status: .loaded,
            data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives),
            connection: .stale
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(DriveAnalyticsSectionUpdate(
            status: .loaded,
            data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives),
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(DriveAnalyticsSectionUpdate(
            status: .loaded,
            data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives),
            connection: .live
        ))
        source.push(DriveAnalyticsSectionUpdate(
            status: .loaded,
            data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives),
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(loadedDrives)
        model.start()
        source.push(DriveAnalyticsSectionUpdate(
            status: .loaded,
            data: DriveAnalyticsFixture.data(DriveAnalyticsFixture.powerDrives),
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Accessibility summaries

final class DriveAnalyticsAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    private func projection() -> DriveAnalyticsSectionProjection {
        DriveAnalyticsFixture.project(
            DriveAnalyticsFixture.data(DriveAnalyticsFixture.speedDrives + DriveAnalyticsFixture.powerDrives)
        )
    }

    func testSpeedSummaryWithData() {
        let summary = DriveAnalyticsSectionAccessibility.speedSummary(for: projection(), localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Speed Distribution:"))
        XCTAssertTrue(summary.contains("speed ranges"))
        XCTAssertTrue(summary.contains("Drives"))
    }

    func testAccelAndPowerSummaries() {
        let proj = projection()
        XCTAssertTrue(DriveAnalyticsSectionAccessibility.accelSummary(for: proj, localize: fallback)
            .hasPrefix("Acceleration Patterns:"))
        XCTAssertTrue(DriveAnalyticsSectionAccessibility.powerSummary(for: proj, localize: fallback)
            .hasPrefix("Power Profile:"))
    }

    func testEmptySummaries() {
        let empty = DriveAnalyticsSectionProjection.empty
        XCTAssertTrue(DriveAnalyticsSectionAccessibility.speedSummary(for: empty, localize: fallback)
            .contains("No data"))
        XCTAssertTrue(DriveAnalyticsSectionAccessibility.accelSummary(for: empty, localize: fallback)
            .contains("No data"))
    }

    func testSectionSummaryListsCharts() {
        let summary = DriveAnalyticsSectionAccessibility.sectionSummary(for: projection(), localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Drive Analytics"))
        XCTAssertTrue(summary.contains("Speed Distribution"))
        XCTAssertTrue(summary.contains("Acceleration Patterns"))
        XCTAssertTrue(summary.contains("Power Profile"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDriveAnalyticsTelemetry: DriveAnalyticsSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
