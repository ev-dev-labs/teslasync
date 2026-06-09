//
//  RecentlyUnlockedAchievements.Tests.swift
//  TeslaSync — P4 dashboard widget · 0080 · RecentlyUnlockedAchievements (Apple)
//
//  Unit coverage for the RecentlyUnlockedAchievements surface:
//    • Adapter (cached → projection) — `RecentlyUnlockedProjector` selection parity with the
//      web widget's pipeline (filter unlocked + unlocked_at, sort unlocked_at desc, stable ties,
//      slice to the layout limit), plus per-badge accessibility labels.
//    • State holder — `RecentlyUnlockedModel` phase resolution across disabled / loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry and refresh + stale auto-refresh.
//    • Registry — canonical `recently-unlocked-achievements` metadata + size clamping.
//    • Accessibility — the VoiceOver strip summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryRecentlyUnlockedSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached achievements → ranked projection (port parity with the web widget)

@MainActor final class RecentlyUnlockedAdapterTests: XCTestCase {
    private func make(_ id: String, unlocked: Bool, at seconds: TimeInterval?) -> AchievementUnlock {
        AchievementUnlock(
            id: id,
            name: id.capitalized,
            detail: "\(id) detail",
            icon: "🏆",
            unlocked: unlocked,
            unlockedAt: seconds.map { Date(timeIntervalSince1970: $0) }
        )
    }

    /// filter(unlocked && unlocked_at) — locked achievements and unlocked-without-timestamp
    /// achievements are excluded, exactly like the web `.filter(a => a.unlocked && a.unlocked_at)`.
    func testFiltersLockedAndUndatedAchievements() {
        let input = [
            make("a", unlocked: true, at: 100),
            make("locked", unlocked: false, at: 999), // locked → excluded
            make("undated", unlocked: true, at: nil), // unlocked but no timestamp → excluded
            make("b", unlocked: true, at: 50)
        ]
        let projection = RecentlyUnlockedProjector.project(achievements: input)
        XCTAssertEqual(projection.ranked.map(\.id), ["a", "b"])
    }

    /// sort(unlocked_at desc) — newest unlock first, regardless of input order.
    func testSortsByUnlockedAtDescending() {
        let input = [
            make("middle", unlocked: true, at: 200),
            make("newest", unlocked: true, at: 300),
            make("oldest", unlocked: true, at: 100)
        ]
        let projection = RecentlyUnlockedProjector.project(achievements: input)
        XCTAssertEqual(projection.ranked.map(\.id), ["newest", "middle", "oldest"])
    }

    /// Equal timestamps preserve original array order (JavaScript's stable `Array.prototype.sort`).
    func testStableOrderOnEqualTimestamps() {
        let input = [
            make("first", unlocked: true, at: 500),
            make("second", unlocked: true, at: 500),
            make("third", unlocked: true, at: 500)
        ]
        let projection = RecentlyUnlockedProjector.project(achievements: input)
        XCTAssertEqual(projection.ranked.map(\.id), ["first", "second", "third"])
    }

    /// slice(0, limit) — narrow layouts show 3, wide layouts show 5, and the retained list is
    /// capped at the wide limit.
    func testSliceHonorsLayoutLimit() {
        let input = (0 ..< 8).map { make("ach-\($0)", unlocked: true, at: TimeInterval(1000 - $0)) }
        let projection = RecentlyUnlockedProjector.project(achievements: input)

        XCTAssertEqual(projection.ranked.count, 5)
        XCTAssertEqual(projection.items(isWide: false).count, 3)
        XCTAssertEqual(projection.items(isWide: true).count, 5)
        XCTAssertEqual(projection.items(isWide: false).map(\.id), ["ach-0", "ach-1", "ach-2"])
        XCTAssertFalse(projection.isEmpty)
    }

