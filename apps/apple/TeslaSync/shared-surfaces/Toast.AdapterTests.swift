//
//  Toast.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the per-kind presentation
//  (the verbatim port of the web `icons` / `styles` / `ariaRole` maps), the auto-dismiss arithmetic (web
//  `opts.duration ?? 4000` + the `duration > 0` guard), the bounded-queue reducer (web
//  `[...prev.slice(-4), toast]`), the action discrimination (web `to` wins over `onClick`), and the
//  VoiceOver label builder. Split from Toast.Tests.swift (the SwiftUI / store half) to keep each file
//  within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ToastSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ToastSurface.slug, "Toast")
    }
}

// MARK: - Presentation (web `icons` / `styles` / `ariaRole`)

final class ToastPresentationTests: XCTestCase {
    func testIconSystemNamePerKind() {
        XCTAssertEqual(ToastPresentation.iconSystemName(for: .success), "checkmark.circle.fill")
        XCTAssertEqual(ToastPresentation.iconSystemName(for: .error), "exclamationmark.circle.fill")
        XCTAssertEqual(ToastPresentation.iconSystemName(for: .info), "info.circle.fill")
        XCTAssertEqual(ToastPresentation.iconSystemName(for: .warning), "exclamationmark.triangle.fill")
    }

    func testTintPerKind() {
        XCTAssertEqual(ToastPresentation.tint(for: .success), .success)
        XCTAssertEqual(ToastPresentation.tint(for: .error), .danger)
        XCTAssertEqual(ToastPresentation.tint(for: .info), .info)
        XCTAssertEqual(ToastPresentation.tint(for: .warning), .warning)
    }

    func testErrorAnnouncesAssertivelyAndRestPolitely() {
        // Web ariaRole: error -> "alert" (assertive); success/info/warning -> "status" (polite).
        XCTAssertEqual(ToastPresentation.role(for: .error), .alert)
        XCTAssertTrue(ToastPresentation.isAssertive(for: .error))
        for kind in [ToastKind.success, .info, .warning] {
            XCTAssertEqual(ToastPresentation.role(for: kind), .status)
            XCTAssertFalse(ToastPresentation.isAssertive(for: kind))
        }
    }

    func testRoleAssertivenessFlag() {
        XCTAssertTrue(ToastRole.alert.isAssertive)
        XCTAssertFalse(ToastRole.status.isAssertive)
    }
}

// MARK: - Duration (web `opts.duration ?? 4000` + `duration > 0`)

final class ToastDurationTests: XCTestCase {
    func testDefaultIsFourSeconds() {
        XCTAssertEqual(ToastDuration.defaultMilliseconds, 4000)
        XCTAssertEqual(ToastDuration.resolve(nil), 4000)
    }

    func testResolveKeepsExplicitDuration() {
        XCTAssertEqual(ToastDuration.resolve(1500), 1500)
        XCTAssertEqual(ToastDuration.resolve(0), 0)
    }

    func testAutoDismissGuard() {
        XCTAssertTrue(ToastDuration.isAutoDismissing(4000))
        XCTAssertTrue(ToastDuration.isAutoDismissing(1))
        XCTAssertFalse(ToastDuration.isAutoDismissing(0))
        XCTAssertFalse(ToastDuration.isAutoDismissing(-10))
    }

    func testSecondsConversionClampsAtZero() {
        XCTAssertEqual(ToastDuration.seconds(4000), 4.0, accuracy: 0.0001)
        XCTAssertEqual(ToastDuration.seconds(0), 0, accuracy: 0.0001)
        XCTAssertEqual(ToastDuration.seconds(-500), 0, accuracy: 0.0001)
    }
}

// MARK: - Queue (web `[...prev.slice(-4), toast]`)

final class ToastQueueTests: XCTestCase {
    private func descriptor(_ id: String) -> ToastDescriptor {
        ToastDescriptor(id: id, kind: .info, title: id)
    }

    func testAppendKeepsOrderUnderCapacity() {
        var items: [ToastDescriptor] = []
        items = ToastQueue.appending(descriptor("a"), to: items)
        items = ToastQueue.appending(descriptor("b"), to: items)
        XCTAssertEqual(items.map(\.id), ["a", "b"])
    }

