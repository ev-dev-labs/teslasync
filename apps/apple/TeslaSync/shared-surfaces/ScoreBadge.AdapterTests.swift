//
//  ScoreBadge.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  Pure-core coverage for the ScoreBadge adapter — the verbatim ports of the web `scoreScale.ts`
//  helpers, asserted in isolation (Foundation only, no store, no view):
//    • ScoreBadgeGrade — the glyph fallbacks (A+/A/B/C/D/F/—) + the namespaced i18n keys.
//    • ScoreBadgeScale — `numericToGrade` every threshold band + boundaries (null / non-finite →
//      unrated, the F floor, highest-first evaluation, custom thresholds).
//    • ScoreBadgeValue — the `.grade` passthrough vs `.score` numericToGrade split.
//    • ScoreBadgeSize — the `SIZE_CLASS` point sizes + raw ids.
//    • ScoreBadgeAriaBuilder — the `Score {{grade}}` composer with + without an override.
//    • ScoreBadgeAccessibility — the aria-plus-stale-plus-offline VoiceOver label.
//    • ScoreBadgeMeta — the static diagnostics slug.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let passthroughStrings: ScoreBadgeResolve = { _, fallback in fallback }

// MARK: - Grade (web shared palette labels + keys)

final class ScoreBadgeGradeTests: XCTestCase {
    func testGlyphFallbacksMatchWebPalette() {
        XCTAssertEqual(ScoreBadgeGrade.aPlus.label(passthroughStrings), "A+")
        XCTAssertEqual(ScoreBadgeGrade.aGrade.label(passthroughStrings), "A")
        XCTAssertEqual(ScoreBadgeGrade.bGrade.label(passthroughStrings), "B")
        XCTAssertEqual(ScoreBadgeGrade.cGrade.label(passthroughStrings), "C")
        XCTAssertEqual(ScoreBadgeGrade.dGrade.label(passthroughStrings), "D")
        XCTAssertEqual(ScoreBadgeGrade.fGrade.label(passthroughStrings), "F")
        XCTAssertEqual(ScoreBadgeGrade.unrated.label(passthroughStrings), "—")
    }

    func testKeysAreNamespacedByCleanScaleId() {
        XCTAssertEqual(ScoreBadgeGrade.aPlus.labelKey, "score.grade.aPlus.label")
        XCTAssertEqual(ScoreBadgeGrade.aGrade.labelKey, "score.grade.a.label")
        XCTAssertEqual(ScoreBadgeGrade.bGrade.labelKey, "score.grade.b.label")
        XCTAssertEqual(ScoreBadgeGrade.unrated.labelKey, "score.grade.unrated.label")
    }

    func testEveryGradeHasANonEmptyGlyph() {
        for grade in ScoreBadgeGrade.allCases {
            XCTAssertFalse(grade.labelFallback.isEmpty)
        }
    }
}

// MARK: - Scale (web `numericToGrade` + `DEFAULT_SCORE_THRESHOLDS`)

final class ScoreBadgeScaleTests: XCTestCase {
    private func grade(_ score: Double?) -> ScoreBadgeGrade {
        ScoreBadgeScale.grade(for: score)
    }

    func testNullAndNonFiniteFoldToUnrated() {
        XCTAssertEqual(grade(nil), .unrated)
        XCTAssertEqual(grade(.nan), .unrated)
        XCTAssertEqual(grade(.infinity), .unrated)
        XCTAssertEqual(grade(-.infinity), .unrated)
    }

    func testDefaultBandsAtLowerBounds() {
        XCTAssertEqual(grade(100), .aPlus)
        XCTAssertEqual(grade(90), .aPlus)
        XCTAssertEqual(grade(80), .aGrade)
        XCTAssertEqual(grade(65), .bGrade)
        XCTAssertEqual(grade(50), .cGrade)
        XCTAssertEqual(grade(35), .dGrade)
        XCTAssertEqual(grade(0), .fGrade)
    }

    func testDefaultBandsJustBelowEachBoundary() {
        XCTAssertEqual(grade(89.999), .aGrade)
        XCTAssertEqual(grade(79.999), .bGrade)
        XCTAssertEqual(grade(64.999), .cGrade)
        XCTAssertEqual(grade(49.999), .dGrade)
        XCTAssertEqual(grade(34.999), .fGrade)
    }

    func testBelowZeroFallsThroughToFloor() {
        XCTAssertEqual(grade(-1), .fGrade)
        XCTAssertEqual(grade(-100), .fGrade)
    }

    func testCustomThresholdsOverrideTheDefaultScale() {
        // An inverse-style scale (e.g. Wh/km efficiency): a small handful of custom bands.
        let custom = [
            ScoreBadgeThreshold(min: 10, grade: .aPlus),
            ScoreBadgeThreshold(min: 0, grade: .fGrade)
        ]
        XCTAssertEqual(ScoreBadgeScale.grade(for: 12, thresholds: custom), .aPlus)
        XCTAssertEqual(ScoreBadgeScale.grade(for: 10, thresholds: custom), .aPlus)
        XCTAssertEqual(ScoreBadgeScale.grade(for: 5, thresholds: custom), .fGrade)
    }

