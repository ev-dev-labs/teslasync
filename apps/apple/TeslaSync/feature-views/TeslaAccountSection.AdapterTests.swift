//
//  TeslaAccountSection.AdapterTests.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  Adapter-level unit coverage: ISO token-expiry parsing (web `new Date(...)`), the token-expiry
//  datetime formatter (web `formatDateTime`), the status ladder (web status-row branch), the
//  authenticated action-set predicate, the "expires soon" day arithmetic (web `expiringSoon` IIFE),
//  the integer formatter, and the VoiceOver summary. Foundation-only; the clock, locale, and time
//  zone are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? .current
private let fixedNow = Date(timeIntervalSince1970: 1_750_000_000)

private func expiry(daysFromNow days: Double) -> TeslaAccountExpiry {
    .at(fixedNow.addingTimeInterval(days * 24 * 60 * 60))
}

// MARK: - ISO parsing (web `new Date(...)` / `!auth.expires_at`)

@MainActor final class TeslaAccountDateTests: XCTestCase {
    func testNilAndEmptyAreNone() {
        XCTAssertEqual(TeslaAccountDate.expiry(from: nil), .none)
        XCTAssertEqual(TeslaAccountDate.expiry(from: ""), .none)
    }

    func testGarbageIsUnparseable() {
        XCTAssertEqual(TeslaAccountDate.expiry(from: "not-a-date"), .unparseable)
        XCTAssertEqual(TeslaAccountDate.expiry(from: "   "), .unparseable)
    }

    func testInternetDateTimeParses() {
        let reference = ISO8601DateFormatter()
        reference.formatOptions = [.withInternetDateTime]
        let expected = reference.date(from: "2025-06-15T12:00:00Z")
        guard case let .at(date) = TeslaAccountDate.expiry(from: "2025-06-15T12:00:00Z") else {
            return XCTFail("expected a parsed instant")
        }
        XCTAssertEqual(date, expected)
    }

    func testFractionalSecondsParses() {
        guard case .at = TeslaAccountDate.expiry(from: "2025-06-15T12:00:00.500Z") else {
            return XCTFail("expected a parsed instant for a fractional-seconds timestamp")
        }
    }

    func testFormatExpiryRendersDateAndTime() {
        guard case let .at(date) = TeslaAccountDate.expiry(from: "2025-06-15T12:00:00Z") else {
            return XCTFail("expected a parsed instant")
        }
        let label = TeslaAccountDate.formatExpiry(date, locale: enUS, timeZone: utc)
        XCTAssertTrue(label.contains("Jun"), "expected month in: \(label)")
        XCTAssertTrue(label.contains("2025"), "expected year in: \(label)")
        XCTAssertTrue(label.contains("12:00"), "expected time in: \(label)")
    }
}

// MARK: - Status ladder (web status-row branch)

@MainActor final class TeslaAccountStatusKindTests: XCTestCase {
    func testConnectedRequiresAuthenticatedAndNoPill() {
        XCTAssertEqual(
            TeslaAccountLogic.statusKind(authenticated: true, pillDisconnected: false),
            .connected
        )
    }

    func testPillDisconnectedWinsEvenWhenAuthenticated() {
        XCTAssertEqual(
            TeslaAccountLogic.statusKind(authenticated: true, pillDisconnected: true),
            .disconnected
        )
    }

    func testNotAuthenticatedWithoutPillIsNotConnected() {
        XCTAssertEqual(
            TeslaAccountLogic.statusKind(authenticated: false, pillDisconnected: false),
            .notConnected
        )
        XCTAssertEqual(
            TeslaAccountLogic.statusKind(authenticated: nil, pillDisconnected: false),
            .notConnected
        )
    }

    func testNotAuthenticatedWithPillIsDisconnected() {
        XCTAssertEqual(
            TeslaAccountLogic.statusKind(authenticated: false, pillDisconnected: true),
            .disconnected
        )
    }
}

// MARK: - Authenticated action-set predicate (web `auth?.authenticated`)

@MainActor final class TeslaAccountAuthenticatedTests: XCTestCase {
    func testIsAuthenticatedOnlyWhenTrue() {
        XCTAssertTrue(TeslaAccountLogic.isAuthenticated(true))
        XCTAssertFalse(TeslaAccountLogic.isAuthenticated(false))
        XCTAssertFalse(TeslaAccountLogic.isAuthenticated(nil))
    }
}

// MARK: - Expiring-soon arithmetic (web `expiringSoon` IIFE)

@MainActor final class TeslaAccountExpiringSoonTests: XCTestCase {
    func testNilWhenNotAuthenticated() {
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(
            authenticated: false,
            expiry: expiry(daysFromNow: 3),
            now: fixedNow
        ))
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(
            authenticated: nil,
            expiry: expiry(daysFromNow: 3),
            now: fixedNow
        ))
    }

    func testNilWhenMissingOrUnparseable() {
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(authenticated: true, expiry: .none, now: fixedNow))
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(authenticated: true, expiry: .unparseable, now: fixedNow))
    }

    func testNilWhenAlreadyExpiredOrAtBoundary() {
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(
            authenticated: true,
            expiry: expiry(daysFromNow: 0),
            now: fixedNow
        ))
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(
            authenticated: true,
            expiry: expiry(daysFromNow: -1),
            now: fixedNow
        ))
    }

    func testNilWhenBeyondSevenDayWindow() {
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(
            authenticated: true,
            expiry: expiry(daysFromNow: 8),
            now: fixedNow
        ))
        XCTAssertNil(TeslaAccountLogic.expiringSoonDays(
            authenticated: true,
            expiry: expiry(daysFromNow: 7.5),
            now: fixedNow
        ))
    }

    func testCeilAndFloorToOneWithinWindow() {
        XCTAssertEqual(
            TeslaAccountLogic.expiringSoonDays(authenticated: true, expiry: expiry(daysFromNow: 3), now: fixedNow),
            3
        )
        XCTAssertEqual(
            TeslaAccountLogic.expiringSoonDays(authenticated: true, expiry: expiry(daysFromNow: 3.2), now: fixedNow),
            4
        )
        XCTAssertEqual(
            TeslaAccountLogic.expiringSoonDays(authenticated: true, expiry: expiry(daysFromNow: 0.1), now: fixedNow),
            1
        )
    }

    func testSevenDayBoundaryIsIncluded() {
        XCTAssertEqual(
            TeslaAccountLogic.expiringSoonDays(authenticated: true, expiry: expiry(daysFromNow: 7), now: fixedNow),
            7
        )
    }
}

// MARK: - Number + accessibility

@MainActor final class TeslaAccountNumberTests: XCTestCase {
    func testIntegerGroups() {
        XCTAssertEqual(TeslaAccountNumber.integer(2, locale: enUS), "2")
        XCTAssertEqual(TeslaAccountNumber.integer(1234, locale: enUS), "1,234")
        XCTAssertEqual(TeslaAccountNumber.integer(0, locale: enUS), "0")
    }

    func testAccessibilitySummaryWithDetail() {
        XCTAssertEqual(
            TeslaAccountAccessibility.summary(
                title: "Tesla Account",
                status: "Connected",
                detail: "Token expires Jun 15, 2025, 12:00 PM"
            ),
            "Tesla Account, Connected. Token expires Jun 15, 2025, 12:00 PM"
        )
    }

    func testAccessibilitySummaryWithoutDetail() {
        XCTAssertEqual(
            TeslaAccountAccessibility.summary(title: "Tesla Account", status: "Not connected", detail: ""),
            "Tesla Account, Not connected."
        )
    }
}
