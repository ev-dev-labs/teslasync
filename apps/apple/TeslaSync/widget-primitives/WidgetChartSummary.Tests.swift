//
//  WidgetChartSummary.Tests.swift
//  TeslaSync — P4 widget primitive · 0002 · WidgetChartSummary (Apple)
//
//  Unit coverage for the WidgetChartSummary primitive:
//    • Model — `ChartSummaryStat` identity + the string / numeric (`string | number`) inits.
//    • Layout — the pure render-branch decisions (`usesRow` breakpoint + compact override,
//      `showsChart`, `showsStats`) that mirror the web component's conditionals.
//    • Accessibility — the VoiceOver stat-cell label (with and without a unit).
//    • i18n facade — the empty-state fallback resolves to the web English string.
//    • Telemetry — the P1/S11 `view.opened` seam records the stable surface slug.
//    • Per-state render — the view renders (ImageRenderer) in every branch: content / wide / compact
//      / chart-only / empty.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model: ChartSummaryStat

final class WidgetChartSummaryStatTests: XCTestCase {
    func testIdentityIsLabel() {
        let stat = ChartSummaryStat(label: "Distance", value: "12,450", unit: "km")
        XCTAssertEqual(stat.id, "Distance")
        XCTAssertEqual(stat.value, "12,450")
        XCTAssertEqual(stat.unit, "km")
    }

    func testStringInitDefaultsUnitToNil() {
        let stat = ChartSummaryStat(label: "Cost", value: "$482.17")
        XCTAssertNil(stat.unit)
    }

    /// Integers < 1000 format identically across locales (no grouping, no decimals) — keeps the
    /// assertion deterministic on any test host while still exercising the numeric `string | number`
    /// convenience init.
    func testIntegerConvenienceInit() {
        let stat = ChartSummaryStat(label: "Trips", value: 250, unit: "x")
        XCTAssertEqual(stat.value, "250")
        XCTAssertEqual(stat.unit, "x")
    }

    func testDoubleConvenienceInitZeroFractionDigits() {
        let stat = ChartSummaryStat(label: "Whole", value: 9, fractionDigits: 0)
        XCTAssertEqual(stat.value, "9")
    }

    func testEquatable() {
        let first = ChartSummaryStat(label: "A", value: "1", unit: "u")
        let second = ChartSummaryStat(label: "A", value: "1", unit: "u")
        let third = ChartSummaryStat(label: "A", value: "2", unit: "u")
        XCTAssertEqual(first, second)
        XCTAssertNotEqual(first, third)
    }
}

// MARK: - Layout decisions (web render branches)

final class WidgetChartSummaryLayoutTests: XCTestCase {
    func testUsesRowOnlyPastBreakpointWhenNotCompact() {
        XCTAssertFalse(WidgetChartSummaryLayout.usesRow(availableWidth: 0, compact: false))
        XCTAssertFalse(
            WidgetChartSummaryLayout.usesRow(
                availableWidth: WidgetChartSummaryLayout.rowBreakpoint - 1,
                compact: false
            )
        )
        XCTAssertTrue(
            WidgetChartSummaryLayout.usesRow(
                availableWidth: WidgetChartSummaryLayout.rowBreakpoint,
                compact: false
            )
        )
        XCTAssertTrue(WidgetChartSummaryLayout.usesRow(availableWidth: 600, compact: false))
    }

    func testCompactAlwaysForcesGrid() {
        XCTAssertFalse(WidgetChartSummaryLayout.usesRow(availableWidth: 0, compact: true))
        XCTAssertFalse(WidgetChartSummaryLayout.usesRow(availableWidth: 1000, compact: true))
    }

    func testShowsChartOnlyOutsideCompact() {
        XCTAssertTrue(WidgetChartSummaryLayout.showsChart(compact: false))
        XCTAssertFalse(WidgetChartSummaryLayout.showsChart(compact: true))
    }

