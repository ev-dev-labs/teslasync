//
//  LoadingSkeleton.Tests.swift
//  TeslaSync — P4 feature view · LoadingSkeleton (Apple)
//
//  Unit coverage for the shared LoadingSkeleton surface. `LoadingSkeleton` is a
//  pure presentational skeleton (both web sources fetch nothing and render no
//  conditional branches), so the meaningful, host-free surface area is:
//    • each layout projection (static → projection) — every region count and
//      skeleton block dimension reproduced block-for-block from the web source,
//      the analogue of the other P4 surfaces' adapter tests, for BOTH the
//      charging-curve (P4·0088) and cost-analysis (P4·0115) sources;
//    • the responsive-column policy mapped from the web Tailwind breakpoints;
//    • the skeleton block primitives (fixed / fractional / full width, pill);
//    • the `view.opened` telemetry slug (P1/S11);
//    • the P1/S10 i18n facade for the per-layout VoiceOver labels.
//  No rendering / no KMP runtime required — these run in the TeslaSync(/-macOS)
//  XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Charging-curve projection (P4·0088 — web dimensions, 1:1)

@MainActor final class LoadingSkeletonChargingCurveLayoutTests: XCTestCase {
    private let layout = LoadingSkeletonLayout.chargingCurve

    func testRegionCountMatchesWebRoot() {
        // web root `space-y-6` has seven stacked children.
        XCTAssertEqual(layout.regionCount, 7)
        XCTAssertEqual(layout.regions.count, 7)
    }

    func testHeaderBlocksMatchWebDimensions() throws {
        // web: space-y-2 → Skeleton h-8 w-48 + Skeleton h-4 w-72 (no trailing accessory).
        let header = try XCTUnwrap(layout.regions[0].asHeader)
        XCTAssertEqual(header.title, .fixed(192, height: 32))
        XCTAssertEqual(header.subtitle, .fixed(288, height: 16, topInset: 8))
        XCTAssertNil(header.trailingAccessory)
    }

    func testFilterRowHasTwoBlocks() throws {
        // web: flex gap-4 → Skeleton h-10 w-48 + Skeleton h-10 w-64
        let filters = try XCTUnwrap(layout.regions[1].asFilterRow)
        XCTAssertEqual(filters.count, 2)
        XCTAssertEqual(filters[0], .fixed(192, height: 40))
        XCTAssertEqual(filters[1], .fixed(256, height: 40))
    }

    func testSummaryGridHasSixTwoLineStats() throws {
        // web: 6× GlassPanel.p-4 { Skeleton h-3 w-16 ; Skeleton mt-2 h-7 w-20 }
        let grid = try XCTUnwrap(layout.regions[2].asStatGrid)
        XCTAssertEqual(grid.cells.count, 6)
        XCTAssertEqual(grid.gap, .gap4)
        for cell in grid.cells {
            XCTAssertEqual(cell.lines, [.fixed(64, height: 12), .fixed(80, height: 28, topInset: 8)])
        }
    }

    func testPrimaryChartIsTallFullWidthBody() throws {
        // web: GlassPanel.p-6 { Skeleton h-5 w-40 ; Skeleton mt-4 h-64 w-full }
        let panel = try XCTUnwrap(layout.regions[3].asChartPanel)
        XCTAssertEqual(panel.title, .fixed(160, height: 20))
        XCTAssertEqual(panel.chartBody, .fill(height: 256, topInset: 16))
        XCTAssertTrue(panel.chartBody.fillsWidth)
    }

    func testSecondaryChartDimensions() throws {
        // web: GlassPanel.p-6 { Skeleton h-5 w-56 ; Skeleton mt-4 h-52 w-full }
        let panel = try XCTUnwrap(layout.regions[4].asChartPanel)
        XCTAssertEqual(panel.title, .fixed(224, height: 20))
        XCTAssertEqual(panel.chartBody, .fill(height: 208, topInset: 16))
    }

    func testComparisonGridIsTwoEqualPanels() throws {
        // web: grid-cols-1 lg:grid-cols-2 gap-6 → 2× GlassPanel.p-6 { h-5 w-44 ; mt-4 h-48 w-full }
        let grid = try XCTUnwrap(layout.regions[5].asChartGrid)
        XCTAssertEqual(grid.panels.count, 2)
        XCTAssertEqual(grid.gap, .gap6)
        for panel in grid.panels {
            XCTAssertEqual(panel.title, .fixed(176, height: 20))
            XCTAssertEqual(panel.chartBody, .fill(height: 192, topInset: 16))
        }
    }

