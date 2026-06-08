//
//  EnvironmentSlide.Tests.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  Unit coverage for the EnvironmentSlide surface:
//    • Adapter (cached → projection) — `EnvironmentSlideProjector` value parity with the web slide's
//      arithmetic: treesPlanted = round(co2 / 21), the 30-glyph cap, the "+N more" overflow remainder,
//      the grouped zero-decimal CO₂ figure, half-up rounding + non-finite collapse.
//    • State holder — `EnvironmentSlideModel` phase resolution across loading / empty / error /
//      content (one assertion per state), the P1/S11 `view.opened` telemetry, refresh + stale
//      auto-refresh wiring, and cached-value survival behind a failure.
//    • i18n — the pluralized "Like planting {{count}} trees" interpolation + the source keys.
//    • Accessibility — the VoiceOver summary content (the slide's combined a11y label).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryEnvironmentSlideSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web slide)

final class EnvironmentSlideAdapterTests: XCTestCase {
    /// The web slide's headline derivation: `Math.round(co2_offset_kg / 21)` trees, capped at 30
    /// glyphs, with the remainder surfaced as "+N more". 1,840.2 kg → round(87.62…) = 88.
    func testProjectionTreesCapAndOverflow() {
        let projection = EnvironmentSlideProjector.project(
            stats: EnvironmentReviewDTO(co2OffsetKg: 1840.2),
            localeIdentifier: "en_US"
        )
        XCTAssertEqual(projection.treesPlanted, 88)
        XCTAssertEqual(projection.treeIconCount, 30)
        XCTAssertEqual(projection.overflow, 58)
        XCTAssertTrue(projection.hasOverflow)
        XCTAssertEqual(projection.co2Value, "1,840")
        XCTAssertEqual(projection.co2Unit, "kg")
        XCTAssertEqual(projection.co2Suffix, " kg")
        XCTAssertEqual(projection.co2OffsetKg, 1840.2)
    }

    /// Exactly at the cap: 630 kg → 30 trees, 30 glyphs, no overflow chip.
    func testProjectionExactlyAtCap() {
        let projection = EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 630))
        XCTAssertEqual(projection.treesPlanted, 30)
        XCTAssertEqual(projection.treeIconCount, 30)
        XCTAssertEqual(projection.overflow, 0)
        XCTAssertFalse(projection.hasOverflow)
    }

    /// One past the cap: 651 kg → round(31.0) = 31 → 30 glyphs + "+1 more".
    func testProjectionOneOverCap() {
        let projection = EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 651))
        XCTAssertEqual(projection.treesPlanted, 31)
        XCTAssertEqual(projection.treeIconCount, 30)
        XCTAssertEqual(projection.overflow, 1)
        XCTAssertTrue(projection.hasOverflow)
    }

    /// A modest recap renders the exact glyph count with no overflow: 84 kg → 4 trees.
    func testProjectionSmallRecap() {
        let projection = EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 84))
        XCTAssertEqual(projection.treesPlanted, 4)
        XCTAssertEqual(projection.treeIconCount, 4)
        XCTAssertEqual(projection.overflow, 0)
        XCTAssertFalse(projection.hasOverflow)
        XCTAssertEqual(projection.co2Value, "84")
    }

    /// Zero offset → no trees, "0" figure (the slide still renders, never a blank box).
    func testProjectionZero() {
        let projection = EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 0))
        XCTAssertEqual(projection.treesPlanted, 0)
        XCTAssertEqual(projection.treeIconCount, 0)
        XCTAssertEqual(projection.overflow, 0)
        XCTAssertEqual(projection.co2Value, "0")
    }

    /// `Math.round` half-up boundary parity (10.5 / 21 = 0.5 → 1; 10.4 / 21 = 0.495 → 0).
    func testRoundingHalfUpBoundary() {
        XCTAssertEqual(
            EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 10.4)).treesPlanted,
            0
        )
        XCTAssertEqual(
            EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 10.5)).treesPlanted,
            1
        )
    }

    /// Non-finite input collapses to 0 (web `safeNumber`), so the slide never shows NaN.
    func testNonFiniteCollapsesToZero() {
        let projection = EnvironmentSlideProjector.project(
            stats: EnvironmentReviewDTO(co2OffsetKg: .infinity)
        )
        XCTAssertEqual(projection.co2OffsetKg, 0)
        XCTAssertEqual(projection.treesPlanted, 0)
        XCTAssertEqual(projection.treeIconCount, 0)
        XCTAssertEqual(projection.co2Value, "0")
    }

    /// Grouped, zero-decimal formatting matches the web `fmtNumber(value, 0)`.
    func testNumberFormatting() {
        XCTAssertEqual(EnvironmentSlideFormat.number(1840, decimals: 0), "1,840")
        XCTAssertEqual(EnvironmentSlideFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(EnvironmentSlideFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(EnvironmentSlideFormat.integer(42), "42")
    }

    /// A large recap groups the headline figure per locale: 12,600 kg → 600 trees → "+570 more".
    func testProjectionLargeRecapGroupsFigure() {
        let projection = EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 12600))
        XCTAssertEqual(projection.co2Value, "12,600")
        XCTAssertEqual(projection.treesPlanted, 600)
        XCTAssertEqual(projection.treeIconCount, 30)
        XCTAssertEqual(projection.overflow, 570)
    }
}

