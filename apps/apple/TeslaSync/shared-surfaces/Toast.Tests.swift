//
//  Toast.Tests.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The store + view-composition + facade half of the coverage (the pure projection + value types live in
//  Toast.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • ToastCenter — posting + the per-kind helpers, the unique incrementing ids (web
//      `toast-${++toastCounter}`), the five-newest cap (web `[...prev.slice(-4), toast]`), dismiss /
//      dismissAll, the deterministic auto-dismiss through ``ManualToastScheduler`` (web `setTimeout`), the
//      manual-dismiss timer cancellation, the evicted-toast timer cleanup, and the `useMutationToast`
//      bridge.
//    • Telemetry — the once-only `view.opened` across the start / stop churn.
//    • Views — the row + overlay + host compose in every real branch, and the per-kind VoiceOver label
//      resolves through the P1/S10 facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the clock is faked.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Telemetry spy

private final class SpyToastTelemetry: ToastTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

private struct SampleError: LocalizedError {
    let errorDescription: String?
}

@MainActor
private func makeCenter(
    telemetry: SpyToastTelemetry = SpyToastTelemetry(),
    scheduler: ManualToastScheduler = ManualToastScheduler()
) -> ToastCenter {
    ToastCenter(telemetry: telemetry, scheduler: scheduler)
}

// MARK: - Posting + per-kind helpers

@MainActor
final class ToastCenterPostTests: XCTestCase {
    func testHelpersPostMatchingKinds() {
        let center = makeCenter()
        center.success("Saved")
        center.error("Failed")
        center.info("Heads up")
        center.warning("Careful")
        XCTAssertEqual(center.items.map(\.kind), [.success, .error, .info, .warning])
    }

    func testPostAssignsUniqueIncrementingIds() {
        let center = makeCenter()
        let first = center.success("A")
        let second = center.success("B")
        XCTAssertEqual(first, "toast-1")
        XCTAssertEqual(second, "toast-2")
        XCTAssertNotEqual(first, second)
    }

    func testPostHonoursTitleMessageAndAction() {
        let center = makeCenter()
        center.post(
            kind: .info,
            title: "Charge complete",
            message: "Done",
            action: .navigate("View", to: "/charging")
        )
        let item = center.items.first
        XCTAssertEqual(item?.title, "Charge complete")
        XCTAssertEqual(item?.message, "Done")
        XCTAssertEqual(item?.action?.resolvedStyle, .navigation)
    }
}

// MARK: - Queue cap

@MainActor
final class ToastCenterQueueTests: XCTestCase {
    func testCapsToFiveNewest() {
        let center = makeCenter()
        for index in 1 ... 7 {
            center.info("t\(index)")
        }
        XCTAssertEqual(center.items.count, 5)
        XCTAssertEqual(center.items.map(\.title), ["t3", "t4", "t5", "t6", "t7"])
    }
}

// MARK: - Dismissal

@MainActor
final class ToastCenterDismissTests: XCTestCase {
    func testDismissRemovesById() {
        let center = makeCenter()
        let id = center.success("Saved")
        center.info("Other")
        center.dismiss(id: id)
        XCTAssertEqual(center.items.map(\.title), ["Other"])
    }

    func testDismissIsIdempotent() {
        let center = makeCenter()
        let id = center.success("Saved")
        center.dismiss(id: id)
        center.dismiss(id: id)
        XCTAssertTrue(center.items.isEmpty)
    }

    func testDismissAllClears() {
        let center = makeCenter()
        center.success("A")
        center.error("B")
        center.dismissAll()
        XCTAssertTrue(center.items.isEmpty)
    }
}

// MARK: - Auto-dismiss (web `setTimeout`, deterministic via ManualToastScheduler)

@MainActor
final class ToastCenterAutoDismissTests: XCTestCase {
    func testDefaultDurationSchedulesAndFires() {
        let scheduler = ManualToastScheduler()
        let center = makeCenter(scheduler: scheduler)
        center.success("Bye soon")
        XCTAssertEqual(scheduler.scheduledCount, 1)
        XCTAssertEqual(scheduler.pendingCount, 1)
        scheduler.fireAll()
        XCTAssertTrue(center.items.isEmpty)
    }

    func testZeroDurationDoesNotSchedule() {
        let scheduler = ManualToastScheduler()
        let center = makeCenter(scheduler: scheduler)
        center.post(kind: .info, title: "Sticky", durationMilliseconds: 0)
        XCTAssertEqual(scheduler.scheduledCount, 0)
        XCTAssertEqual(center.items.count, 1)
    }