    func testThresholdsEvaluatedHighestFirstRegardlessOfOrder() {
        let unordered = [
            ScoreBadgeThreshold(min: 0, grade: .fGrade),
            ScoreBadgeThreshold(min: 90, grade: .aPlus),
            ScoreBadgeThreshold(min: 50, grade: .cGrade)
        ]
        XCTAssertEqual(ScoreBadgeScale.grade(for: 95, thresholds: unordered), .aPlus)
        XCTAssertEqual(ScoreBadgeScale.grade(for: 60, thresholds: unordered), .cGrade)
        XCTAssertEqual(ScoreBadgeScale.grade(for: 10, thresholds: unordered), .fGrade)
    }

    func testDefaultThresholdsMatchWebScale() {
        let mins = ScoreBadgeScale.defaultThresholds.map(\.min)
        XCTAssertEqual(mins, [90, 80, 65, 50, 35, 0])
        XCTAssertEqual(ScoreBadgeScale.defaultThresholds.map(\.grade), [
            .aPlus, .aGrade, .bGrade, .cGrade, .dGrade, .fGrade
        ])
    }
}

// MARK: - Value (web `'grade' in props ? gradeInfo : numericToGrade`)

final class ScoreBadgeValueTests: XCTestCase {
    func testGradeValuePassesThrough() {
        XCTAssertEqual(ScoreBadgeValue.grade(.bGrade).resolvedGrade(), .bGrade)
        XCTAssertEqual(ScoreBadgeValue.grade(.unrated).resolvedGrade(), .unrated)
    }

    func testScoreValueRunsTheScale() {
        XCTAssertEqual(ScoreBadgeValue.score(87).resolvedGrade(), .aGrade)
        XCTAssertEqual(ScoreBadgeValue.score(72).resolvedGrade(), .bGrade)
        XCTAssertEqual(ScoreBadgeValue.score(nil).resolvedGrade(), .unrated)
    }

    func testScoreValueHonorsCustomThresholds() {
        let custom = [ScoreBadgeThreshold(min: 100, grade: .aPlus), ScoreBadgeThreshold(min: 0, grade: .dGrade)]
        XCTAssertEqual(ScoreBadgeValue.score(150, thresholds: custom).resolvedGrade(), .aPlus)
        XCTAssertEqual(ScoreBadgeValue.score(40, thresholds: custom).resolvedGrade(), .dGrade)
    }
}

// MARK: - Size (web `SIZE_CLASS`)

final class ScoreBadgeSizeTests: XCTestCase {
    func testPointSizesMatchWebScale() {
        XCTAssertEqual(ScoreBadgeSize.small.pointSize, 12)
        XCTAssertEqual(ScoreBadgeSize.medium.pointSize, 20)
        XCTAssertEqual(ScoreBadgeSize.large.pointSize, 30)
    }

    func testRawIdsMatchWebProp() {
        XCTAssertEqual(ScoreBadgeSize.small.rawValue, "sm")
        XCTAssertEqual(ScoreBadgeSize.medium.rawValue, "md")
        XCTAssertEqual(ScoreBadgeSize.large.rawValue, "lg")
    }

    func testSkeletonGrowsWithSize() {
        XCTAssertLessThan(ScoreBadgeSize.small.skeletonSize.height, ScoreBadgeSize.medium.skeletonSize.height)
        XCTAssertLessThan(ScoreBadgeSize.medium.skeletonSize.height, ScoreBadgeSize.large.skeletonSize.height)
    }
}

// MARK: - Aria builder (web `t('score.aria', 'Score {{grade}}', { grade })`)

final class ScoreBadgeAriaBuilderTests: XCTestCase {
    func testComposesScorePlusGlyph() {
        XCTAssertEqual(
            ScoreBadgeAriaBuilder.label(gradeLabel: "B", override: nil, strings: passthroughStrings),
            "Score B"
        )
        XCTAssertEqual(
            ScoreBadgeAriaBuilder.label(gradeLabel: "—", override: nil, strings: passthroughStrings),
            "Score —"
        )
    }

    func testOverrideWinsWhenPresent() {
        XCTAssertEqual(
            ScoreBadgeAriaBuilder.label(gradeLabel: "B", override: "Drive grade B", strings: passthroughStrings),
            "Drive grade B"
        )
    }

    func testEmptyOverrideIsIgnored() {
        XCTAssertEqual(
            ScoreBadgeAriaBuilder.label(gradeLabel: "A", override: "", strings: passthroughStrings),
            "Score A"
        )
    }
}

// MARK: - Accessibility (aria + stale + offline notes)

final class ScoreBadgeAccessibilityTests: XCTestCase {
    func testBaseOnlyWhenFresh() {
        XCTAssertEqual(
            ScoreBadgeAccessibility.label(base: "Score B", staleNote: nil, offlineNote: nil),
            "Score B"
        )
    }

    func testAppendsStaleNote() {
        XCTAssertEqual(
            ScoreBadgeAccessibility.label(base: "Score B", staleNote: "Score may be out of date", offlineNote: nil),
            "Score B, Score may be out of date"
        )
    }

    func testAppendsOfflineNote() {
        XCTAssertEqual(
            ScoreBadgeAccessibility.label(base: "Score A+", staleNote: nil, offlineNote: "Offline — last known"),
            "Score A+, Offline — last known"
        )
    }

    func testAppendsBothNotesInOrder() {
        XCTAssertEqual(
            ScoreBadgeAccessibility.label(base: "Score C", staleNote: "stale", offlineNote: "offline"),
            "Score C, stale, offline"
        )
    }
}

// MARK: - Metadata (static identity)

final class ScoreBadgeMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(ScoreBadgeMeta.surfaceSlug, "ScoreBadge")
        XCTAssertEqual(ScoreBadge.surfaceSlug, "ScoreBadge")
    }
}
