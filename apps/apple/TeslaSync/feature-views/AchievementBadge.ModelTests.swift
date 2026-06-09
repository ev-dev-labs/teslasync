//
//  AchievementBadge.ModelTests.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  State-holder coverage for `AchievementBadgeModel`: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the connection axis (live / stale / offline)
//  with the one-shot stale auto-refresh (re-armed on return to live), offline keeping
//  the cached achievement, and the manual refresh / stop-and-restart wiring. Driven
//  through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

private func sampleAchievement(unlocked: Bool = false, progress: Double = 0.5) -> AchievementBadgeData {
    AchievementBadgeData(
        id: "ach-1",
        name: "Road Warrior",
        description: "Drive 10,000 miles",
        icon: "🏆",
        unlocked: unlocked,
        unlockedAt: unlocked ? "2026-05-01T00:00:00Z" : nil,
        progress: progress,
        target: 100,
        current: progress * 100
    )
}

@MainActor
final class AchievementBadgeModelTests: XCTestCase {
    private func makeModel(
        _ input: AchievementBadgeInput,
        telemetry: AchievementBadgeTelemetry = OSLogAchievementBadgeTelemetry()
    ) -> (AchievementBadgeModel, InMemoryAchievementBadgeSource) {
        let source = InMemoryAchievementBadgeSource(initial: input)
        let model = AchievementBadgeModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: AchievementBadgeInput {
        AchievementBadgeInput(achievement: sampleAchievement(progress: 0.86))
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAchievementBadgeTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.percent, 86)
        XCTAssertTrue(model.resolved.isNearComplete)
        XCTAssertEqual(spy.surfaces, [AchievementBadge.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AchievementBadgeInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testResolvedWithoutAchievementProjectsEmpty() {
        let (model, _) = makeModel(AchievementBadgeInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(AchievementBadgeInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(AchievementBadgeInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AchievementBadgeInput(achievement: sampleAchievement(unlocked: true, progress: 1)))
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.resolved.unlocked)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AchievementBadgeInput(achievement: sampleAchievement(progress: 0.86), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(AchievementBadgeInput(achievement: sampleAchievement(progress: 0.86), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(AchievementBadgeInput(achievement: sampleAchievement(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AchievementBadgeInput(achievement: sampleAchievement(), connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(AchievementBadgeInput(achievement: sampleAchievement(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedAchievementAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(AchievementBadgeInput(achievement: sampleAchievement(progress: 0.86), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AchievementBadge.surfaceSlug, "AchievementBadge")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-
/// guarded so it satisfies the `Sendable` telemetry seam under Swift 6 strict
/// concurrency.
private final class SpyAchievementBadgeTelemetry: AchievementBadgeTelemetry, @unchecked Sendable {
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