    func testEmptyWhenNoUnlocks() {
        let projection = RecentlyUnlockedProjector.project(achievements: [
            make("locked", unlocked: false, at: 10)
        ])
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.items(isWide: true).count, 0)
    }

    func testItemCarriesDisplayFields() {
        let projection = RecentlyUnlockedProjector.project(achievements: [
            AchievementUnlock(
                id: "road-warrior",
                name: "Road Warrior",
                detail: "Drove 10,000 km",
                icon: "🚗",
                unlocked: true,
                unlockedAt: Date(timeIntervalSince1970: 1)
            )
        ])
        let item = try? XCTUnwrap(projection.ranked.first)
        XCTAssertEqual(item?.id, "road-warrior")
        XCTAssertEqual(item?.name, "Road Warrior")
        XCTAssertEqual(item?.detail, "Drove 10,000 km")
        XCTAssertEqual(item?.icon, "🚗")
        XCTAssertEqual(item?.accessibilityLabel, "View achievement: Road Warrior")
        XCTAssertEqual(item?.statusText, "✓ Unlocked")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class RecentlyUnlockedPhaseTests: XCTestCase {
    func testDisabledOverridesEveryStatus() {
        for status in [
            RecentlyUnlockedLoadStatus.loading,
            .loaded,
            .empty,
            .failed("x")
        ] {
            XCTAssertEqual(
                RecentlyUnlockedModel.resolvePhase(status: status, hasItems: true, showOnDashboard: false),
                .disabled
            )
        }
    }

    func testResolvePhaseMatrixWhenEnabled() {
        func phase(_ status: RecentlyUnlockedLoadStatus, _ hasItems: Bool) -> RecentlyUnlockedModel.Phase {
            RecentlyUnlockedModel.resolvePhase(status: status, hasItems: hasItems, showOnDashboard: true)
        }
        XCTAssertEqual(phase(.loading, false), .loading)
        XCTAssertEqual(phase(.loading, true), .content)
        XCTAssertEqual(phase(.empty, false), .empty)
        XCTAssertEqual(phase(.empty, true), .empty)
        XCTAssertEqual(phase(.loaded, false), .empty)
        XCTAssertEqual(phase(.loaded, true), .content)
        XCTAssertEqual(phase(.failed("e"), false), .error("e"))
        XCTAssertEqual(phase(.failed("e"), true), .content)
    }
}

@MainActor final class RecentlyUnlockedModelTests: XCTestCase {
    private let unlocked = AchievementUnlock(
        id: "a",
        name: "A",
        detail: "d",
        icon: "🏆",
        unlocked: true,
        unlockedAt: Date(timeIntervalSince1970: 100)
    )
    private let locked = AchievementUnlock(
        id: "b",
        name: "B",
        detail: "d",
        icon: "🔒",
        unlocked: false,
        unlockedAt: nil
    )

    private func makeModel(
        _ update: RecentlyUnlockedUpdate,
        telemetry: RecentlyUnlockedTelemetry = OSLogRecentlyUnlockedTelemetry()
    ) -> (RecentlyUnlockedModel, InMemoryRecentlyUnlockedSource) {
        let source = InMemoryRecentlyUnlockedSource(initial: update)
        let model = RecentlyUnlockedModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testDisabledPhaseFromPrefs() {
        let (model, _) = makeModel(
            RecentlyUnlockedUpdate(status: .loaded, achievements: [unlocked], showOnDashboard: false)
        )
        model.start()
        XCTAssertEqual(model.phase, .disabled)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(RecentlyUnlockedUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithOnlyLockedShowsEmpty() {
        let (model, _) = makeModel(RecentlyUnlockedUpdate(status: .loaded, achievements: [locked]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.projection.isEmpty)
    }

    func testLoadedWithUnlocksShowsContent() {
        let (model, _) = makeModel(RecentlyUnlockedUpdate(status: .loaded, achievements: [unlocked, locked]))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.ranked.map(\.id), ["a"])
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(RecentlyUnlockedUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(RecentlyUnlockedUpdate(status: .failed("net"), achievements: [unlocked]))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.ranked.count, 1)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyRecentlyUnlockedTelemetry()
        let (model, source) = makeModel(RecentlyUnlockedUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RecentlyUnlockedAchievementsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RecentlyUnlockedUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(RecentlyUnlockedUpdate(status: .loaded, achievements: [unlocked]))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            RecentlyUnlockedUpdate(status: .loaded, connection: .stale, isFetching: true, achievements: [unlocked])
        )
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            RecentlyUnlockedUpdate(status: .loaded, connection: .stale, isFetching: false, achievements: [unlocked])
        )
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(RecentlyUnlockedUpdate(status: .loading))
        model.start()
        source.push(
            RecentlyUnlockedUpdate(
                status: .loaded,
                connection: .offline,
                achievements: [unlocked],
                updatedAt: Date(timeIntervalSince1970: 10)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.updatedAt, Date(timeIntervalSince1970: 10))
        XCTAssertFalse(model.projection.isEmpty)
    }
}

// MARK: - Registry parity

@MainActor final class RecentlyUnlockedRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RecentlyUnlockedAchievementsWidget.registration
        XCTAssertEqual(registration.id, "recently-unlocked-achievements")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 4))
        XCTAssertEqual(RecentlyUnlockedAchievementsWidget.surfaceSlug, "RecentlyUnlockedAchievements")
    }

    func testClampHonorsMinAndMax() {
        let registration = RecentlyUnlockedAchievementsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 4)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 3)), DashboardWidgetSize(cols: 2, rows: 3))
    }
}

// MARK: - Accessibility summary content

@MainActor final class RecentlyUnlockedAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleAndEveryBadge() {
        let projection = RecentlyUnlockedProjector.project(achievements: [
            AchievementUnlock(
                id: "rw",
                name: "Road Warrior",
                detail: "d",
                icon: "🚗",
                unlocked: true,
                unlockedAt: Date(timeIntervalSince1970: 200)
            ),
            AchievementUnlock(
                id: "no",
                name: "Night Owl",
                detail: "d",
                icon: "🦉",
                unlocked: true,
                unlockedAt: Date(timeIntervalSince1970: 100)
            )
        ])
        let summary = RecentlyUnlockedAccessibility.summary(for: projection.items(isWide: true))
        XCTAssertTrue(summary.contains("Recently Unlocked"))
        XCTAssertTrue(summary.contains("View achievement: Road Warrior"))
        XCTAssertTrue(summary.contains("View achievement: Night Owl"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRecentlyUnlockedTelemetry: RecentlyUnlockedTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
