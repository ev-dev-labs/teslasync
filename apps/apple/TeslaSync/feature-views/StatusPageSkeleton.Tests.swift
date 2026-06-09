//
//  StatusPageSkeleton.Tests.swift
//  TeslaSync — P4 feature view · StatusPageSkeleton (Apple)
//
//  Unit coverage for the StatusPageSkeleton surface. `StatusPageSkeleton` is a
//  pure presentational skeleton (the web source fetches nothing and renders no
//  conditional branch), so the meaningful, host-free surface area is:
//    • the layout projection (static → projection) — every root child, region
//      kind, dimension, width-shape, corner, inset, and count reproduced
//      block-for-block from the web source;
//    • the skeleton block primitives (fixed / fractional / full width, pill);
//    • the `view.opened` telemetry slug (P1/S11);
//    • the P1/S10 i18n facade for the VoiceOver busy-state label.
//  No rendering / no KMP runtime required — these run in the
//  TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Layout projection (web dimensions, 1:1)

@MainActor final class StatusPageSkeletonLayoutTests: XCTestCase {
    private let layout = StatusPageSkeletonLayout.standard

    func testRootChildCountMatchesWebSource() {
        // web root `space-y-5` has nine stacked children: hero, chip bar, health
        // rows, action-items rows, resources rows, then four accordion rows.
        XCTAssertEqual(layout.regionCount, 9)
        XCTAssertEqual(layout.regions.count, 9)
    }

    func testHeroBlocksMatchWebDimensions() throws {
        // web: GlassPanel.p-5 flex items-start gap-4 →
        //   Skeleton 56×56 rounded ; flex-1 { h-6 w-60% ; h-3.5 w-40% mt-2 } ; 120×36
        let hero = try XCTUnwrap(layout.regions[0].asHero)
        XCTAssertEqual(hero.avatar, .fixed(56, height: 56, shape: .pill))
        XCTAssertEqual(hero.avatar.shape, .pill)
        XCTAssertEqual(hero.title, .fraction(0.6, height: 24))
        XCTAssertEqual(hero.subtitle, .fraction(0.4, height: 14, topInset: 8))
        XCTAssertEqual(hero.action, .fixed(120, height: 36))
    }

    func testChipBarHasEightPills() throws {
        // web: flex gap-2 overflow-hidden → 8× Skeleton 92×32 rounded-full
        let chipBar = try XCTUnwrap(layout.regions[1].asChipBar)
        XCTAssertEqual(chipBar.count, 8)
        XCTAssertEqual(chipBar.chips.count, 8)
        for chip in chipBar.chips {
            XCTAssertEqual(chip, .fixed(92, height: 32, shape: .pill))
            XCTAssertEqual(chip.shape, .pill)
        }
    }

    func testHealthRowGroupMatchesWebSource() throws {
        // web: GlassPanel.p-3 space-y-1 → Skeleton h-[18] w-20 mb-2 ; 6× SkeletonRow h-11
        let group = try XCTUnwrap(layout.regions[2].asRowGroup)
        XCTAssertEqual(group.heading, .fixed(80, height: 18))
        XCTAssertEqual(group.rowHeight, 44)
        XCTAssertEqual(group.rowCount, 6)
        XCTAssertEqual(group.rowSpacing, 4)
        XCTAssertEqual(group.rowsTopInset, 8)
    }

    func testActionItemsRowGroupMatchesWebSource() throws {
        // web: GlassPanel.p-4 space-y-2 → Skeleton h-[18] w-44 ; 2× SkeletonRow h-8
        let group = try XCTUnwrap(layout.regions[3].asRowGroup)
        XCTAssertEqual(group.heading, .fixed(180, height: 18))
        XCTAssertEqual(group.rowHeight, 32)
        XCTAssertEqual(group.rowCount, 2)
        XCTAssertEqual(group.rowSpacing, 8)
        XCTAssertEqual(group.rowsTopInset, 8)
    }

    func testResourcesRowGroupMatchesWebSource() throws {
        // web: GlassPanel.p-4 space-y-3 → Skeleton h-[18] w-30 ; 5× SkeletonRow h-7
        let group = try XCTUnwrap(layout.regions[4].asRowGroup)
        XCTAssertEqual(group.heading, .fixed(120, height: 18))
        XCTAssertEqual(group.rowHeight, 28)
        XCTAssertEqual(group.rowCount, 5)
        XCTAssertEqual(group.rowSpacing, 12)
        XCTAssertEqual(group.rowsTopInset, 12)
    }

