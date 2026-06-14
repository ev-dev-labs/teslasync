//
//  HelpSegment.Tests.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  The state-holder + decoupled-actions + view-composition + facade half of the coverage (the pure
//  projector + value types live in HelpSegment.AdapterTests.swift; split to keep each file within the
//  SwiftLint file-length budget):
//    • HelpSegmentModel — the once-only `view.opened` (idempotent across stop/start), the density-driven
//      projection through the injected resolver, and `perform(_:)` routing each action to its handler.
//    • HelpSegmentActions — the default handlers post the matching decoupled notifications (the native peer
//      of the web window events).
//    • Views — the public surface (both initializers, expanded + iconOnly) and the presentational leaves
//      compose in every density.
//    • Strings — the facade returns the English fallback for an unknown key.
//    • Accessibility — every affordance yields a non-empty VoiceOver label in every density.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let fallbackResolve: HelpSegmentResolve = { _, fallback in fallback }

// MARK: - Model (state-holder + telemetry + action routing)

@MainActor
final class HelpSegmentModelTests: XCTestCase {
    private func model(
        actions: HelpSegmentActions = HelpSegmentActions(),
        telemetry: HelpSegmentTelemetry = OSLogHelpSegmentTelemetry()
    ) -> HelpSegmentModel {
        HelpSegmentModel(resolve: fallbackResolve, actions: actions, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [HelpSegmentSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [HelpSegmentSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsDensity() {
        let holder = model()
        XCTAssertEqual(holder.projection(density: .iconOnly).actions.count, 3)

        let wideShortcuts = holder.projection(density: .full).actions.first
        XCTAssertEqual(wideShortcuts?.inlineLabel, "for shortcuts")
        XCTAssertEqual(wideShortcuts?.showsInlineLabel, true)
        XCTAssertEqual(wideShortcuts?.keyCap, "?")

        XCTAssertNil(holder.projection(density: .iconOnly).actions.first?.keyCap)
    }

    func testPerformRoutesEachActionToItsHandler() {
        let recorder = ActionRecorder()
        let holder = model(actions: recorder.actions)
        holder.perform(.shortcuts)
        holder.perform(.tour)
        holder.perform(.feedback)
        XCTAssertEqual(recorder.calls, [.shortcuts, .tour, .feedback])
    }
}

// MARK: - Default actions (decoupled notifications — web window events)

@MainActor
final class HelpSegmentActionsTests: XCTestCase {
    func testShortcutsHandlerPostsToggleNotification() {
        assertPosts(HelpSegmentActions.toggleShortcutsNotification) {
            HelpSegmentActions().perform(.shortcuts)
        }
    }

    func testTourHandlerPostsLauncherNotification() {
        assertPosts(HelpSegmentActions.openTourLauncherNotification) {
            HelpSegmentActions().perform(.tour)
        }
    }

    func testFeedbackHandlerPostsFeedbackNotification() {
        assertPosts(HelpSegmentActions.openFeedbackNotification) {
            HelpSegmentActions().perform(.feedback)
        }
    }

    private func assertPosts(_ name: Notification.Name, _ action: () -> Void) {
        let posted = expectation(forNotification: name, object: nil, notificationCenter: .default)
        action()
        wait(for: [posted], timeout: 1)
    }
}

// MARK: - Views (every form composes)

@MainActor
final class HelpSegmentViewTests: XCTestCase {
    func testSurfaceComposesForEveryInitializer() {
        _ = HelpSegment()
        _ = HelpSegment(iconOnly: true)
        _ = HelpSegment(iconOnly: false, model: HelpSegmentModel(resolve: fallbackResolve))
        XCTAssertEqual(HelpSegment.surfaceSlug, "HelpSegment")
    }

    func testLeavesComposeForEveryAffordance() {
        let holder = HelpSegmentModel(resolve: fallbackResolve)
        for descriptor in holder.projection(density: .full).actions {
            _ = HelpSegmentButton(projection: descriptor, model: holder)
        }
        _ = HelpSegmentKeyCap(text: HelpSegmentSurface.shortcutKeyCap)
    }
}

// MARK: - Strings facade (P1/S10)

final class HelpSegmentStringsTests: XCTestCase {
    func testResolveReturnsFallbackForUnknownKey() {
        XCTAssertEqual(
            HelpSegmentStrings.resolve("totally.unknown.key", "Fallback value"),
            "Fallback value"
        )
    }
}

// MARK: - Accessibility (every affordance has a VoiceOver label in every density)

final class HelpSegmentAccessibilityTests: XCTestCase {
    func testEveryActionHasNonEmptyLabelInEveryDensity() {
        for density in HelpSegmentDensity.allCases {
            let projection = HelpSegmentProjector.resolve(density: density, resolve: fallbackResolve)
            XCTAssertEqual(projection.actions.count, 3)
            for descriptor in projection.actions {
                XCTAssertFalse(
                    descriptor.accessibilityLabel.isEmpty,
                    "missing a11y label for \(descriptor.action) @ \(density)"
                )
            }
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: HelpSegmentTelemetry, @unchecked Sendable {
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

/// Records which action handlers fired, in order — backs the `perform(_:)` routing assertion.
@MainActor
private final class ActionRecorder {
    private(set) var calls: [HelpSegmentAction] = []

    lazy var actions = HelpSegmentActions(
        openShortcuts: { [weak self] in self?.calls.append(.shortcuts) },
        openTour: { [weak self] in self?.calls.append(.tour) },
        openFeedback: { [weak self] in self?.calls.append(.feedback) }
    )
}
