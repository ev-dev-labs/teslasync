//
//  ContextMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + value types
//  live in ContextMenu.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • ContextMenuController — the once-only `view.opened`, the empty-open guard (web early-return), the
//      open / re-open nonce, close, the routed invocation (disabled is a no-op that keeps the menu open;
//      an enabled row closes first then runs its handler — web `invoke`), the unknown-id guard, and the
//      keyboard traversal (container -> first / last, wrap, Home / End, invoke-focused).
//    • Views — the public host + the subviews compose in every branch (populated / highlighted / empty /
//      overlay / injected controller).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ContextMenuController (state + routing + keyboard)

@MainActor
final class ContextMenuControllerTests: XCTestCase {
    private func actions(_ recorder: InvocationRecorder? = nil) -> [ContextMenuAction] {
        [
            ContextMenuAction(id: "copy", label: "Copy", systemImage: "doc.on.doc") {
                recorder?.record("copy")
            },
            ContextMenuAction(id: "favorite", label: "Favorite", isDisabled: true) {
                recorder?.record("favorite")
            },
            ContextMenuAction(id: "delete", label: "Delete", isDestructive: true) {
                recorder?.record("delete")
            }
        ]
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let controller = ContextMenuController(telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [ContextMenuSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let controller = ContextMenuController(telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [ContextMenuSurface.slug], "view.opened fires once per instance")
    }

    func testOpenWithEmptyActionsIsRefused() {
        let controller = ContextMenuController()
        controller.open([], at: .zero)
        XCTAssertFalse(controller.isOpen)
        XCTAssertNil(controller.presentation)
    }

    func testOpenSetsPresentationAndBumpsNonce() {
        let controller = ContextMenuController()
        controller.open(actions(), at: CGPoint(x: 12, y: 34))
        XCTAssertTrue(controller.isOpen)
        XCTAssertEqual(controller.presentation?.anchor, CGPoint(x: 12, y: 34))
        XCTAssertEqual(controller.descriptors.count, 3)
        let firstNonce = controller.presentation?.nonce
        controller.open(actions(), at: CGPoint(x: 12, y: 34))
        XCTAssertNotEqual(controller.presentation?.nonce, firstNonce, "re-open bumps the nonce")
    }

    func testCloseClearsPresentationAndIsIdempotent() {
        let controller = ContextMenuController()
        controller.open(actions(), at: .zero)
        controller.close()
        XCTAssertFalse(controller.isOpen)
        controller.close()
        XCTAssertFalse(controller.isOpen)
    }

    func testFocusStartsOnContainer() {
        let controller = ContextMenuController()
        controller.open(actions(), at: .zero)
        XCTAssertNil(controller.focusedActionID, "the container holds focus until the first Arrow key")
    }

    func testKeyboardTraversalSkipsDisabledAndWraps() {
        let controller = ContextMenuController()
        controller.open(actions(), at: .zero)
        controller.moveFocus(step: 1)
        XCTAssertEqual(controller.focusedActionID, "copy")
        controller.moveFocus(step: 1)
        XCTAssertEqual(controller.focusedActionID, "delete", "favorite is disabled and skipped")
        controller.moveFocus(step: 1)
        XCTAssertEqual(controller.focusedActionID, "copy", "wraps back to the first enabled row")
    }

    func testHomeAndEndJumpToFirstAndLastEnabled() {
        let controller = ContextMenuController()
        controller.open(actions(), at: .zero)
        controller.focusLast()
        XCTAssertEqual(controller.focusedActionID, "delete")
        controller.focusFirst()
        XCTAssertEqual(controller.focusedActionID, "copy")
    }

    func testInvokeRunsHandlerAndCloses() async {
        let recorder = InvocationRecorder()
        let expectation = expectation(description: "handler ran")
        recorder.onRecord = { expectation.fulfill() }
        let controller = ContextMenuController()
        controller.open(actions(recorder), at: .zero)
        controller.invoke(id: "copy")
        await fulfillment(of: [expectation], timeout: 1)
        XCTAssertEqual(recorder.ids, ["copy"])
        XCTAssertFalse(controller.isOpen, "the menu closes before the handler runs")
    }

    func testInvokeDisabledRowIsNoOpAndKeepsMenuOpen() async {
        let recorder = InvocationRecorder()
        let controller = ContextMenuController()
        controller.open(actions(recorder), at: .zero)
        controller.invoke(id: "favorite")
        await Task.yield()
        XCTAssertTrue(recorder.ids.isEmpty, "a disabled row never runs its handler")
        XCTAssertTrue(controller.isOpen, "a disabled invocation leaves the menu open")
    }

    func testInvokeUnknownIDIsNoOp() async {
        let recorder = InvocationRecorder()
        let controller = ContextMenuController()
        controller.open(actions(recorder), at: .zero)
        controller.invoke(id: "missing")
        await Task.yield()
        XCTAssertTrue(recorder.ids.isEmpty)
        XCTAssertTrue(controller.isOpen)
    }

    func testInvokeFocusedRunsHighlightedRow() async {
        let recorder = InvocationRecorder()
        let expectation = expectation(description: "handler ran")
        recorder.onRecord = { expectation.fulfill() }
        let controller = ContextMenuController()
        controller.open(actions(recorder), at: .zero)
        controller.focusLast()
        controller.invokeFocused()
        await fulfillment(of: [expectation], timeout: 1)
        XCTAssertEqual(recorder.ids, ["delete"])
    }

    func testInvokeFocusedNoOpWhenContainerHoldsFocus() async {
        let recorder = InvocationRecorder()
        let controller = ContextMenuController()
        controller.open(actions(recorder), at: .zero)
        controller.invokeFocused()
        await Task.yield()
        XCTAssertTrue(recorder.ids.isEmpty)
        XCTAssertTrue(controller.isOpen)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class ContextMenuViewTests: XCTestCase {
    func testSurfaceAndOverlayCompose() {
        let controller = ContextMenuController()
        _ = ContextMenu(controller: controller) { Text(verbatim: "content") }
        _ = ContextMenuOverlay(controller: controller, reduceMotion: false)
        XCTAssertEqual(ContextMenu<Text>.surfaceSlug, "ContextMenu")
    }

    func testPanelComposesForPopulatedAndEmpty() {
        let populated = ContextMenuController()
        populated.open([ContextMenuAction(id: "a", label: "A") {}], at: .zero)
        _ = ContextMenuPanel(controller: populated, reduceMotion: false)
        _ = ContextMenuPanel(controller: ContextMenuController(), reduceMotion: true)
    }

    func testSubviewsCompose() {
        let descriptor = ContextMenuItemDescriptor(
            id: "delete",
            label: "Delete",
            systemImage: "trash",
            isDestructive: true,
            shortcut: "⌘⌫"
        )
        _ = ContextMenuRowView(descriptor: descriptor, isHighlighted: true) {}
        _ = ContextMenuRowView(
            descriptor: ContextMenuItemDescriptor(id: "x", label: "X", isDisabled: true),
            isHighlighted: false
        ) {}
        _ = ContextMenuEmptyView()
    }
}

// MARK: - Strings facade (P1/S10)

final class ContextMenuStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(ContextMenuStrings.menuLabel, "Context menu")
        XCTAssertEqual(ContextMenuStrings.empty, "No actions")
        XCTAssertEqual(ContextMenuStrings.dismiss, "Dismiss menu")
        XCTAssertEqual(ContextMenuStrings.destructive, "Destructive")
        XCTAssertEqual(ContextMenuStrings.unavailable, "Unavailable")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: ContextMenuTelemetry, @unchecked Sendable {
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

/// Records the ids routed through invoked action handlers (the `@MainActor` `perform` closures).
@MainActor
private final class InvocationRecorder {
    private(set) var ids: [String] = []
    var onRecord: (() -> Void)?

    func record(_ id: String) {
        ids.append(id)
        onRecord?()
    }
}
