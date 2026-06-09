//
//  AddWidgetButton.Tests.swift
//  TeslaSync — P4 feature view · 0121 · AddWidgetButton (Apple)
//
//  Host-free unit coverage for the AddWidgetButton surface. AddWidgetButton is a
//  pure presentational FAB (the web source fetches nothing), so the meaningful,
//  render-free surface area is:
//    • the visibility branch — web `if (isEditing) return null` → `isVisible`,
//    • the layout constants the web `Button` className override encodes
//      (diameter / glyph size / insets / SF Symbol),
//    • the P1/S10 i18n facade (the `dashboard.addWidget` web fallback + the
//      native a11y hint),
//    • the accessibility phrasing (label backs aria-label + tooltip; hint),
//    • the P1/S11 `view.opened` telemetry slug.
//  No rendering / no KMP runtime required.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (folded in at integration
//  time, like every per-surface bundle).
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Presentation / visibility branch (web `if (isEditing) return null`)

@MainActor final class AddWidgetButtonPresentationTests: XCTestCase {
    func testVisibleWhenNotEditing() {
        XCTAssertTrue(AddWidgetButtonPresentation(isEditing: false).isVisible)
    }

    func testHiddenWhenEditing() {
        // web: the FAB returns null in edit mode (the header owns "Add Widget").
        XCTAssertFalse(AddWidgetButtonPresentation(isEditing: true).isVisible)
    }

    func testIsEquatable() {
        XCTAssertEqual(
            AddWidgetButtonPresentation(isEditing: false),
            AddWidgetButtonPresentation(isEditing: false)
        )
        XCTAssertNotEqual(
            AddWidgetButtonPresentation(isEditing: false),
            AddWidgetButtonPresentation(isEditing: true)
        )
    }

    func testLayoutConstantsMatchWebOverride() {
        // web `h-14 w-14` (56) circle · glyph ≈ 50% of the FAB · `right-6` (24).
        XCTAssertEqual(AddWidgetButtonPresentation.diameter, 56)
        XCTAssertEqual(AddWidgetButtonPresentation.iconPointSize, 28)
        XCTAssertEqual(AddWidgetButtonPresentation.trailingInset, TSSpacing.x2xl)
        XCTAssertEqual(AddWidgetButtonPresentation.bottomInset, TSSpacing.x2xl)
        XCTAssertEqual(AddWidgetButtonPresentation.iconSystemName, "plus")
        // glyph must stay smaller than the FAB it sits in.
        XCTAssertLessThan(
            AddWidgetButtonPresentation.iconPointSize,
            AddWidgetButtonPresentation.diameter
        )
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(AddWidgetButtonPresentation(isEditing: false).surfaceSlug, "AddWidgetButton")
        XCTAssertEqual(
            AddWidgetButtonPresentation(isEditing: false).surfaceSlug,
            AddWidgetButtonSurface.slug
        )
        XCTAssertEqual(AddWidgetButton.surfaceSlug, AddWidgetButtonSurface.slug)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

@MainActor final class AddWidgetButtonStringsTests: XCTestCase {
    func testResolvesWebFallbackForKnownKey() {
        XCTAssertEqual(
            AddWidgetButtonStrings.string("dashboard.addWidget", "Add Widget"),
            "Add Widget"
        )
    }

    func testReturnsFallbackForUnknownKey() {
        XCTAssertEqual(
            AddWidgetButtonStrings.string("dashboard.addWidget.missing", "fallback"),
            "fallback"
        )
    }

    func testTableIsSurfaceScoped() {
        XCTAssertEqual(AddWidgetButtonStrings.table, "AddWidgetButton")
    }
}

// MARK: - Accessibility phrasing (label backs aria-label + tooltip; hint)

@MainActor final class AddWidgetButtonAccessibilityTests: XCTestCase {
    func testLabelMatchesWebAddWidgetString() {
        XCTAssertEqual(AddWidgetButtonAccessibility.label, "Add Widget")
    }

    func testHintIsPresentAndDistinctFromLabel() {
        XCTAssertFalse(AddWidgetButtonAccessibility.hint.isEmpty)
        XCTAssertNotEqual(AddWidgetButtonAccessibility.hint, AddWidgetButtonAccessibility.label)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class AddWidgetButtonTelemetryTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyAddWidgetButtonTelemetry()
        AddWidgetButtonSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["AddWidgetButton"])
    }

    func testReportOpenEmitsTheExactSlugEachTime() {
        let spy = SpyAddWidgetButtonTelemetry()
        AddWidgetButtonSurface.reportOpen(to: spy)
        AddWidgetButtonSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["AddWidgetButton", "AddWidgetButton"])
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyAddWidgetButtonTelemetry: AddWidgetButtonTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
