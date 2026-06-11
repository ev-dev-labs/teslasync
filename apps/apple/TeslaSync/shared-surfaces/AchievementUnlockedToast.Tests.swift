//
//  AchievementUnlockedToast.Tests.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  Adapter + projection + model coverage for the AchievementUnlockedToast surface:
//    • Achievement model — the `icon || '🎉'` fallback (web `displayIcon`).
//    • Queue — the web `useAchievementUnlocks` reducer: newest-first insert, de-dupe by id, bound at
//      25, removal, and snapshot normalisation.
//    • Deep link — the `/lifetime?achievement=…` target with `encodeURIComponent` semantics.
//    • Lifetime — the web `durationMs` arithmetic (default + millisecond conversion + clamp).
//    • Confetti — the burst count, the per-component ranges, Reduce-Motion suppression, the seeded
//      determinism, and the stable content-derived seed.
//    • Accessibility — the composed VoiceOver status label.
//    • Projection — every render branch across loading / empty / loaded / failed, with cached toasts
//      surviving a transient failure (the P4 leaf contract).
//    • Model — start telemetry, snapshot application, dismiss / view, and the stale auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private func achievement(
    _ id: String,
    name: String = "Road Warrior",
    detail: String = "Drove a long way.",
    icon: String = "🏆"
) -> AchievementUnlockedAchievement {
    AchievementUnlockedAchievement(id: id, name: name, detail: detail, icon: icon)
}

private func event(_ id: String, icon: String = "🏆") -> AchievementUnlockedEventData {
    AchievementUnlockedEventData(achievement: achievement(id, icon: icon), vehicleID: 1, unlockedAt: nil)
}

// MARK: - Achievement model

final class AchievementUnlockedAchievementTests: XCTestCase {
    func testDisplayIconUsesTheProvidedEmoji() {
        XCTAssertEqual(achievement("a", icon: "⚡️").displayIcon, "⚡️")
    }

    func testDisplayIconFallsBackToPartyPopperWhenEmpty() {
        XCTAssertEqual(achievement("a", icon: "").displayIcon, "🎉")
        XCTAssertEqual(AchievementUnlockedConstants.fallbackIcon, "🎉")
    }
}

// MARK: - Queue (web `useAchievementUnlocks` reducer)

final class AchievementUnlockedQueueTests: XCTestCase {
    func testInsertPrependsNewestFirst() {
        let queue = AchievementUnlockedQueue.inserting(event("b"), into: [event("a")])
        XCTAssertEqual(queue.map(\.id), ["b", "a"])
    }

    func testInsertDeDupesByAchievementID() {
        let queue = AchievementUnlockedQueue.inserting(event("a"), into: [event("a")])
        XCTAssertEqual(queue.map(\.id), ["a"])
    }

    func testInsertBoundsAtMaxRecent() {
        var queue: [AchievementUnlockedEventData] = []
        for index in 0 ..< (AchievementUnlockedQueue.maxRecent + 10) {
            queue = AchievementUnlockedQueue.inserting(event("id-\(index)"), into: queue)
        }
        XCTAssertEqual(queue.count, AchievementUnlockedQueue.maxRecent)
        // Newest-first: the most recent insert is at the head.
        XCTAssertEqual(queue.first?.id, "id-\(AchievementUnlockedQueue.maxRecent + 9)")
    }

    func testRemovingDropsOnlyTheMatchingID() {
        let queue = AchievementUnlockedQueue.removing(id: "a", from: [event("a"), event("b")])
        XCTAssertEqual(queue.map(\.id), ["b"])
    }

    func testNormalizePreservesOrderDeDupesAndBounds() {
        let dupes = [event("a"), event("a"), event("b")]
        XCTAssertEqual(AchievementUnlockedQueue.normalize(dupes).map(\.id), ["a", "b"])

        let many = (0 ..< 40).map { event("n-\($0)") }
        XCTAssertEqual(AchievementUnlockedQueue.normalize(many).count, AchievementUnlockedQueue.maxRecent)
    }
}

// MARK: - Deep link (web `navigate('/lifetime?achievement=…')`)

final class AchievementUnlockedDeepLinkTests: XCTestCase {
    func testPathLeavesUnreservedIDUntouched() {
        XCTAssertEqual(
            AchievementUnlockedDeepLink.path(achievementID: "road-warrior"),
            "/lifetime?achievement=road-warrior"
        )
    }

