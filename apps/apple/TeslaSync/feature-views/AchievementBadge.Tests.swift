//
//  AchievementBadge.Tests.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  Adapter + projection coverage for the AchievementBadge surface:
//    • Metrics — `isNearComplete` (the `!unlocked && progress >= 0.8` threshold), the
//      rounded `percentInt` (port of JS `Math.round(progress * 100)`), and the clamped
//      ring fraction (web `value/max`).
//    • Format — the `{pct}%` footer label (web template literal).
//    • Projection — the web render branches plus the P4 leaf contract across
//      loading / empty / error / data and the unlocked / near-complete flags, for
//      every size variant.
//    • Accessibility — the composed VoiceOver badge label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store.
//

import XCTest
@testable import TeslaSync

private func makeAchievement(
    unlocked: Bool = false,
    progress: Double = 0,
    name: String = "Road Warrior",
    description: String = "Drive 10,000 miles",
    icon: String = "🏆"
) -> AchievementBadgeData {
    AchievementBadgeData(
        id: "ach-1",
        name: name,
        description: description,
        icon: icon,
        unlocked: unlocked,
        unlockedAt: unlocked ? "2026-05-01T00:00:00Z" : nil,
        progress: progress,
        target: 100,
        current: progress * 100
    )
}

// MARK: - Near-complete threshold (web `!unlocked && progress >= 0.8`)

final class AchievementBadgeNearCompleteTests: XCTestCase {
    func testAtAndAboveThresholdWhenLocked() {
        XCTAssertTrue(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: 0.8))
        XCTAssertTrue(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: 0.95))
        XCTAssertTrue(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: 1))
    }

    func testBelowThreshold() {
        XCTAssertFalse(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: 0.79))
        XCTAssertFalse(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: 0))
    }

    func testUnlockedIsNeverNearComplete() {
        XCTAssertFalse(AchievementBadgeMetrics.isNearComplete(unlocked: true, progress: 0.9))
        XCTAssertFalse(AchievementBadgeMetrics.isNearComplete(unlocked: true, progress: 1))
    }

    func testNonFiniteProgressIsNotNearComplete() {
        XCTAssertFalse(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: .nan))
        XCTAssertFalse(AchievementBadgeMetrics.isNearComplete(unlocked: false, progress: .infinity))
    }
}

// MARK: - Percentage (port of `Math.round(progress * 100)`)

final class AchievementBadgePercentTests: XCTestCase {
    func testRoundsToNearestInteger() {
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 0), 0)
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 0.324), 32)
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 0.325), 33)
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 0.86), 86)
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 1), 100)
    }

    func testHalfRoundsAwayLikeMathRound() {
        // 0.005 * 100 = 0.5 → 1 (JS Math.round rounds .5 up).
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 0.005), 1)
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: 0.015), 2)
    }

    func testNonFiniteProgressCoercesToZero() {
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: .nan), 0)
        XCTAssertEqual(AchievementBadgeMetrics.percentInt(progress: .infinity), 0)
    }
}

// MARK: - Ring fraction (web `value/max` clamp)

final class AchievementBadgeRingFractionTests: XCTestCase {
    func testFractionEqualsRoundedPercentOverHundred() {
        XCTAssertEqual(AchievementBadgeMetrics.ringFraction(progress: 0.324), 0.32, accuracy: 1e-9)
        XCTAssertEqual(AchievementBadgeMetrics.ringFraction(progress: 0.86), 0.86, accuracy: 1e-9)
    }

    func testClampedToUnitRange() {
        XCTAssertEqual(AchievementBadgeMetrics.ringFraction(progress: 1.5), 1, accuracy: 1e-9)
        XCTAssertEqual(AchievementBadgeMetrics.ringFraction(progress: -0.5), 0, accuracy: 1e-9)
    }

    func testNonFiniteIsZero() {
        XCTAssertEqual(AchievementBadgeMetrics.ringFraction(progress: .nan), 0, accuracy: 1e-9)
    }
}

// MARK: - Footer label (web `{pct}%`)

final class AchievementBadgeFormatTests: XCTestCase {
    func testPercentLabelAppendsSign() {
        XCTAssertEqual(AchievementBadgeFormat.percentLabel(progress: 0), "0%")
        XCTAssertEqual(AchievementBadgeFormat.percentLabel(progress: 0.324), "32%")
        XCTAssertEqual(AchievementBadgeFormat.percentLabel(progress: 1), "100%")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor
final class AchievementBadgeProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = AchievementBadgeProjection.resolve(AchievementBadgeInput(
            achievement: makeAchievement(unlocked: true, progress: 1),
            errorMessage: "boom"
        ))
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = AchievementBadgeProjection.resolve(AchievementBadgeInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenResolvedWithoutAchievement() {
        let resolved = AchievementBadgeProjection.resolve(AchievementBadgeInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.achievement)
    }

    func testDataUnlockedHasNoRingAndIsNotNearComplete() {
        let resolved = AchievementBadgeProjection.resolve(AchievementBadgeInput(
            achievement: makeAchievement(unlocked: true, progress: 1)
        ))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertTrue(resolved.unlocked)
        XCTAssertFalse(resolved.isNearComplete)
        XCTAssertEqual(resolved.percent, 100)
        XCTAssertEqual(resolved.ringFraction, 1, accuracy: 1e-9)
    }

    func testDataLockedNearCompleteSetsFlagAndFraction() {
        let resolved = AchievementBadgeProjection.resolve(AchievementBadgeInput(
            achievement: makeAchievement(unlocked: false, progress: 0.86)
        ))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertFalse(resolved.unlocked)
        XCTAssertTrue(resolved.isNearComplete)
        XCTAssertEqual(resolved.percent, 86)
        XCTAssertEqual(resolved.ringFraction, 0.86, accuracy: 1e-9)
    }

    func testDataLockedPartialIsNotNearComplete() {
        let resolved = AchievementBadgeProjection.resolve(AchievementBadgeInput(
            achievement: makeAchievement(unlocked: false, progress: 0.32)
        ))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertFalse(resolved.isNearComplete)
        XCTAssertEqual(resolved.percent, 32)
    }

    func testSizeFlowsThroughEveryPhase() {
        for size in AchievementBadgeSize.allCases {
            let data = AchievementBadgeProjection.resolve(AchievementBadgeInput(
                achievement: makeAchievement(progress: 0.5), size: size
            ))
            XCTAssertEqual(data.size, size)
            let loading = AchievementBadgeProjection.resolve(AchievementBadgeInput(size: size, isLoading: true))
            XCTAssertEqual(loading.size, size)
            let empty = AchievementBadgeProjection.resolve(AchievementBadgeInput(size: size))
            XCTAssertEqual(empty.size, size)
            let error = AchievementBadgeProjection.resolve(AchievementBadgeInput(size: size, errorMessage: "x"))
            XCTAssertEqual(error.size, size)
        }
    }
}

// MARK: - Accessibility summary content

final class AchievementBadgeAccessibilityTests: XCTestCase {
    func testBadgeLabelJoinsParts() {
        XCTAssertEqual(
            AchievementBadgeAccessibility.badgeLabel(
                name: "Road Warrior",
                description: "Drive 10,000 miles",
                status: "Unlocked"
            ),
            "Road Warrior, Drive 10,000 miles, Unlocked"
        )
    }

    func testBadgeLabelDropsEmptyParts() {
        XCTAssertEqual(
            AchievementBadgeAccessibility.badgeLabel(name: "Night Owl", description: "", status: "86 percent complete"),
            "Night Owl, 86 percent complete"
        )
    }
}
