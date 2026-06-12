//
//  UptimeHeatmap.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  Pure-core coverage for the rolling N-day status grid (the model + view-composition half lives in
//  UptimeHeatmap.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives the props through
//  ``UptimeHeatmapProjector`` and asserts the verbatim port of the web `UptimeHeatmap` render body, plus
//  the value types + the percent formatter it is built on:
//    • slug    — the diagnostics identity.
//    • status  — raw values, all cases, the uptime-eligibility predicate (healthy | maintenance).
//    • day     — defaults, equality, id == date.
//    • inputs  — value equality (the `.onChange` key) across every field.
//    • format  — the `fmtPercent` port (fixed fraction digits, non-finite clamp, decimals).
//    • tier    — the >= 99 / >= 95 / else thresholds.
//    • project — uptime arithmetic, empty vs. populated, square mapping/order, passthroughs.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - UptimeHeatmapSurface (diagnostics identity)

final class UptimeHeatmapSurfaceTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(UptimeHeatmapSurface.slug, "UptimeHeatmap")
    }
}

// MARK: - UptimeStatus (web HeroStatus union)

final class UptimeStatusTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(UptimeStatus.healthy.rawValue, "healthy")
        XCTAssertEqual(UptimeStatus.degraded.rawValue, "degraded")
        XCTAssertEqual(UptimeStatus.unhealthy.rawValue, "unhealthy")
        XCTAssertEqual(UptimeStatus.unknown.rawValue, "unknown")
        XCTAssertEqual(UptimeStatus.maintenance.rawValue, "maintenance")
    }

    func testAllCases() {
        XCTAssertEqual(
            Set(UptimeStatus.allCases),
            [.healthy, .degraded, .unhealthy, .unknown, .maintenance]
        )
    }

    func testCountsTowardUptimeMatchesWebPredicate() {
        XCTAssertTrue(UptimeStatus.healthy.countsTowardUptime)
        XCTAssertTrue(UptimeStatus.maintenance.countsTowardUptime)
        XCTAssertFalse(UptimeStatus.degraded.countsTowardUptime)
        XCTAssertFalse(UptimeStatus.unhealthy.countsTowardUptime)
        XCTAssertFalse(UptimeStatus.unknown.countsTowardUptime)
    }
}

// MARK: - UptimeDay (web `UptimeDay`)

final class UptimeDayTests: XCTestCase {
    func testDefaultsAndIdentity() {
        let day = UptimeDay(date: "2026-06-01", status: .healthy)
        XCTAssertEqual(day.date, "2026-06-01")
        XCTAssertEqual(day.status, .healthy)
        XCTAssertNil(day.summary)
        XCTAssertEqual(day.id, "2026-06-01", "the web keys each square by day.date")
    }

    func testEquality() {
        let base = UptimeDay(date: "2026-06-02", status: .degraded, summary: "lag")
        XCTAssertEqual(base, UptimeDay(date: "2026-06-02", status: .degraded, summary: "lag"))
        XCTAssertNotEqual(base, UptimeDay(date: "2026-06-03", status: .degraded, summary: "lag"))
        XCTAssertNotEqual(base, UptimeDay(date: "2026-06-02", status: .healthy, summary: "lag"))
        XCTAssertNotEqual(base, UptimeDay(date: "2026-06-02", status: .degraded, summary: nil))
    }
}

// MARK: - UptimeHeatmapInputs (the `.onChange` key)

final class UptimeHeatmapInputsTests: XCTestCase {
    private let days = [UptimeDay(date: "2026-06-01", status: .healthy)]

    func testDefaults() {
        let inputs = UptimeHeatmapInputs(days: days)
        XCTAssertEqual(inputs.days, days)
        XCTAssertNil(inputs.title)
        XCTAssertNil(inputs.footnote)
    }

    func testEveryFieldParticipatesInEquality() {
        let base = UptimeHeatmapInputs(days: days, title: "T", footnote: "F")
        XCTAssertEqual(base, UptimeHeatmapInputs(days: days, title: "T", footnote: "F"))
        XCTAssertNotEqual(base, UptimeHeatmapInputs(days: [], title: "T", footnote: "F"))
        XCTAssertNotEqual(base, UptimeHeatmapInputs(days: days, title: "X", footnote: "F"))
        XCTAssertNotEqual(base, UptimeHeatmapInputs(days: days, title: "T", footnote: "X"))
    }
}

// MARK: - UptimeHeatmapFormat (web `fmtPercent`)

final class UptimeHeatmapFormatTests: XCTestCase {
    func testFixedTwoFractionDigitsWithPercentSuffix() {
        XCTAssertEqual(UptimeHeatmapFormat.percent(100), "100.00%")
        XCTAssertEqual(UptimeHeatmapFormat.percent(99.5), "99.50%")
        XCTAssertEqual(UptimeHeatmapFormat.percent(95), "95.00%")
        XCTAssertEqual(UptimeHeatmapFormat.percent(0), "0.00%")
    }

    func testRoundsLikeWeb() {
        XCTAssertEqual(UptimeHeatmapFormat.percent(2.0 / 3.0 * 100), "66.67%")
    }

