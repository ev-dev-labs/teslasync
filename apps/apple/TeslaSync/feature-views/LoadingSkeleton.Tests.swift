//
//  LoadingSkeleton.Tests.swift
//  TeslaSync — P4 feature view · 0088 · LoadingSkeleton (Apple)
//
//  Unit coverage for the LoadingSkeleton surface. `LoadingSkeleton` is a pure
//  presentational skeleton (the web source fetches nothing and renders no
//  conditional branches), so the meaningful, host-free surface area is:
//    • the layout projection (cached/static → projection) — every region count
//      and skeleton block dimension reproduced block-for-block from the web
//      source, the analogue of the other P4 surfaces' adapter tests;
//    • the responsive-column policy mapped from the web Tailwind breakpoints;
//    • the `view.opened` telemetry slug (P1/S11);
//    • the P1/S10 i18n facade for the one VoiceOver label.
//  No rendering / no KMP runtime required — these run in the TeslaSync(/-macOS)
//  XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Layout projection (adapter "snapshot" — web dimensions, 1:1)

final class LoadingSkeletonLayoutTests: XCTestCase {
    private let layout = LoadingSkeletonLayout.chargingCurve

    func testRegionCountMatchesWebRoot() {
        // web root `space-y-6` has seven stacked children.
        XCTAssertEqual(layout.regionCount, 7)
    }

    func testHeaderBlocksMatchWebDimensions() {
        // web: Skeleton h-8 w-48  +  Skeleton h-4 w-72
        XCTAssertEqual(layout.headerTitle, SkeletonBlock(width: 192, height: 32))
        XCTAssertEqual(layout.headerSubtitle, SkeletonBlock(width: 288, height: 16))
    }

    func testFilterRowHasTwoBlocks() {
        // web: flex gap-4 → Skeleton h-10 w-48  +  Skeleton h-10 w-64
        XCTAssertEqual(layout.filters.count, 2)
        XCTAssertEqual(layout.filters[0], SkeletonBlock(width: 192, height: 40))
        XCTAssertEqual(layout.filters[1], SkeletonBlock(width: 256, height: 40))
    }

    func testSummaryGridHasSixStatsWithWebDimensions() {
        // web: 6× GlassPanel.p-4 { Skeleton h-3 w-16 ; Skeleton mt-2 h-7 w-20 }
        XCTAssertEqual(layout.summaryStats.count, 6)
        for cell in layout.summaryStats {
            XCTAssertEqual(cell.label, SkeletonBlock(width: 64, height: 12))
            XCTAssertEqual(cell.value, SkeletonBlock(width: 80, height: 28, topInset: 8))
        }
    }

    func testPrimaryChartIsTallFullWidthBody() {
        // web: GlassPanel.p-6 { Skeleton h-5 w-40 ; Skeleton mt-4 h-64 w-full }
        XCTAssertEqual(layout.primaryChart.title, SkeletonBlock(width: 160, height: 20))
        XCTAssertEqual(layout.primaryChart.chartBody, SkeletonBlock(width: nil, height: 256, topInset: 16))
        XCTAssertTrue(layout.primaryChart.chartBody.fillsWidth)
    }

    func testSecondaryChartDimensions() {
        // web: GlassPanel.p-6 { Skeleton h-5 w-56 ; Skeleton mt-4 h-52 w-full }
        XCTAssertEqual(layout.secondaryChart.title, SkeletonBlock(width: 224, height: 20))
        XCTAssertEqual(layout.secondaryChart.chartBody, SkeletonBlock(width: nil, height: 208, topInset: 16))
    }

    func testComparisonChartsAreTwoEqualPanels() {
        // web: grid-cols-1 lg:grid-cols-2 → 2× GlassPanel.p-6 { h-5 w-44 ; mt-4 h-48 w-full }
        XCTAssertEqual(layout.comparisonCharts.count, 2)
        for panel in layout.comparisonCharts {
            XCTAssertEqual(panel.title, SkeletonBlock(width: 176, height: 20))
            XCTAssertEqual(panel.chartBody, SkeletonBlock(width: nil, height: 192, topInset: 16))
        }
    }

    func testFooterGridHasFourStatsWithWebDimensions() {
        // web: 4× GlassPanel.p-4 { Skeleton h-3 w-20 ; Skeleton mt-2 h-7 w-16 }
        XCTAssertEqual(layout.footerStats.count, 4)
        for cell in layout.footerStats {
            XCTAssertEqual(cell.label, SkeletonBlock(width: 80, height: 12))
            XCTAssertEqual(cell.value, SkeletonBlock(width: 64, height: 28, topInset: 8))
        }
    }