// MARK: - State holder: phase resolution per state

final class EnvironmentSlidePhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        typealias Phase = EnvironmentSlideModel.Phase
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .loading, hasData: false), Phase.loading)
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .loading, hasData: true), Phase.content)
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .empty, hasData: false), Phase.empty)
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .empty, hasData: true), Phase.empty)
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .loaded, hasData: false), Phase.empty)
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .loaded, hasData: true), Phase.content)
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .failed("x"), hasData: false), Phase.error("x"))
        XCTAssertEqual(EnvironmentSlideModel.resolvePhase(status: .failed("x"), hasData: true), Phase.content)
    }
}

// MARK: - State holder: model wiring + telemetry

@MainActor
final class EnvironmentSlideModelTests: XCTestCase {
    private func makeModel(
        _ update: EnvironmentSlideUpdate,
        telemetry: EnvironmentSlideTelemetry = OSLogEnvironmentSlideTelemetry()
    ) -> (EnvironmentSlideModel, InMemoryEnvironmentSlideSource) {
        let source = InMemoryEnvironmentSlideSource(initial: update)
        let model = EnvironmentSlideModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingStateWithoutData() {
        let (model, _) = makeModel(EnvironmentSlideUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testEmptyStateWhenLoadedWithoutData() {
        let (model, _) = makeModel(EnvironmentSlideUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorStateWithoutCache() {
        let (model, _) = makeModel(EnvironmentSlideUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testContentStateProjectsValue() {
        let (model, _) = makeModel(
            EnvironmentSlideUpdate(status: .loaded, stats: EnvironmentReviewDTO(co2OffsetKg: 1840.2))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.treesPlanted, 88)
        XCTAssertEqual(model.projection?.co2Value, "1,840")
    }

    func testCachedValueSurvivesFailure() {
        let stats = EnvironmentReviewDTO(co2OffsetKg: 210)
        let (model, _) = makeModel(EnvironmentSlideUpdate(status: .failed("net"), stats: stats))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.treesPlanted, 10)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyEnvironmentSlideTelemetry()
        let (model, source) = makeModel(EnvironmentSlideUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [EnvironmentSlide.surfaceSlug])
        XCTAssertEqual(spy.surfaces, ["EnvironmentSlide"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EnvironmentSlideUpdate(status: .loaded, stats: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = EnvironmentReviewDTO(co2OffsetKg: 100)
        let (model, source) = makeModel(EnvironmentSlideUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            EnvironmentSlideUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats)
        )
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            EnvironmentSlideUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats)
        )
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUpdatedAtTrackUpdates() {
        let (model, source) = makeModel(EnvironmentSlideUpdate(status: .loading, stats: nil))
        model.start()
        let stamp = Date()
        source.push(
            EnvironmentSlideUpdate(
                status: .loaded,
                connection: .offline,
                stats: EnvironmentReviewDTO(co2OffsetKg: 42),
                updatedAt: stamp
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.updatedAt, stamp)
        XCTAssertEqual(model.projection?.treesPlanted, 2)
    }
}

// MARK: - i18n: pluralized caption + source keys

final class EnvironmentSlideStringsTests: XCTestCase {
    func testTreesCaptionInterpolatesCount() {
        XCTAssertEqual(EnvironmentSlideStrings.trees(88), "Like planting 88 trees")
        XCTAssertEqual(EnvironmentSlideStrings.trees(1), "Like planting 1 trees")
        XCTAssertEqual(EnvironmentSlideStrings.trees(0), "Like planting 0 trees")
    }

    func testSourceKeyFallbacksResolve() {
        XCTAssertEqual(EnvironmentSlideStrings.string("yearReview.co2Offset", "CO₂ offset"), "CO₂ offset")
        XCTAssertEqual(EnvironmentSlideStrings.string("yearReview.more", "more"), "more")
        XCTAssertEqual(EnvironmentSlideStrings.string("environment.co2Unit", "kg"), "kg")
    }
}

// MARK: - Accessibility summary content

final class EnvironmentSlideAccessibilityTests: XCTestCase {
    func testSummaryCombinesLabelFigureAndTrees() {
        let projection = EnvironmentSlideProjector.project(
            stats: EnvironmentReviewDTO(co2OffsetKg: 1840.2),
            localeIdentifier: "en_US"
        )
        let summary = EnvironmentSlideAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("CO₂ offset"))
        XCTAssertTrue(summary.contains("1,840 kg"))
        XCTAssertTrue(summary.contains("88 trees"))
    }

    func testSummaryForZeroRecap() {
        let projection = EnvironmentSlideProjector.project(stats: EnvironmentReviewDTO(co2OffsetKg: 0))
        let summary = EnvironmentSlideAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("0 kg"))
        XCTAssertTrue(summary.contains("0 trees"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEnvironmentSlideTelemetry: EnvironmentSlideTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