    func testFourAccordionRowsMatchWebMap() throws {
        // web: Array.from({ length: 4 }).map → 4× GlassPanel.p-5 flex items-center gap-3 {
        //   Skeleton 20×20 ; flex-1 { h-4 w-40% ; h-3 w-60% mt-1 } ; 60×24 }
        let expected = StatusSkeletonAccordionRow(
            icon: .fixed(20, height: 20),
            title: .fraction(0.4, height: 16),
            subtitle: .fraction(0.6, height: 12, topInset: 4),
            trailing: .fixed(60, height: 24)
        )
        let accordionRegions = layout.regions[5 ..< 9]
        XCTAssertEqual(accordionRegions.count, 4)
        for region in accordionRegions {
            let row = try XCTUnwrap(region.asAccordionRow)
            XCTAssertEqual(row, expected)
        }
    }

    func testOnlyTheLastFourRegionsAreAccordions() {
        for index in 0 ..< 5 {
            XCTAssertNil(layout.regions[index].asAccordionRow)
        }
        for index in 5 ..< 9 {
            XCTAssertNotNil(layout.regions[index].asAccordionRow)
        }
    }

    func testMaxContentWidthMatchesWeb3xl() {
        // web: max-w-3xl = 48rem = 768 pt, centred (mx-auto).
        XCTAssertEqual(layout.maxContentWidth, 768)
    }

    func testAccessibilityLabelIdentity() {
        XCTAssertEqual(layout.accessibilityLabelKey, "status.loading.accessibilityLabel")
        XCTAssertEqual(layout.accessibilityLabelFallback, "Loading system status")
    }
}

// MARK: - Skeleton block primitives

@MainActor final class StatusPageSkeletonBlockTests: XCTestCase {
    func testFillBlockFillsWidth() {
        XCTAssertTrue(StatusSkeletonBlock.fill(height: 44).fillsWidth)
        XCTAssertEqual(StatusSkeletonBlock.fill(height: 44).width, .fill)
    }

    func testFixedBlockIsNotFullWidth() {
        let block = StatusSkeletonBlock.fixed(92, height: 32)
        XCTAssertFalse(block.fillsWidth)
        XCTAssertEqual(block.width, .points(92))
    }

    func testFractionBlockCarriesItsFraction() {
        let block = StatusSkeletonBlock.fraction(0.6, height: 24, topInset: 8)
        XCTAssertFalse(block.fillsWidth)
        XCTAssertEqual(block.width, .fraction(0.6))
        XCTAssertEqual(block.topInset, 8)
    }

    func testDefaultShapeIsRounded() {
        XCTAssertEqual(StatusSkeletonBlock.fixed(120, height: 36).shape, .rounded)
    }

    func testPillShapeIsPreserved() {
        XCTAssertEqual(StatusSkeletonBlock.fixed(56, height: 56, shape: .pill).shape, .pill)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class StatusPageSkeletonTelemetryTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyStatusPageSkeletonTelemetry()
        StatusPageSkeletonSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["StatusPageSkeleton"])
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(StatusPageSkeletonSurface.slug, "StatusPageSkeleton")
    }

    func testReportOpenIsRepeatableContract() {
        let spy = SpyStatusPageSkeletonTelemetry()
        StatusPageSkeletonSurface.reportOpen(to: spy)
        StatusPageSkeletonSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["StatusPageSkeleton", "StatusPageSkeleton"])
    }
}

// MARK: - Localization facade (P1/S10)

@MainActor final class StatusPageSkeletonLocalizationTests: XCTestCase {
    func testAccessibilityLabelResolvesToFallback() {
        // With no catalog at unit-test time, NSLocalizedString returns the
        // `value` fallback — proving the key + English default are wired.
        let resolved = StatusPageSkeletonStrings.string(
            StatusPageSkeletonStringsKey.accessibilityLabel,
            StatusPageSkeletonStringsKey.accessibilityLabelFallback
        )
        XCTAssertEqual(resolved, "Loading system status")
    }

    func testStringsTableIsSurfaceScoped() {
        XCTAssertEqual(StatusPageSkeletonStrings.table, "StatusPageSkeleton")
    }

    func testLabelKeyIsStable() {
        XCTAssertEqual(
            StatusPageSkeletonStringsKey.accessibilityLabel,
            "status.loading.accessibilityLabel"
        )
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyStatusPageSkeletonTelemetry: StatusPageSkeletonTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