    func testNonFiniteClampsToZero() {
        XCTAssertEqual(UptimeHeatmapFormat.percent(.infinity), "0.00%")
        XCTAssertEqual(UptimeHeatmapFormat.percent(-.infinity), "0.00%")
        XCTAssertEqual(UptimeHeatmapFormat.percent(.nan), "0.00%")
    }

    func testDecimalsParameter() {
        XCTAssertEqual(UptimeHeatmapFormat.percent(95, decimals: 0), "95%")
        XCTAssertEqual(UptimeHeatmapFormat.percent(99.5, decimals: 1), "99.5%")
    }
}

// MARK: - UptimeTier (web caption thresholds)

final class UptimeTierTests: XCTestCase {
    func testThresholdsMatchWebTernary() {
        XCTAssertEqual(UptimeTier(percent: 100), .high)
        XCTAssertEqual(UptimeTier(percent: 99), .high)
        XCTAssertEqual(UptimeTier(percent: 98.9999), .medium)
        XCTAssertEqual(UptimeTier(percent: 95), .medium)
        XCTAssertEqual(UptimeTier(percent: 94.9999), .low)
        XCTAssertEqual(UptimeTier(percent: 0), .low)
    }
}

// MARK: - UptimeHeatmapProjector (web `UptimeHeatmap` render body)

final class UptimeHeatmapProjectorTests: XCTestCase {
    func testEmptyWindowHasNoUptimeOrSquares() {
        let projection = UptimeHeatmapProjector.resolve(
            inputs: UptimeHeatmapInputs(days: [], title: "T", footnote: "F")
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.dayCount, 0)
        XCTAssertNil(projection.uptimePercent, "web returns null uptime for an empty window")
        XCTAssertNil(projection.uptimePercentText)
        XCTAssertNil(projection.tier)
        XCTAssertTrue(projection.squares.isEmpty)
        XCTAssertEqual(projection.titleOverride, "T")
        XCTAssertEqual(projection.footnote, "F")
    }

    func testAllUpWindowIsHundredPercentHighTier() {
        let days = (0 ..< 4).map { UptimeDay(date: "d\($0)", status: $0 == 1 ? .maintenance : .healthy) }
        let projection = UptimeHeatmapProjector.resolve(inputs: UptimeHeatmapInputs(days: days))
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.dayCount, 4)
        XCTAssertEqual(projection.uptimePercent, 100)
        XCTAssertEqual(projection.uptimePercentText, "100.00%")
        XCTAssertEqual(projection.tier, .high)
        XCTAssertNil(projection.titleOverride)
        XCTAssertNil(projection.footnote)
    }

    func testUptimeArithmeticCountsHealthyAndMaintenance() {
        // 2 up (healthy + maintenance) of 5 → 40% → low tier.
        let days = [
            UptimeDay(date: "d0", status: .healthy),
            UptimeDay(date: "d1", status: .maintenance),
            UptimeDay(date: "d2", status: .unhealthy),
            UptimeDay(date: "d3", status: .degraded),
            UptimeDay(date: "d4", status: .unknown)
        ]
        let projection = UptimeHeatmapProjector.resolve(inputs: UptimeHeatmapInputs(days: days))
        XCTAssertEqual(projection.uptimePercent, 40)
        XCTAssertEqual(projection.uptimePercentText, "40.00%")
        XCTAssertEqual(projection.tier, .low)
    }

    func testSquaresPreserveOrderIndexAndPayload() {
        let days = [
            UptimeDay(date: "2026-06-01", status: .healthy, summary: "ok"),
            UptimeDay(date: "2026-06-02", status: .unhealthy)
        ]
        let projection = UptimeHeatmapProjector.resolve(inputs: UptimeHeatmapInputs(days: days))
        XCTAssertEqual(projection.squares.count, 2)
        XCTAssertEqual(projection.squares[0].id, 0)
        XCTAssertEqual(projection.squares[0].date, "2026-06-01")
        XCTAssertEqual(projection.squares[0].status, .healthy)
        XCTAssertEqual(projection.squares[0].summary, "ok")
        XCTAssertEqual(projection.squares[1].id, 1)
        XCTAssertEqual(projection.squares[1].status, .unhealthy)
        XCTAssertNil(projection.squares[1].summary)
    }

    func testUptimePercentHelperOnMixedWindow() {
        let days = [
            UptimeDay(date: "d0", status: .healthy),
            UptimeDay(date: "d1", status: .maintenance),
            UptimeDay(date: "d2", status: .unhealthy)
        ]
        XCTAssertEqual(UptimeHeatmapProjector.uptimePercent(for: days), 2.0 / 3.0 * 100, accuracy: 0.0001)
    }

    func testProjectionIsEquatableForIdenticalInputs() {
        let inputs = UptimeHeatmapInputs(
            days: [UptimeDay(date: "d0", status: .degraded, summary: "s")],
            title: "T",
            footnote: "F"
        )
        XCTAssertEqual(
            UptimeHeatmapProjector.resolve(inputs: inputs),
            UptimeHeatmapProjector.resolve(inputs: inputs)
        )
    }
}