    func testFooterGridHasFourTwoLineStats() throws {
        // web: grid-cols-2 lg:grid-cols-4 → 4× GlassPanel.p-4 { Skeleton h-3 w-20 ; Skeleton mt-2 h-7 w-16 }
        let grid = try XCTUnwrap(layout.regions[6].asStatGrid)
        XCTAssertEqual(grid.cells.count, 4)
        XCTAssertEqual(grid.gap, .gap4)
        for cell in grid.cells {
            XCTAssertEqual(cell.lines, [.fixed(80, height: 12), .fixed(64, height: 28, topInset: 8)])
        }
    }

    func testColumnsMatchWebBreakpoints() throws {
        let summary = try XCTUnwrap(layout.regions[2].asStatGrid)
        XCTAssertEqual(summary.columns, ResponsiveColumns(compact: 2, regular: 6))
        let comparison = try XCTUnwrap(layout.regions[5].asChartGrid)
        XCTAssertEqual(comparison.columns, ResponsiveColumns(compact: 1, regular: 2))
        let footer = try XCTUnwrap(layout.regions[6].asStatGrid)
        XCTAssertEqual(footer.columns, ResponsiveColumns(compact: 2, regular: 4))
    }

    func testAccessibilityLabelIdentity() {
        XCTAssertEqual(layout.accessibilityLabelKey, "chargingCurve.loading.accessibilityLabel")
        XCTAssertEqual(layout.accessibilityLabelFallback, "Loading charging analysis")
    }
}

// MARK: - Cost-analysis projection (P4·0115 — web dimensions, 1:1)

@MainActor final class LoadingSkeletonCostAnalysisLayoutTests: XCTestCase {
    private let layout = LoadingSkeletonLayout.costAnalysis

    func testRegionCountMatchesWebRoot() {
        // web root `space-y-6 p-6` has four stacked children: header, cards, charts, table.
        XCTAssertEqual(layout.regionCount, 4)
    }

    func testHeaderHasTitleSubtitleAndPillButton() throws {
        // web: flex-col sm:flex-row justify-between
        //   left: Skeleton 220×28 ; Skeleton 340×16 mt-2
        //   right: Skeleton 200×36 rounded (pill)
        let header = try XCTUnwrap(layout.regions[0].asHeader)
        XCTAssertEqual(header.title, .fixed(220, height: 28))
        XCTAssertEqual(header.subtitle, .fixed(340, height: 16, topInset: 8))
        let accessory = try XCTUnwrap(header.trailingAccessory)
        XCTAssertEqual(accessory, .fixed(200, height: 36, shape: .pill))
        XCTAssertEqual(accessory.shape, .pill)
    }

    func testCardGridHasSixThreeLineTiles() throws {
        // web: grid-cols-2 lg:3 xl:6 gap-4 ; 6× GlassPanel.p-4 {
        //   Skeleton h-14? no — height 14 w-60% ; height 24 w-80% mt-2 ; height 12 w-40% mt-1 }
        let grid = try XCTUnwrap(layout.regions[1].asStatGrid)
        XCTAssertEqual(grid.cells.count, 6)
        XCTAssertEqual(grid.gap, .gap4)
        XCTAssertEqual(grid.columns, ResponsiveColumns(compact: 2, regular: 6))
        for cell in grid.cells {
            XCTAssertEqual(cell.lines, [
                .fraction(0.6, height: 14),
                .fraction(0.8, height: 24, topInset: 8),
                .fraction(0.4, height: 12, topInset: 4)
            ])
        }
    }

    func testChartGridIsTwoPercentTitledPanels() throws {
        // web: grid-cols-1 lg:grid-cols-2 gap-4 ; 2× GlassPanel.p-4 {
        //   Skeleton height 16 w-40% ; Skeleton height 200 mt-4 (full) }
        let grid = try XCTUnwrap(layout.regions[2].asChartGrid)
        XCTAssertEqual(grid.panels.count, 2)
        XCTAssertEqual(grid.gap, .gap4)
        XCTAssertEqual(grid.columns, ResponsiveColumns(compact: 1, regular: 2))
        for panel in grid.panels {
            XCTAssertEqual(panel.title, .fraction(0.4, height: 16))
            XCTAssertEqual(panel.chartBody, .fill(height: 200, topInset: 16))
            XCTAssertTrue(panel.chartBody.fillsWidth)
        }
    }

