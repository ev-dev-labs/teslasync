//
//  AchievementUnlockListener.Tests.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  Coverage for the AchievementUnlockListener surface above the pure adapter (see AdapterTests) and
//  the model (see ModelTests):
//    • Projection — every render phase (loading / unavailable / empty(noUnlocks) /
//      empty(celebrationsOff) / ready) including the derived toast fields (eyebrow, route, a11y label),
//      the offline decoration, and the `toasts` / `isPresentingToasts` conveniences.
//    • Live source — start / refresh emit the snapshot; ingest de-dupes + prepends; dismiss removes +
//      re-emits; update mutates the lifecycle.
//    • Views — every state's subview composes (signature contract) + the surface composes for every
//      input.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / source / view construction directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: AchievementUnlockListenerResolve = { _, fallback in fallback }

private func event(id: String) -> AchievementUnlockListenerEvent {
    AchievementUnlockListenerEvent(
        vehicleID: 1,
        unlockedAt: nil,
        achievement: AchievementUnlockListenerAchievement(
            id: id,
            name: "Road Warrior",
            detail: "Drove far.",
            icon: "🏎️"
        )
    )
}

private enum InputFixture {
    static let loading = AchievementUnlockListenerInput(status: .loading)
    static let failed = AchievementUnlockListenerInput(status: .failed)
    static let empty = AchievementUnlockListenerInput(status: .resolved)
    static let off = AchievementUnlockListenerInput(
        status: .resolved,
        events: [event(id: "a")],
        prefs: AchievementUnlockListenerPrefs(showToasts: false, playSound: false)
    )
    static let single = AchievementUnlockListenerInput(status: .resolved, events: [event(id: "a")])
    static let offline = AchievementUnlockListenerInput(
        status: .resolved,
        events: [event(id: "a")],
        connection: .offline
    )
}

// MARK: - Projection (render phases + leaf contract)

final class AchievementUnlockListenerProjectionTests: XCTestCase {
    private func resolve(_ input: AchievementUnlockListenerInput) -> AchievementUnlockListenerResolved {
        AchievementUnlockListenerProjection.resolve(input, strings: resolveFallback)
    }

    func testLoadingPhase() {
        XCTAssertEqual(resolve(InputFixture.loading).phase, .loading)
    }

    func testFailedPhaseIsUnavailable() {
        XCTAssertEqual(resolve(InputFixture.failed).phase, .unavailable)
    }

    func testResolvedEmptyQueueIsNoUnlocks() {
        XCTAssertEqual(resolve(InputFixture.empty).phase, .empty(.noUnlocks))
    }

    func testToastsOffWinsOverQueuedUnlocks() {
        // Web `if (!prefs.showToasts) return null` precedes the queue, so it wins even with events.
        XCTAssertEqual(resolve(InputFixture.off).phase, .empty(.celebrationsOff))
    }

    func testResolvedWithEventsDerivesToast() {
        let resolved = resolve(InputFixture.single)
        XCTAssertTrue(resolved.isPresentingToasts)
        guard let toast = resolved.toasts.first else { return XCTFail("expected a toast") }
        XCTAssertEqual(toast.id, "a")
        XCTAssertEqual(toast.icon, "🏎️")
        XCTAssertEqual(toast.eyebrow, "Achievement Unlocked")
        XCTAssertEqual(toast.name, "Road Warrior")
        XCTAssertEqual(toast.detail, "Drove far.")
        XCTAssertEqual(toast.viewLabel, "View")
        XCTAssertEqual(toast.dismissLabel, "Dismiss achievement notification")
        XCTAssertEqual(toast.route, "/lifetime?achievement=a")
        XCTAssertEqual(toast.accessibilityLabel, "Achievement Unlocked. Road Warrior. Drove far.")
    }

    func testOfflineDecorationCarried() {
        XCTAssertTrue(resolve(InputFixture.offline).offline)
        XCTAssertEqual(resolve(InputFixture.offline).connection, .offline)
        XCTAssertFalse(resolve(InputFixture.single).offline)
    }

    func testChromePhasesHaveNoToasts() {
        XCTAssertTrue(resolve(InputFixture.loading).toasts.isEmpty)
        XCTAssertFalse(resolve(InputFixture.loading).isPresentingToasts)
        XCTAssertTrue(resolve(InputFixture.failed).toasts.isEmpty)
        XCTAssertTrue(resolve(InputFixture.off).toasts.isEmpty)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveAchievementUnlockListenerSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheSnapshot() {
        let source = LiveAchievementUnlockListenerSource(status: .resolved, events: [event(id: "a")])
        var emissions: [[String]] = []
        source.onUpdate = { emissions.append($0.events.map(\.id)) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [["a"], ["a"]])
    }

    func testIngestDeDupesAndPrepends() {
        let source = LiveAchievementUnlockListenerSource(status: .resolved, events: [event(id: "a")])
        var latest: [String] = []
        source.onUpdate = { latest = $0.events.map(\.id) }
        source.ingest(event(id: "b"))
        XCTAssertEqual(latest, ["b", "a"])
        source.ingest(event(id: "b"))
        XCTAssertEqual(latest, ["b", "a"])
    }

    func testDismissRemovesAndReEmits() {
        let source = LiveAchievementUnlockListenerSource(
            status: .resolved,
            events: [event(id: "a"), event(id: "b")]
        )
        var latest: [String] = []
        source.onUpdate = { latest = $0.events.map(\.id) }
        source.dismiss(id: "a")
        XCTAssertEqual(latest, ["b"])
    }

    func testUpdateMutatesLifecycle() {
        let source = LiveAchievementUnlockListenerSource(status: .loading)
        var latest: AchievementUnlockListenerInput?
        source.onUpdate = { latest = $0 }
        source.update(status: .resolved, connection: .stale)
        XCTAssertEqual(latest?.status, .resolved)
        XCTAssertEqual(latest?.connection, .stale)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class AchievementUnlockListenerViewTests: XCTestCase {
    private func toast(_ input: AchievementUnlockListenerInput) -> AchievementUnlockListenerToast {
        guard let toast = AchievementUnlockListenerProjection.resolve(input, strings: resolveFallback)
            .toasts.first
        else {
            fatalError("expected a toast for fixture")
        }
        return toast
    }

    func testEveryStateSubviewComposes() {
        let row = toast(InputFixture.single)
        _ = AchievementUnlockListenerToastRow(toast: row, onView: {}, onDismiss: {})
        _ = AchievementUnlockListenerToastStack(toasts: [row], onView: { _ in }, onDismiss: { _ in })
        _ = AchievementUnlockListenerFreshnessChip(connection: .stale) {}
        _ = AchievementUnlockListenerFreshnessChip(connection: .offline) {}
        _ = AchievementUnlockListenerLoadingView()
        _ = AchievementUnlockListenerEmptyView(reason: .noUnlocks)
        _ = AchievementUnlockListenerEmptyView(reason: .celebrationsOff)
        _ = AchievementUnlockListenerUnavailableView {}
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [AchievementUnlockListenerInput] = [
            InputFixture.loading,
            InputFixture.failed,
            InputFixture.empty,
            InputFixture.off,
            InputFixture.single,
            InputFixture.offline,
            AchievementUnlockListenerInput(status: .resolved, events: [event(id: "a")], connection: .stale)
        ]
        for input in inputs {
            _ = AchievementUnlockListener(input: input)
        }
        _ = AchievementUnlockListener(input: InputFixture.single) { _ in }
    }
}