    func testPathPercentEncodesReservedCharacters() {
        XCTAssertEqual(
            AchievementUnlockedDeepLink.path(achievementID: "night owl"),
            "/lifetime?achievement=night%20owl"
        )
        XCTAssertEqual(
            AchievementUnlockedDeepLink.path(achievementID: "a/b&c"),
            "/lifetime?achievement=a%2Fb%26c"
        )
    }
}

// MARK: - Lifetime (web `durationMs`)

final class AchievementUnlockedLifetimeTests: XCTestCase {
    func testDefaultMatchesWebSixSeconds() {
        XCTAssertEqual(AchievementUnlockedLifetime.defaultSeconds, 6.0, accuracy: 0.0001)
    }

    func testSecondsConvertsMillisecondsAndClamps() {
        XCTAssertEqual(AchievementUnlockedLifetime.seconds(durationMs: 6000), 6.0, accuracy: 0.0001)
        XCTAssertEqual(AchievementUnlockedLifetime.seconds(durationMs: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(AchievementUnlockedLifetime.seconds(durationMs: -100), 0, accuracy: 0.0001)
    }
}

// MARK: - Confetti (web `buildConfettiParticles`)

final class AchievementConfettiTests: XCTestCase {
    func testCountMatchesWeb() {
        XCTAssertEqual(AchievementConfetti.count, 24)
        XCTAssertEqual(AchievementConfetti.particles(reduceMotion: false).count, 24)
    }

    func testReduceMotionSuppressesTheBurst() {
        XCTAssertTrue(AchievementConfetti.particles(reduceMotion: true).isEmpty)
    }

    func testParticleComponentsStayWithinWebRanges() {
        for particle in AchievementConfetti.particles(reduceMotion: false) {
            XCTAssertGreaterThanOrEqual(particle.velocityX, -140)
            XCTAssertLessThanOrEqual(particle.velocityX, 140)
            XCTAssertGreaterThanOrEqual(particle.velocityY, -220)
            XCTAssertLessThanOrEqual(particle.velocityY, -60)
            XCTAssertGreaterThanOrEqual(particle.rotation, -360)
            XCTAssertLessThanOrEqual(particle.rotation, 360)
            XCTAssertGreaterThanOrEqual(particle.delaySeconds, 0)
            XCTAssertLessThan(particle.delaySeconds, 0.25)
        }
    }

    func testSameSeedIsDeterministic() {
        let lhs = AchievementConfetti.particles(reduceMotion: false, seed: 42)
        let rhs = AchievementConfetti.particles(reduceMotion: false, seed: 42)
        XCTAssertEqual(lhs, rhs)
    }

    func testDifferentSeedsProduceADifferentSpread() {
        let lhs = AchievementConfetti.particles(reduceMotion: false, seed: 1)
        let rhs = AchievementConfetti.particles(reduceMotion: false, seed: 2)
        XCTAssertNotEqual(lhs, rhs)
    }

    func testSeedIsStablePerIDAndDistinctAcrossIDs() {
        XCTAssertEqual(AchievementConfetti.seed(for: "road-warrior"), AchievementConfetti.seed(for: "road-warrior"))
        XCTAssertNotEqual(AchievementConfetti.seed(for: "road-warrior"), AchievementConfetti.seed(for: "night-owl"))
    }
}

// MARK: - Accessibility

final class AchievementUnlockedAccessibilityTests: XCTestCase {
    func testLabelReadsEyebrowNameThenDetail() {
        let label = AchievementUnlockedAccessibility.toastLabel(
            eyebrow: "Achievement Unlocked",
            name: "Road Warrior",
            detail: "Drove more than 10,000 km."
        )
        XCTAssertEqual(label, "Achievement Unlocked: Road Warrior. Drove more than 10,000 km.")
    }

    func testLabelSkipsEmptyDetailWithoutDoublingPunctuation() {
        let label = AchievementUnlockedAccessibility.toastLabel(
            eyebrow: "Achievement Unlocked",
            name: "Night Owl",
            detail: ""
        )
        XCTAssertEqual(label, "Achievement Unlocked: Night Owl")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AchievementUnlockedProjectionTests: XCTestCase {
    func testLoadingWithNoEventsIsLoading() {
        let resolved = AchievementUnlockedProjection.resolve(status: .loading, events: [], connection: .live)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.events.isEmpty)
    }

    func testLoadingWithCachedEventsShowsData() {
        let resolved = AchievementUnlockedProjection.resolve(
            status: .loading, events: [event("a")], connection: .live
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.events.map(\.id), ["a"])
    }

    func testEmptyStatusIsEmptyWhenNoEvents() {
        let resolved = AchievementUnlockedProjection.resolve(status: .empty, events: [], connection: .live)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLoadedWithNoEventsIsEmpty() {
        let resolved = AchievementUnlockedProjection.resolve(status: .loaded, events: [], connection: .live)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLoadedWithEventsIsData() {
        let resolved = AchievementUnlockedProjection.resolve(
            status: .loaded, events: [event("a"), event("b")], connection: .live
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.events.map(\.id), ["a", "b"])
    }

    func testFailedWithNoEventsIsError() {
        let resolved = AchievementUnlockedProjection.resolve(
            status: .failed("boom"), events: [], connection: .live
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testFailedWithCachedEventsKeepsShowingData() {
        let resolved = AchievementUnlockedProjection.resolve(
            status: .failed("boom"), events: [event("a")], connection: .offline
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.events.map(\.id), ["a"])
    }

    func testProjectionNormalisesDuplicateEvents() {
        let resolved = AchievementUnlockedProjection.resolve(
            status: .loaded, events: [event("a"), event("a")], connection: .live
        )
        XCTAssertEqual(resolved.events.map(\.id), ["a"])
    }
}

// MARK: - Model (state holder + dismiss + auto-refresh)

private final class SpyAchievementUnlockedTelemetry: AchievementUnlockedTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
private final class ViewRecorder {
    private(set) var viewed: [String] = []
    func record(_ event: AchievementUnlockedEventData) {
        viewed.append(event.id)
    }
}

@MainActor
final class AchievementUnlockedToastModelTests: XCTestCase {
    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryAchievementUnlockedSource(initial: AchievementUnlockedUpdate(status: .empty))
        let telemetry = SpyAchievementUnlockedTelemetry()
        let model = AchievementUnlockedToastModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["AchievementUnlockedToast"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseAndConnection() {
        let source = InMemoryAchievementUnlockedSource()
        let model = AchievementUnlockedToastModel(source: source)
        model.start()

        source.push(AchievementUnlockedUpdate(status: .loaded, events: [event("a")]))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.events.map(\.id), ["a"])
        XCTAssertEqual(model.connection, .live)
    }

    func testDismissRemovesToastAndNotifiesSource() {
        let source = InMemoryAchievementUnlockedSource(initial: AchievementUnlockedUpdate(
            status: .loaded, events: [event("a"), event("b")]
        ))
        let model = AchievementUnlockedToastModel(source: source)
        model.start()

        model.dismiss(id: "a")
        XCTAssertEqual(model.events.map(\.id), ["b"])
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.dismissedIDs, ["a"])

        model.dismiss(id: "b")
        XCTAssertTrue(model.events.isEmpty)
        XCTAssertEqual(model.phase, .empty)
    }

    func testViewDismissesAndInvokesHandler() {
        let source = InMemoryAchievementUnlockedSource(initial: AchievementUnlockedUpdate(
            status: .loaded, events: [event("a")]
        ))
        let recorder = ViewRecorder()
        let model = AchievementUnlockedToastModel(source: source, onView: { recorder.record($0) })
        model.start()

        model.view(event("a"))
        XCTAssertEqual(recorder.viewed, ["a"])
        XCTAssertTrue(model.events.isEmpty)
        XCTAssertEqual(source.dismissedIDs, ["a"])
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryAchievementUnlockedSource()
        let model = AchievementUnlockedToastModel(source: source)
        model.start()

        source.push(AchievementUnlockedUpdate(status: .loaded, connection: .stale, events: [event("a")]))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(AchievementUnlockedUpdate(status: .loaded, connection: .stale, events: [event("a")]))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testAutoRefreshIfStaleGuardsOnConnectionAndFetching() {
        let source = InMemoryAchievementUnlockedSource()
        let model = AchievementUnlockedToastModel(source: source)
        model.start()

        // Live → no refresh.
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)

        // Stale + already fetching → no refresh (the transition push below also must not fire it).
        source.push(AchievementUnlockedUpdate(
            status: .loaded, connection: .offline, isFetching: true, events: [event("a")]
        ))
        let baseline = source.refreshCount
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, baseline)
    }

    func testStopStopsSource() {
        let source = InMemoryAchievementUnlockedSource()
        let model = AchievementUnlockedToastModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