    func testAppendCapsToFiveNewest() {
        // Web `[...prev.slice(-4), toast]`: posting 7 keeps the five newest, oldest-first.
        var items: [ToastDescriptor] = []
        for index in 1 ... 7 {
            items = ToastQueue.appending(descriptor("t\(index)"), to: items)
        }
        XCTAssertEqual(items.count, ToastQueue.capacity)
        XCTAssertEqual(items.map(\.id), ["t3", "t4", "t5", "t6", "t7"])
    }

    func testRemovingFiltersById() {
        let items = [descriptor("a"), descriptor("b"), descriptor("c")]
        XCTAssertEqual(ToastQueue.removing(id: "b", from: items).map(\.id), ["a", "c"])
    }

    func testRemovingMissingIdIsNoOp() {
        let items = [descriptor("a")]
        XCTAssertEqual(ToastQueue.removing(id: "zzz", from: items).map(\.id), ["a"])
    }
}

// MARK: - Action discrimination (web `to` wins over `onClick`)

final class ToastActionTests: XCTestCase {
    func testNavigationStyle() {
        let action = ToastAction.navigate("View", to: "/charging")
        XCTAssertEqual(action.resolvedStyle, .navigation)
        XCTAssertEqual(action.navigationPath, "/charging")
    }

    func testCallbackStyle() {
        let action = ToastAction.callback("Undo", perform: {})
        XCTAssertEqual(action.resolvedStyle, .callback)
        XCTAssertNil(action.navigationPath)
    }

    func testNavigationWinsWhenBothSupplied() {
        // Web comment: "if both are present the navigation form wins".
        let action = ToastAction(label: "Both", navigationPath: "/x", perform: {})
        XCTAssertEqual(action.resolvedStyle, .navigation)
    }

    func testNoActionWhenNeitherSupplied() {
        XCTAssertNil(ToastAction(label: "Bare").resolvedStyle)
    }
}

// MARK: - Descriptor projection + equality

final class ToastDescriptorTests: XCTestCase {
    func testItemProjectsToDescriptor() {
        let item = ToastItem(
            id: "1",
            kind: .warning,
            title: "Battery low",
            message: "12% remaining",
            durationMilliseconds: 6000,
            action: .navigate("View", to: "/battery")
        )
        let descriptor = item.descriptor
        XCTAssertEqual(descriptor.id, "1")
        XCTAssertEqual(descriptor.kind, .warning)
        XCTAssertEqual(descriptor.title, "Battery low")
        XCTAssertEqual(descriptor.message, "12% remaining")
        XCTAssertEqual(descriptor.durationMilliseconds, 6000)
        XCTAssertEqual(descriptor.actionLabel, "View")
        XCTAssertEqual(descriptor.actionStyle, .navigation)
    }

    func testEquality() {
        let lhs = ToastDescriptor(id: "1", kind: .info, title: "T", message: "M")
        let rhs = ToastDescriptor(id: "1", kind: .info, title: "T", message: "M")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, ToastDescriptor(id: "1", kind: .error, title: "T", message: "M"))
    }
}

// MARK: - Accessibility label (web role announcement)

final class ToastAccessibilityTests: XCTestCase {
    func testLabelJoinsSeverityTitleAndMessage() {
        let label = ToastAccessibility.label(
            severity: "Error",
            title: "Couldn't save",
            message: "HTTP 500"
        )
        XCTAssertEqual(label, "Error: Couldn't save. HTTP 500")
    }

    func testLabelWithoutMessage() {
        let label = ToastAccessibility.label(severity: "Success", title: "Saved", message: nil)
        XCTAssertEqual(label, "Success: Saved")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = ToastAccessibility.label(
            severity: "Information",
            title: "Done!",
            message: "All set"
        )
        XCTAssertEqual(label, "Information: Done! All set")
    }

    func testLabelSkipsEmptyMessage() {
        let label = ToastAccessibility.label(severity: "Warning", title: "Heads up", message: "")
        XCTAssertEqual(label, "Warning: Heads up")
    }
}
