//
//  RecentDrivesSection.Tests.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  Adapter + formatter + accessibility coverage for the RecentDrivesSection surface:
//    • `RecentDrivesUnitMath` — the SI distance conversion (km / mi / ft), the `fmtNumber`
//      grouped rounding, the `durationStr` hour/minute split, and the Battery `start% → end%`
//      / em-dash cell (web `lib/unitConversion.ts` + `numberFormat.ts` + `helpers.ts`).
//    • `RecentDrivesProjection` — phase resolution, the sortable-distance ordering (stable for
//      ties), the page-count / clamp / slice pagination, and the per-row cell projection.
//    • `RecentDrivesAccessibility` — the section summary + row VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer; the date cell uses a fixed
//  injected formatter.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy
/// without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum RecentDrivesSample {
    static func drive(
        id: Int64,
        distance: Double,
        duration: Double = 1080,
        start: Double? = 80,
        end: Double? = 64
    ) -> RecentDriveItem {
        RecentDriveItem(
            id: id,
            startTimestamp: Date(timeIntervalSince1970: 1_717_000_000),
            distanceMeters: distance,
            durationSeconds: duration,
            startBatteryPercent: start,
            endBatteryPercent: end
        )
    }
}

// MARK: - Formatter (web unitConversion + numberFormat + helpers)