    func testManualDismissCancelsPendingTimer() {
        let scheduler = ManualToastScheduler()
        let center = makeCenter(scheduler: scheduler)
        let id = center.success("Saved")
        XCTAssertEqual(scheduler.pendingCount, 1)
        center.dismiss(id: id)
        XCTAssertEqual(scheduler.pendingCount, 0)
    }

    func testEvictedToastTimerIsCancelled() {
        let scheduler = ManualToastScheduler()
        let center = makeCenter(scheduler: scheduler)
        for index in 1 ... 6 {
            center.info("t\(index)")
        }
        // Six scheduled, but the first toast was evicted by the five-cap so its timer was cancelled.
        XCTAssertEqual(scheduler.scheduledCount, 6)
        XCTAssertEqual(scheduler.pendingCount, 5)
    }
}

// MARK: - Mutation bridge (web `useMutationToast`)

@MainActor
final class ToastCenterMutationBridgeTests: XCTestCase {
    func testMutationSucceededPostsSuccessTitle() {
        let center = makeCenter()
        center.mutationSucceeded(key: "toast.foo.success", fallback: "Item deleted")
        XCTAssertEqual(center.items.first?.kind, .success)
        XCTAssertEqual(center.items.first?.title, "Item deleted")
    }

    func testMutationFailedUsesLocalizedErrorDetail() {
        let center = makeCenter()
        center.mutationFailed(SampleError(errorDescription: "HTTP 500"), fallback: "Failed to save")
        XCTAssertEqual(center.items.first?.kind, .error)
        XCTAssertEqual(center.items.first?.title, "Failed to save")
        XCTAssertEqual(center.items.first?.message, "HTTP 500")
    }

    func testMutationFailedDetailOverload() {
        let center = makeCenter()
        center.mutationFailed(detail: "offline", key: "toast.net.error", fallback: "Network error")
        XCTAssertEqual(center.items.first?.title, "Network error")
        XCTAssertEqual(center.items.first?.message, "offline")
    }
}

// MARK: - Telemetry (once-only view.opened)

@MainActor
final class ToastCenterTelemetryTests: XCTestCase {
    func testStartEmitsViewOpenedOnce() {
        let spy = SpyToastTelemetry()
        let center = makeCenter(telemetry: spy)
        center.start()
        center.start()
        XCTAssertEqual(spy.openedSurfaces, ["Toast"])
    }

    func testStopThenStartDoesNotReEmit() {
        let spy = SpyToastTelemetry()
        let center = makeCenter(telemetry: spy)
        center.start()
        center.stop()
        center.start()
        XCTAssertEqual(spy.openedSurfaces, ["Toast"])
    }
}

// MARK: - Views (per-kind a11y label + composition in every branch)

@MainActor
final class ToastViewCompositionTests: XCTestCase {
    func testRowAccessibilityLabelResolvesPerKind() {
        for kind in ToastKind.allCases {
            let item = ToastItem(id: kind.rawValue, kind: kind, title: "Title", message: "Body")
            let expected = ToastAccessibility.label(
                severity: ToastStrings.severity(kind),
                title: "Title",
                message: "Body"
            )
            XCTAssertFalse(expected.isEmpty)
            XCTAssertTrue(expected.contains("Title"))
            // The row builds for every kind (composition smoke — no crash constructing the view).
            _ = ToastRowView(item: item, onDismiss: {})
        }
    }

    func testRowComposesWithBothActionStyles() {
        let nav = ToastItem(
            id: "n",
            kind: .info,
            title: "Go",
            action: .navigate("View", to: "/x")
        )
        let cb = ToastItem(id: "c", kind: .success, title: "Undo", action: .callback("Undo", perform: {}))
        _ = ToastRowView(item: nav, onDismiss: {})
        _ = ToastRowView(item: cb, onDismiss: {})
        XCTAssertEqual(nav.action?.resolvedStyle, .navigation)
        XCTAssertEqual(cb.action?.resolvedStyle, .callback)
    }

    func testOverlayAndHostComposeForEmptyAndDataStates() {
        let empty = makeCenter()
        _ = ToastOverlay(center: empty)
        XCTAssertTrue(empty.items.isEmpty)

        let seeded = makeCenter()
        seeded.success("Saved")
        _ = ToastOverlay(center: seeded, onNavigate: { _ in })
        _ = ToastHost(center: seeded) { Color.clear }
        XCTAssertEqual(seeded.items.count, 1)
    }
}
