//
//  FrontendErrorsCard.AdapterTests.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  Adapter-level unit coverage: the integer formatter (port of numberFormat.ts `fmtInt` /
//  `safeNumber`), the name/route em-dash fallback (`value || '—'`), and the VoiceOver summaries.
//  Foundation-only; locale injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Integer formatting (web `fmtInt`)

@MainActor final class FrontendErrorsNumberTests: XCTestCase {
    func testIntegerGroupsWithNoFractionAndRoundsHalfUp() {
        XCTAssertEqual(FrontendErrorsNumber.integer(1234, locale: enUS), "1,234")
        XCTAssertEqual(FrontendErrorsNumber.integer(12345.6, locale: enUS), "12,346")
        XCTAssertEqual(FrontendErrorsNumber.integer(0, locale: enUS), "0")
    }

    func testIntegerCoercesNonFiniteToZero() {
        XCTAssertEqual(FrontendErrorsNumber.integer(.nan, locale: enUS), "0")
        XCTAssertEqual(FrontendErrorsNumber.integer(.infinity, locale: enUS), "0")
    }
}

// MARK: - Name / route fallback (web `value || '—'`)

@MainActor final class FrontendErrorsTextTests: XCTestCase {
    func testOrDashReturnsValueWhenPresent() {
        XCTAssertEqual(FrontendErrorsText.orDash("DriveChart"), "DriveChart")
        XCTAssertEqual(FrontendErrorsText.orDash("/drives/1"), "/drives/1")
    }

    func testOrDashFallsBackOnEmptyOrWhitespace() {
        XCTAssertEqual(FrontendErrorsText.orDash(""), "—")
        XCTAssertEqual(FrontendErrorsText.orDash("   "), "—")
        XCTAssertEqual(FrontendErrorsNumber.dash, "—")
    }
}

// MARK: - Accessibility summaries

@MainActor final class FrontendErrorsAccessibilityTests: XCTestCase {
    func testHeadlineJoinsTotalAndSubtitle() {
        XCTAssertEqual(
            FrontendErrorsAccessibility.headline("1,234", "reported by browser sessions"),
            "1,234 reported by browser sessions"
        )
    }

    func testOffenderJoinsNameRouteCount() {
        XCTAssertEqual(
            FrontendErrorsAccessibility.offender(name: "DriveChart", route: "/drives/1", count: "312"),
            "DriveChart, /drives/1: 312"
        )
    }
}