    func testFullWidthBodiesReproduceWFull() {
        XCTAssertNil(layout.primaryChart.chartBody.width)
        XCTAssertNil(layout.secondaryChart.chartBody.width)
        XCTAssertTrue(layout.comparisonCharts.allSatisfy(\.chartBody.fillsWidth))
    }

    func testFixedWidthBlocksAreNotFullWidth() {
        XCTAssertFalse(layout.summaryStats[0].label.fillsWidth)
        XCTAssertFalse(layout.footerStats[0].value.fillsWidth)
        XCTAssertFalse(layout.headerTitle.fillsWidth)
    }

    func testTopInsetsReproduceWebMargins() {
        // web mt-2 = 8 on stat values, mt-4 = 16 on chart bodies, none elsewhere.
        XCTAssertEqual(layout.summaryStats[0].value.topInset, 8)
        XCTAssertEqual(layout.footerStats[0].value.topInset, 8)
        XCTAssertEqual(layout.primaryChart.chartBody.topInset, 16)
        XCTAssertEqual(layout.headerTitle.topInset, 0)
        XCTAssertEqual(layout.summaryStats[0].label.topInset, 0)
    }
}

// MARK: - Responsive columns (web base / lg / xl → width bucket)

final class LoadingSkeletonResponsiveColumnsTests: XCTestCase {
    private let layout = LoadingSkeletonLayout.chargingCurve

    func testSummaryColumnsMatchWebBreakpoints() {
        // web: grid-cols-2  …  xl:grid-cols-6
        XCTAssertEqual(layout.summaryColumns, ResponsiveColumns(compact: 2, regular: 6))
        XCTAssertEqual(layout.summaryColumns.count(isRegularWidth: false), 2)
        XCTAssertEqual(layout.summaryColumns.count(isRegularWidth: true), 6)
    }

    func testFooterColumnsMatchWebBreakpoints() {
        // web: grid-cols-2  …  lg:grid-cols-4
        XCTAssertEqual(layout.footerColumns, ResponsiveColumns(compact: 2, regular: 4))
        XCTAssertEqual(layout.footerColumns.count(isRegularWidth: false), 2)
        XCTAssertEqual(layout.footerColumns.count(isRegularWidth: true), 4)
    }

    func testComparisonColumnsMatchWebBreakpoints() {
        // web: grid-cols-1  …  lg:grid-cols-2
        XCTAssertEqual(layout.comparisonColumns, ResponsiveColumns(compact: 1, regular: 2))
        XCTAssertEqual(layout.comparisonColumns.count(isRegularWidth: false), 1)
        XCTAssertEqual(layout.comparisonColumns.count(isRegularWidth: true), 2)
    }

    func testColumnCountNeverCollapsesBelowOne() {
        let degenerate = ResponsiveColumns(compact: 0, regular: 0)
        XCTAssertEqual(degenerate.count(isRegularWidth: false), 1)
        XCTAssertEqual(degenerate.count(isRegularWidth: true), 1)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

final class LoadingSkeletonTelemetryTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyLoadingSkeletonTelemetry()
        LoadingSkeletonSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["LoadingSkeleton"])
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LoadingSkeletonSurface.slug, "LoadingSkeleton")
    }

    func testReportOpenIsRepeatableContract() {
        let spy = SpyLoadingSkeletonTelemetry()
        LoadingSkeletonSurface.reportOpen(to: spy)
        LoadingSkeletonSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["LoadingSkeleton", "LoadingSkeleton"])
    }
}

// MARK: - Localization facade (P1/S10)

final class LoadingSkeletonLocalizationTests: XCTestCase {
    func testAccessibilityLabelResolvesToFallback() {
        // With no catalog at unit-test time, NSLocalizedString returns the
        // `value` fallback — proving the key + English default are wired.
        let resolved = LSStrings.string(
            LoadingSkeletonStringsKey.accessibilityLabel,
            LoadingSkeletonStringsKey.accessibilityLabelFallback
        )
        XCTAssertEqual(resolved, "Loading charging analysis")
        XCTAssertFalse(resolved.isEmpty)
    }

    func testStringsTableIsSurfaceScoped() {
        XCTAssertEqual(LSStrings.table, "LoadingSkeleton")
    }

    func testAccessibilityLabelKeyIsStable() {
        XCTAssertEqual(LoadingSkeletonStringsKey.accessibilityLabel, "chargingCurve.loading.accessibilityLabel")
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyLoadingSkeletonTelemetry: LoadingSkeletonTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