    func testShowsStatsOnlyWhenNonEmpty() {
        XCTAssertFalse(WidgetChartSummaryLayout.showsStats([]))
        XCTAssertTrue(
            WidgetChartSummaryLayout.showsStats([ChartSummaryStat(label: "A", value: "1")])
        )
    }
}

// MARK: - Accessibility

final class WidgetChartSummaryAccessibilityTests: XCTestCase {
    func testStatLabelWithUnit() {
        let stat = ChartSummaryStat(label: "Distance", value: "12,450", unit: "km")
        XCTAssertEqual(WidgetChartSummaryAccessibility.statLabel(for: stat), "Distance: 12,450 km")
    }

    func testStatLabelWithoutUnit() {
        let stat = ChartSummaryStat(label: "Cost", value: "$482.17")
        XCTAssertEqual(WidgetChartSummaryAccessibility.statLabel(for: stat), "Cost: $482.17")
    }

    func testStatLabelTreatsEmptyUnitAsAbsent() {
        let stat = ChartSummaryStat(label: "Count", value: "5", unit: "")
        XCTAssertEqual(WidgetChartSummaryAccessibility.statLabel(for: stat), "Count: 5")
    }
}

// MARK: - i18n facade

final class WidgetChartSummaryStringsTests: XCTestCase {
    func testTableName() {
        XCTAssertEqual(WidgetChartSummaryStrings.table, "WidgetChartSummary")
    }

    /// The per-surface table is not loaded into the unit-test host's main bundle, so the facade
    /// returns the supplied web English fallback — proving the view never shows a raw key.
    func testFallbackResolves() {
        let resolved = WidgetChartSummaryStrings.string("widget.chartSummary.noData", "No data available")
        XCTAssertEqual(resolved, "No data available")
    }
}

// MARK: - Telemetry seam (P1/S11 view.opened)

private final class SpyWidgetChartSummaryTelemetry: WidgetChartSummaryTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []
    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

final class WidgetChartSummaryTelemetryTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetChartSummary<Color>.surfaceSlug, "WidgetChartSummary")
    }

    func testSeamRecordsSurfaceSlug() {
        let spy = SpyWidgetChartSummaryTelemetry()
        spy.viewOpened(surface: WidgetChartSummary<Color>.surfaceSlug)
        XCTAssertEqual(spy.openedSurfaces, ["WidgetChartSummary"])
    }
}

// MARK: - Per-state render smoke (snapshot of each branch)

@MainActor
final class WidgetChartSummaryRenderTests: XCTestCase {
    private let stats: [ChartSummaryStat] = [
        ChartSummaryStat(label: "Distance", value: "12,450", unit: "km"),
        ChartSummaryStat(label: "Efficiency", value: "152", unit: "Wh/km"),
        ChartSummaryStat(label: "Energy", value: "1,897", unit: "kWh"),
        ChartSummaryStat(label: "Cost", value: "$482.17")
    ]

    private func assertRenders(_ view: some View, _ message: String, width: CGFloat, height: CGFloat) {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage, message)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage, message)
        #endif
    }

    func testRendersContentGrid() {
        assertRenders(
            WidgetChartSummary(stats: stats) { Color.clear },
            "content (grid) should render",
            width: 320,
            height: 220
        )
    }

    func testRendersContentWideRow() {
        assertRenders(
            WidgetChartSummary(stats: stats) { Color.clear },
            "content (wide row) should render",
            width: 560,
            height: 240
        )
    }

    func testRendersCompactStatsOnly() {
        assertRenders(
            WidgetChartSummary(stats: stats, compact: true) { Color.clear },
            "compact stats-only should render",
            width: 180,
            height: 120
        )
    }

    func testRendersChartOnlyNoStats() {
        assertRenders(
            WidgetChartSummary(stats: []) { Color.clear },
            "chart-only (no stats) should render",
            width: 320,
            height: 200
        )
    }

    func testRendersEmptyState() {
        assertRenders(
            WidgetChartSummary(stats: [], isEmpty: true, emptyMessage: "No data available") { Color.clear },
            "empty state should render",
            width: 320,
            height: 220
        )
    }
}