    func testTableHasTitleAndFiveFullWidthRows() throws {
        // web: GlassPanel.p-4 { Skeleton height 16 w-30% ; mt-4 space-y-2 → 5× Skeleton height 32 (full) }
        let table = try XCTUnwrap(layout.regions[3].asTable)
        XCTAssertEqual(table.title, .fraction(0.3, height: 16))
        XCTAssertEqual(table.rowHeight, 32)
        XCTAssertEqual(table.rowCount, 5)
        XCTAssertEqual(table.rowSpacing, 8)
        XCTAssertEqual(table.rowsTopInset, 16)
    }

    func testAccessibilityLabelIdentity() {
        XCTAssertEqual(layout.accessibilityLabelKey, "costAnalysis.loading.accessibilityLabel")
        XCTAssertEqual(layout.accessibilityLabelFallback, "Loading cost analysis")
    }
}

// MARK: - Responsive columns

@MainActor final class LoadingSkeletonResponsiveColumnsTests: XCTestCase {
    func testColumnCountResolvesPerWidthBucket() {
        let columns = ResponsiveColumns(compact: 2, regular: 6)
        XCTAssertEqual(columns.count(isRegularWidth: false), 2)
        XCTAssertEqual(columns.count(isRegularWidth: true), 6)
    }

    func testColumnCountNeverCollapsesBelowOne() {
        let degenerate = ResponsiveColumns(compact: 0, regular: 0)
        XCTAssertEqual(degenerate.count(isRegularWidth: false), 1)
        XCTAssertEqual(degenerate.count(isRegularWidth: true), 1)
    }
}

// MARK: - Skeleton block primitives

@MainActor final class LoadingSkeletonBlockTests: XCTestCase {
    func testFillBlockFillsWidth() {
        XCTAssertTrue(SkeletonBlock.fill(height: 200).fillsWidth)
        XCTAssertEqual(SkeletonBlock.fill(height: 200).width, .fill)
    }

    func testFixedBlockIsNotFullWidth() {
        let block = SkeletonBlock.fixed(64, height: 12)
        XCTAssertFalse(block.fillsWidth)
        XCTAssertEqual(block.width, .points(64))
        XCTAssertEqual(block.shape, .rounded)
    }

    func testFractionBlockCarriesItsFraction() {
        let block = SkeletonBlock.fraction(0.6, height: 14, topInset: 8)
        XCTAssertFalse(block.fillsWidth)
        XCTAssertEqual(block.width, .fraction(0.6))
        XCTAssertEqual(block.topInset, 8)
    }

    func testPillShapeIsPreserved() {
        XCTAssertEqual(SkeletonBlock.fixed(200, height: 36, shape: .pill).shape, .pill)
    }

    func testGridGapsAreDistinct() {
        XCTAssertNotEqual(SkeletonGridGap.gap4, SkeletonGridGap.gap6)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class LoadingSkeletonTelemetryTests: XCTestCase {
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

@MainActor final class LoadingSkeletonLocalizationTests: XCTestCase {
    func testChargingCurveLabelResolvesToFallback() {
        // With no catalog at unit-test time, NSLocalizedString returns the
        // `value` fallback — proving the key + English default are wired.
        let resolved = LoadingSkeletonLSStrings.string(
            LoadingSkeletonStringsKey.chargingCurveAccessibilityLabel,
            LoadingSkeletonStringsKey.chargingCurveAccessibilityLabelFallback
        )
        XCTAssertEqual(resolved, "Loading charging analysis")
    }

    func testCostAnalysisLabelResolvesToFallback() {
        let resolved = LoadingSkeletonLSStrings.string(
            LoadingSkeletonStringsKey.costAnalysisAccessibilityLabel,
            LoadingSkeletonStringsKey.costAnalysisAccessibilityLabelFallback
        )
        XCTAssertEqual(resolved, "Loading cost analysis")
    }

    func testStringsTableIsSurfaceScoped() {
        XCTAssertEqual(LoadingSkeletonLSStrings.table, "LoadingSkeleton")
    }

    func testLabelKeysAreStable() {
        XCTAssertEqual(
            LoadingSkeletonStringsKey.chargingCurveAccessibilityLabel,
            "chargingCurve.loading.accessibilityLabel"
        )
        XCTAssertEqual(
            LoadingSkeletonStringsKey.costAnalysisAccessibilityLabel,
            "costAnalysis.loading.accessibilityLabel"
        )
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