final class RecentDrivesUnitMathTests: XCTestCase {
    func testDistanceFromSIPerUnit() {
        XCTAssertEqual(RecentDrivesUnitMath.distanceFromSI(1000, "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(RecentDrivesUnitMath.distanceFromSI(1609.344, "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(RecentDrivesUnitMath.distanceFromSI(0.3048, "ft"), 1, accuracy: 1e-9)
    }

    func testDistanceFromSIUnknownUnitFallsBackToKilometers() {
        XCTAssertEqual(RecentDrivesUnitMath.distanceFromSI(2000, "parsec"), 2, accuracy: 1e-9)
    }

    func testFmtNumberGroupsAndRoundsHalfUp() {
        XCTAssertEqual(RecentDrivesUnitMath.fmtNumber(1234.55, decimals: 1), "1,234.6")
        XCTAssertEqual(RecentDrivesUnitMath.fmtNumber(0.5, decimals: 0), "1")
    }

    func testFmtNumberGuardsNonFinite() {
        XCTAssertEqual(RecentDrivesUnitMath.fmtNumber(.nan, decimals: 2), "0.00")
        XCTAssertEqual(RecentDrivesUnitMath.fmtNumber(.infinity, decimals: 0), "0")
    }

    func testDistanceTextAppendsUnit() {
        XCTAssertEqual(
            RecentDrivesUnitMath.distanceText(meters: 8540, unit: "km", precision: 2),
            "8.54 km"
        )
        // 8540 m / 1609.344 = 5.3065… → 5.31 mi at precision 2.
        XCTAssertEqual(
            RecentDrivesUnitMath.distanceText(meters: 8540, unit: "mi", precision: 2),
            "5.31 mi"
        )
    }

    func testDurationTextSplitsHoursAndMinutes() {
        XCTAssertEqual(RecentDrivesUnitMath.durationText(seconds: 1080), "18m")
        XCTAssertEqual(RecentDrivesUnitMath.durationText(seconds: 7260), "2h 1m")
        XCTAssertEqual(RecentDrivesUnitMath.durationText(seconds: 3600), "1h 0m")
        XCTAssertEqual(RecentDrivesUnitMath.durationText(seconds: 0), "0m")
    }

    func testBatteryTextRendersPairOrEmDash() {
        XCTAssertEqual(RecentDrivesUnitMath.batteryText(start: 80, end: 64, empty: "—"), "80% → 64%")
        XCTAssertEqual(RecentDrivesUnitMath.batteryText(start: nil, end: 64, empty: "—"), "—")
        XCTAssertEqual(RecentDrivesUnitMath.batteryText(start: 80, end: nil, empty: "—"), "—")
    }

    func testPercentTextDropsTrailingZero() {
        XCTAssertEqual(RecentDrivesUnitMath.percentText(80), "80")
        XCTAssertEqual(RecentDrivesUnitMath.percentText(80.5), "80.5")
    }
}

// MARK: - Projection: phase resolution

final class RecentDrivesPhaseTests: XCTestCase {
    func testLoadingResolvesByRowPresence() {
        XCTAssertEqual(RecentDrivesProjection.resolvePhase(status: .loading, rowCount: 0), .loading)
        XCTAssertEqual(RecentDrivesProjection.resolvePhase(status: .loading, rowCount: 3), .content)
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(RecentDrivesProjection.resolvePhase(status: .loaded, rowCount: 0), .empty)
        XCTAssertEqual(RecentDrivesProjection.resolvePhase(status: .loaded, rowCount: 5), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(RecentDrivesProjection.resolvePhase(status: .failed("boom"), rowCount: 0), .error("boom"))
        XCTAssertEqual(RecentDrivesProjection.resolvePhase(status: .failed("boom"), rowCount: 2), .content)
    }
}

// MARK: - Projection: sortable distance

final class RecentDrivesSortTests: XCTestCase {
    private func distances(_ items: [RecentDriveItem]) -> [Double] {
        items.map(\.distanceMeters)
    }

    func testUnsortedPreservesUpstreamOrder() {
        let rows = [
            RecentDrivesSample.drive(id: 1, distance: 3000),
            RecentDrivesSample.drive(id: 2, distance: 1000),
            RecentDrivesSample.drive(id: 3, distance: 2000)
        ]
        XCTAssertEqual(distances(RecentDrivesProjection.sorted(rows, by: .unsorted)), [3000, 1000, 2000])
    }

    func testAscendingAndDescendingOrderByDistance() {
        let rows = [
            RecentDrivesSample.drive(id: 1, distance: 3000),
            RecentDrivesSample.drive(id: 2, distance: 1000),
            RecentDrivesSample.drive(id: 3, distance: 2000)
        ]
        XCTAssertEqual(distances(RecentDrivesProjection.sorted(rows, by: .distanceAscending)), [1000, 2000, 3000])
        XCTAssertEqual(distances(RecentDrivesProjection.sorted(rows, by: .distanceDescending)), [3000, 2000, 1000])
    }

    func testSortIsStableForEqualDistances() {
        let rows = [
            RecentDrivesSample.drive(id: 1, distance: 1000),
            RecentDrivesSample.drive(id: 2, distance: 1000),
            RecentDrivesSample.drive(id: 3, distance: 1000)
        ]
        XCTAssertEqual(RecentDrivesProjection.sorted(rows, by: .distanceAscending).map(\.id), [1, 2, 3])
    }

    func testToggleFollowsWebOnSort() {
        XCTAssertEqual(RecentDrivesSort.unsorted.toggled(), .distanceAscending)
        XCTAssertEqual(RecentDrivesSort.distanceAscending.toggled(), .distanceDescending)
        XCTAssertEqual(RecentDrivesSort.distanceDescending.toggled(), .distanceAscending)
    }
}

// MARK: - Projection: pagination

final class RecentDrivesPaginationTests: XCTestCase {
    private func rows(_ count: Int) -> [RecentDriveItem] {
        (0 ..< count).map { RecentDrivesSample.drive(id: Int64($0), distance: Double($0)) }
    }

    func testPageCountCeilsToWebDefaultPageSize() {
        XCTAssertEqual(RecentDrivesProjection.pageCount(total: 0), 1)
        XCTAssertEqual(RecentDrivesProjection.pageCount(total: 25), 1)
        XCTAssertEqual(RecentDrivesProjection.pageCount(total: 26), 2)
        XCTAssertEqual(RecentDrivesProjection.pageCount(total: 58), 3)
    }

    func testClampPageStaysInRange() {
        XCTAssertEqual(RecentDrivesProjection.clampPage(0, total: 58), 1)
        XCTAssertEqual(RecentDrivesProjection.clampPage(99, total: 58), 3)
        XCTAssertEqual(RecentDrivesProjection.clampPage(2, total: 58), 2)
    }

    func testPageSlicesTheCurrentWindow() {
        let data = rows(58)
        XCTAssertEqual(RecentDrivesProjection.page(data, page: 1).map(\.id).first, 0)
        XCTAssertEqual(RecentDrivesProjection.page(data, page: 1).count, 25)
        XCTAssertEqual(RecentDrivesProjection.page(data, page: 2).map(\.id).first, 25)
        XCTAssertEqual(RecentDrivesProjection.page(data, page: 3).count, 8)
    }
}

// MARK: - Projection: per-row display

final class RecentDrivesDisplayTests: XCTestCase {
    func testDisplayBuildsFourCells() {
        let item = RecentDrivesSample.drive(id: 7, distance: 8540, duration: 7260, start: 82, end: 60)
        let display = RecentDrivesProjection.display(
            for: item,
            formatting: RecentDrivesFormatting(distanceUnit: "km", precision: 1)
        ) { _ in "Apr 4, 2026, 2:30 AM" }
        XCTAssertEqual(display.id, 7)
        XCTAssertEqual(display.date, "Apr 4, 2026, 2:30 AM")
        XCTAssertEqual(display.distance, "8.5 km")
        XCTAssertEqual(display.duration, "2h 1m")
        XCTAssertEqual(display.battery, "82% → 60%")
    }

    func testDisplayCollapsesBatteryWhenMissing() {
        let item = RecentDrivesSample.drive(id: 9, distance: 1000, end: nil)
        let display = RecentDrivesProjection.display(
            for: item,
            formatting: RecentDrivesFormatting()
        ) { _ in "—" }
        XCTAssertEqual(display.battery, "—")
    }
}

// MARK: - Accessibility

final class RecentDrivesAccessibilityTests: XCTestCase {
    func testSectionSummary() {
        let summary = RecentDrivesAccessibility.sectionSummary(count: 3, localize: passthroughLocalize)
        XCTAssertEqual(summary, "Recent Drives: 3")
    }

    func testRowLabelPairsEveryColumnWithItsValue() {
        let display = RecentDriveDisplay(
            id: 1,
            date: "Apr 4, 2026, 2:30 AM",
            distance: "8.5 km",
            duration: "2h 1m",
            battery: "82% → 60%"
        )
        let label = RecentDrivesAccessibility.rowLabel(display, localize: passthroughLocalize)
        XCTAssertTrue(label.contains("Date: Apr 4, 2026, 2:30 AM"))
        XCTAssertTrue(label.contains("Distance: 8.5 km"))
        XCTAssertTrue(label.contains("Duration: 2h 1m"))
        XCTAssertTrue(label.contains("Battery: 82% → 60%"))
    }
}
