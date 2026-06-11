//
//  AchievementUnlockListener.ModelTests.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  State-holder coverage for `AchievementUnlockListenerModel`:
//    • start idempotence + the once-only `view.opened` telemetry (emitted even while loading).
//    • the unlock chime — fires once per queue growth while `playSound` is on, never on a
//      connection-only re-emit, never on a dismiss-driven decrease, re-fires on a fresh increase.
//    • the per-toast auto-dismiss — armed only while toasts are visible, expires a toast after the
//      configured lifetime, disarms when the stack empties.
//    • the stale rising-edge one-shot auto-refresh (suppressed while offline, re-armed after leaving
//      stale).
//    • View navigation + dismiss delegation, stop/start wiring, and the exposed connection / config.
//
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no real store, a manual ticker.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: AchievementUnlockListenerResolve = { _, fallback in fallback }

private func event(id: String) -> AchievementUnlockListenerEvent {
    AchievementUnlockListenerEvent(
        vehicleID: 1,
        unlockedAt: nil,
        achievement: AchievementUnlockListenerAchievement(id: id, name: "Name", detail: "Detail", icon: "🏆")
    )
}

private func resolved(
    _ ids: [String],
    playSound: Bool = false,
    connection: AchievementUnlockListenerConnection = .live
) -> AchievementUnlockListenerInput {
    AchievementUnlockListenerInput(
        status: .resolved,
        events: ids.map { event(id: $0) },
        prefs: AchievementUnlockListenerPrefs(showToasts: true, playSound: playSound),
        connection: connection
    )
}

// MARK: - Test doubles

private final class SpyAchievementUnlockListenerTelemetry: AchievementUnlockListenerTelemetry, @unchecked Sendable {
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

private final class SpyAchievementUnlockListenerChime: AchievementUnlockListenerChime, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var playCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func play(_: AchievementUnlockListenerChimeSpec) {
        lock.lock()
        count += 1
        lock.unlock()
    }
}

@MainActor
private final class RouteRecorder {
    var routes: [String] = []
}

@MainActor
private struct Harness {
    let model: AchievementUnlockListenerModel
    let source: InMemoryAchievementUnlockListenerSource
    let ticker: ManualAchievementUnlockListenerTicker
    let chime: SpyAchievementUnlockListenerChime
    let telemetry: SpyAchievementUnlockListenerTelemetry
    let recorder: RouteRecorder
}

@MainActor
private func makeHarness(
    _ input: AchievementUnlockListenerInput,
    config: AchievementUnlockListenerConfig = .default
) -> Harness {
    let source = InMemoryAchievementUnlockListenerSource(initial: input)
    let ticker = ManualAchievementUnlockListenerTicker()
    let chime = SpyAchievementUnlockListenerChime()
    let telemetry = SpyAchievementUnlockListenerTelemetry()
    let recorder = RouteRecorder()
    let model = AchievementUnlockListenerModel(
        source: source,
        config: config,
        ticker: ticker,
        chime: chime,
        telemetry: telemetry,
        onView: { recorder.routes.append($0) },
        strings: resolveFallback
    )
    return Harness(
        model: model,
        source: source,
        ticker: ticker,
        chime: chime,
        telemetry: telemetry,
        recorder: recorder
    )
}

// MARK: - Lifecycle + telemetry

