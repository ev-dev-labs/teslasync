//
//  PageSkeleton.Tests.swift
//  TeslaSync — P4 shared surface · 0132 · PageSkeleton (Apple)
//
//  Coverage for the page-skeleton surface:
//    • Projection — the layout defaults that encode the web prop defaults (4 cards, 8 rows, 4 cols,
//      320pt chart), the responsive 2-vs-4 column choice (web grid-cols-2 / md:grid-cols-4), and the
//      non-negative count clamp (the parity of the web Array.from({ length }) guard).
//    • Region — the localization keys, the verbatim web aria-label fallbacks, and the data-testid
//      parity identifiers, for every region.
//    • Model — the once-only `view.opened` telemetry (idempotent across repeated onAppear) and the
//      accessibility-label resolution through the injected i18n facade.
//    • Views — every public block (both initializers) and the presentational leaves compose
//      (signature contract), the parity of the web "renders without crashing" assertions.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no bundle dependency: the
//  string facade is stubbed so the label assertions are deterministic regardless of the active locale.
//

import SwiftUI
import XCTest

private let englishStrings: PageSkeletonResolve = { _, fallback in fallback }
private let echoStrings: PageSkeletonResolve = { key, fallback in "\(key)::\(fallback)" }

// MARK: - Projection / layout

final class PageSkeletonProjectionTests: XCTestCase {
    func testPropDefaultsMatchWebSource() {
        XCTAssertEqual(PageSkeletonLayout.defaultStatCards, 4)
        XCTAssertEqual(PageSkeletonLayout.defaultTableRows, 8)
        XCTAssertEqual(PageSkeletonLayout.defaultTableCols, 4)
        XCTAssertEqual(PageSkeletonLayout.defaultChartHeight, 320)
    }

    func testStatColumnsAreResponsive() {
        XCTAssertEqual(PageSkeletonLayout.statColumns(isRegularWidth: false), 2)
        XCTAssertEqual(PageSkeletonLayout.statColumns(isRegularWidth: true), 4)
    }

    func testClampedCountGuardsNegatives() {
        XCTAssertEqual(PageSkeletonLayout.clampedCount(-3), 0)
        XCTAssertEqual(PageSkeletonLayout.clampedCount(0), 0)
        XCTAssertEqual(PageSkeletonLayout.clampedCount(6), 6)
    }

    func testCardCornerRadiiUseTokens() {
        XCTAssertEqual(PageSkeletonLayout.statCardRadius, TSRadius.md)
        XCTAssertEqual(PageSkeletonLayout.chartRadius, TSRadius.md)
        XCTAssertEqual(PageSkeletonLayout.tableHeaderRadius, TSRadius.md)
        XCTAssertEqual(PageSkeletonLayout.tableCellRadius, TSRadius.sm)
    }
}

// MARK: - Region (accessibility labels + identifiers)

final class PageSkeletonRegionTests: XCTestCase {
    func testAllRegionsCovered() {
        XCTAssertEqual(PageSkeletonRegion.allCases.count, 4)
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(PageSkeletonRegion.pageHeader.labelKey, "skeleton.pageHeader.label")
        XCTAssertEqual(PageSkeletonRegion.pageHeader.labelFallback, "Loading page header")
        XCTAssertEqual(PageSkeletonRegion.statGrid.labelFallback, "Loading stat cards")
        XCTAssertEqual(PageSkeletonRegion.chart.labelFallback, "Loading chart")
        XCTAssertEqual(PageSkeletonRegion.table.labelFallback, "Loading table")
    }

    func testTestIdentifiersMatchWeb() {
        XCTAssertEqual(PageSkeletonRegion.pageHeader.accessibilityIdentifier, "page-header-skeleton")
        XCTAssertEqual(PageSkeletonRegion.statGrid.accessibilityIdentifier, "stat-grid-skeleton")
        XCTAssertEqual(PageSkeletonRegion.chart.accessibilityIdentifier, "chart-block-skeleton")
        XCTAssertEqual(PageSkeletonRegion.table.accessibilityIdentifier, "table-skeleton")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class PageSkeletonModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnce() {
        let spy = SpyPageSkeletonTelemetry()
        let model = PageSkeletonModel(telemetry: spy, strings: englishStrings)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PageSkeletonMeta.surfaceSlug])
    }

    func testLabelResolvesFallbackThroughFacade() {
        let model = PageSkeletonModel(telemetry: SpyPageSkeletonTelemetry(), strings: englishStrings)
        XCTAssertEqual(model.label(for: .pageHeader), "Loading page header")
        XCTAssertEqual(model.label(for: .table), "Loading table")
    }

    func testLabelPassesKeyAndFallbackToFacade() {
        let model = PageSkeletonModel(telemetry: SpyPageSkeletonTelemetry(), strings: echoStrings)
        XCTAssertEqual(model.label(for: .statGrid), "skeleton.statGrid.label::Loading stat cards")
        XCTAssertEqual(model.label(for: .chart), "skeleton.chart.label::Loading chart")
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class PageSkeletonViewTests: XCTestCase {
    private func model() -> PageSkeletonModel {
        PageSkeletonModel(telemetry: SpyPageSkeletonTelemetry(), strings: englishStrings)
    }

    func testPublicBlocksCompose() {
        _ = PageHeaderSkeleton()
        _ = PageHeaderSkeleton(model: model())
        _ = StatGridSkeleton()
        _ = StatGridSkeleton(cards: 6)
        _ = StatGridSkeleton(cards: 6, model: model())
        _ = ChartBlockSkeleton()
        _ = ChartBlockSkeleton(height: 200)
        _ = ChartBlockSkeleton(height: 200, model: model())
        _ = TableSkeleton()
        _ = TableSkeleton(rows: 3, cols: 5)
        _ = TableSkeleton(rows: 3, cols: 5, model: model())
    }

    func testLeavesCompose() {
        _ = PageSkeletonStatCard()
        _ = PageSkeletonTableRow(columns: 4)
        _ = PageSkeletonTableRow(columns: 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyPageSkeletonTelemetry: PageSkeletonTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

@testable import TeslaSync