@MainActor
final class AchievementUnlockListenerModelLifecycleTests: XCTestCase {
    func testStartIsIdempotent() {
        let env = makeHarness(resolved(["a"]))
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStartEmitsTelemetryOnceEvenWhileLoading() {
        let env = makeHarness(AchievementUnlockListenerInput(status: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
        XCTAssertEqual(env.telemetry.surfaces, [AchievementUnlockListenerMeta.surfaceSlug])
        env.model.start()
        XCTAssertEqual(env.telemetry.surfaces, [AchievementUnlockListenerMeta.surfaceSlug])
    }

    func testStopHaltsTickerAndSource() {
        let env = makeHarness(resolved(["a"]))
        env.model.start()
        env.model.stop()
        XCTAssertGreaterThanOrEqual(env.ticker.stopCount, 1)
        XCTAssertEqual(env.source.stopCount, 1)
    }

    func testConnectionAndConfigExposed() {
        let env = makeHarness(resolved(["a"], connection: .offline), config: .init(autoDismissSeconds: 9))
        env.model.start()
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertTrue(env.model.offline)
        XCTAssertEqual(env.model.config.autoDismissSeconds, 9)
    }
}

// MARK: - Unlock chime

@MainActor
final class AchievementUnlockListenerModelChimeTests: XCTestCase {
    func testChimesOnNewUnlockWhenSoundOn() {
        let env = makeHarness(resolved(["a"], playSound: true))
        env.model.start()
        XCTAssertEqual(env.chime.playCount, 1)
    }

    func testDoesNotChimeWhenSoundOff() {
        let env = makeHarness(resolved(["a"], playSound: false))
        env.model.start()
        XCTAssertEqual(env.chime.playCount, 0)
    }

    func testDoesNotChimeOnConnectionOnlyReEmit() {
        let env = makeHarness(resolved(["a"], playSound: true))
        env.model.start()
        XCTAssertEqual(env.chime.playCount, 1)
        env.source.push(resolved(["a"], playSound: true, connection: .stale))
        XCTAssertEqual(env.chime.playCount, 1)
    }

    func testChimesAgainOnFreshIncreaseNotOnDismissDecrease() {
        let env = makeHarness(resolved(["a", "b"], playSound: true))
        env.model.start()
        XCTAssertEqual(env.chime.playCount, 1)
        env.source.push(resolved(["a"], playSound: true))
        XCTAssertEqual(env.chime.playCount, 1)
        env.source.push(resolved(["a", "b"], playSound: true))
        XCTAssertEqual(env.chime.playCount, 2)
    }
}

// MARK: - Auto-dismiss

@MainActor
final class AchievementUnlockListenerModelAutoDismissTests: XCTestCase {
    func testToastExpiresAfterConfiguredLifetime() {
        let env = makeHarness(resolved(["a"]), config: .init(autoDismissSeconds: 2))
        env.model.start()
        XCTAssertEqual(env.ticker.startCount, 1)
        env.ticker.fire()
        XCTAssertTrue(env.model.phase.isReady)
        env.ticker.fire()
        XCTAssertEqual(env.source.dismissedIDs, ["a"])
        XCTAssertEqual(env.model.phase, .empty(.noUnlocks))
        XCTAssertGreaterThanOrEqual(env.ticker.stopCount, 1)
    }

    func testTickerNotArmedForChromePhases() {
        let loadingEnv = makeHarness(AchievementUnlockListenerInput(status: .loading))
        loadingEnv.model.start()
        XCTAssertEqual(loadingEnv.ticker.startCount, 0)

        let offEnv = makeHarness(AchievementUnlockListenerInput(
            status: .resolved,
            events: [event(id: "a")],
            prefs: AchievementUnlockListenerPrefs(showToasts: false, playSound: false)
        ))
        offEnv.model.start()
        XCTAssertEqual(offEnv.ticker.startCount, 0)
    }
}

// MARK: - Stale auto-refresh

@MainActor
final class AchievementUnlockListenerModelRefreshTests: XCTestCase {
    func testStaleRisingEdgeAutoRefreshesOncePerEdge() {
        let env = makeHarness(resolved(["a"]))
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)
        env.source.push(resolved(["a"], connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(resolved(["a"], connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(resolved(["a"], connection: .live))
        env.source.push(resolved(["a"], connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let env = makeHarness(resolved(["a"]))
        env.model.start()
        env.source.push(resolved(["a"], connection: .offline))
        XCTAssertEqual(env.source.refreshCount, 0)
        XCTAssertTrue(env.model.offline)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(resolved(["a"]))
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }
}

// MARK: - View + dismiss

@MainActor
final class AchievementUnlockListenerModelActionTests: XCTestCase {
    func testViewNavigatesAndDismisses() {
        let env = makeHarness(resolved(["a"]))
        env.model.start()
        env.model.view(eventID: "a")
        XCTAssertEqual(env.recorder.routes, ["/lifetime?achievement=a"])
        XCTAssertEqual(env.source.dismissedIDs, ["a"])
        XCTAssertEqual(env.model.phase, .empty(.noUnlocks))
    }

    func testDismissDelegatesToSource() {
        let env = makeHarness(resolved(["a", "b"]))
        env.model.start()
        env.model.dismiss(eventID: "a")
        XCTAssertEqual(env.source.dismissedIDs, ["a"])
    }
}

// MARK: - Phase convenience

private extension AchievementUnlockListenerResolved.Phase {
    var isReady: Bool {
        if case .ready = self { return true }
        return false
    }
}
