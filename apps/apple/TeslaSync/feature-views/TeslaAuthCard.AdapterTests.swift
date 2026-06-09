//
//  TeslaAuthCard.AdapterTests.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  Adapter-level unit coverage: ISO token-expiry parsing (web `Date.parse`), the severity ladder
//  (web `severityFor`), the detail buckets (web `detail`), the CTA selection, the tone descriptor
//  (web `TONE`), the integer day formatter, and the VoiceOver summary. Foundation-only; the clock and
//  locale are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_750_000_000)

private func expiry(daysFromNow days: Double) -> TeslaAuthExpiry {
    .at(fixedNow.addingTimeInterval(days * 24 * 60 * 60))
}

// MARK: - ISO parsing (web `Date.parse` / `!expiresAt`)

@MainActor final class TeslaAuthDateTests: XCTestCase {
    func testNilAndEmptyAreNone() {
        XCTAssertEqual(TeslaAuthDate.expiry(from: nil), .none)
        XCTAssertEqual(TeslaAuthDate.expiry(from: ""), .none)
    }

    func testGarbageIsUnparseable() {
        XCTAssertEqual(TeslaAuthDate.expiry(from: "not-a-date"), .unparseable)
        XCTAssertEqual(TeslaAuthDate.expiry(from: "   "), .unparseable)
    }

    func testInternetDateTimeParses() {
        let reference = ISO8601DateFormatter()
        reference.formatOptions = [.withInternetDateTime]
        let expected = reference.date(from: "2025-06-15T12:00:00Z")
        guard case let .at(date) = TeslaAuthDate.expiry(from: "2025-06-15T12:00:00Z") else {
            return XCTFail("expected a parsed instant")
        }
        XCTAssertEqual(date, expected)
    }

    func testFractionalSecondsParses() {
        guard case .at = TeslaAuthDate.expiry(from: "2025-06-15T12:00:00.500Z") else {
            return XCTFail("expected a parsed instant for a fractional-seconds timestamp")
        }
    }
}

// MARK: - Severity ladder (web `severityFor`)

@MainActor final class TeslaAuthSeverityTests: XCTestCase {
    func testAuthenticatedFalseIsDisconnectedEvenWithValidExpiry() {
        let severity = TeslaAuthLogic.severity(
            authenticated: false,
            expiry: expiry(daysFromNow: 42),
            now: fixedNow
        )
        XCTAssertEqual(severity, .disconnected)
    }

    func testMissingAndUnparseableExpiryAreUnknown() {
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: true, expiry: .none, now: fixedNow),
            .unknown
        )
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: nil, expiry: .unparseable, now: fixedNow),
            .unknown
        )
    }

    func testFutureExpiryBuckets() {
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: true, expiry: expiry(daysFromNow: 42), now: fixedNow),
            .ok
        )
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: true, expiry: expiry(daysFromNow: 3), now: fixedNow),
            .warn
        )
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: true, expiry: expiry(daysFromNow: -5), now: fixedNow),
            .expired
        )
    }

    func testSevenDayBoundaryIsWarnAndEightIsOk() {
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: true, expiry: expiry(daysFromNow: 7), now: fixedNow),
            .warn
        )
        XCTAssertEqual(
            TeslaAuthLogic.severity(authenticated: true, expiry: expiry(daysFromNow: 8), now: fixedNow),
            .ok
        )
    }
}

// MARK: - Detail buckets (web `detail`)

@MainActor final class TeslaAuthDetailTests: XCTestCase {
    func testDisconnectedShortCircuitsEvenWithExpiry() {
        let kind = TeslaAuthLogic.detail(
            severity: .disconnected,
            expiry: expiry(daysFromNow: 42),
            now: fixedNow
        )
        XCTAssertEqual(kind, .disconnected)
    }

    func testMissingAndUnparseableDetail() {
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .unknown, expiry: .none, now: fixedNow),
            .expiryUnknown
        )
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .unknown, expiry: .unparseable, now: fixedNow),
            .unparseable
        )
    }

    func testPastBuckets() {
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .expired, expiry: expiry(daysFromNow: -0.5), now: fixedNow),
            .expiredToday
        )
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .expired, expiry: expiry(daysFromNow: -5), now: fixedNow),
            .expiredDaysAgo(5)
        )
    }

    func testFutureBuckets() {
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .warn, expiry: expiry(daysFromNow: 0.5), now: fixedNow),
            .expiresLaterToday
        )
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .warn, expiry: expiry(daysFromNow: 1), now: fixedNow),
            .expiresInOneDay
        )
        XCTAssertEqual(
            TeslaAuthLogic.detail(severity: .warn, expiry: expiry(daysFromNow: 3), now: fixedNow),
            .expiresInDays(3)
        )
    }
}

// MARK: - CTA + tone (web ternary + `TONE`)

@MainActor final class TeslaAuthToneTests: XCTestCase {
    func testReauthenticateOnlyForExpiredAndDisconnected() {
        XCTAssertTrue(TeslaAuthLogic.isReauthenticate(.expired))
        XCTAssertTrue(TeslaAuthLogic.isReauthenticate(.disconnected))
        XCTAssertFalse(TeslaAuthLogic.isReauthenticate(.ok))
        XCTAssertFalse(TeslaAuthLogic.isReauthenticate(.warn))
        XCTAssertFalse(TeslaAuthLogic.isReauthenticate(.unknown))
    }

    func testToneAccentsAndSymbols() {
        XCTAssertEqual(TeslaAuthTone.tone(for: .ok).accent, .success)
        XCTAssertEqual(TeslaAuthTone.tone(for: .warn).accent, .warning)
        XCTAssertEqual(TeslaAuthTone.tone(for: .expired).accent, .danger)
        XCTAssertEqual(TeslaAuthTone.tone(for: .disconnected).accent, .danger)
        XCTAssertEqual(TeslaAuthTone.tone(for: .unknown).accent, .neutral)

        XCTAssertEqual(TeslaAuthTone.tone(for: .ok).symbol, "checkmark.shield.fill")
        XCTAssertEqual(TeslaAuthTone.tone(for: .warn).symbol, "exclamationmark.shield.fill")
        XCTAssertEqual(TeslaAuthTone.tone(for: .expired).symbol, "xmark.shield.fill")
        XCTAssertEqual(TeslaAuthTone.tone(for: .disconnected).symbol, "xmark.shield.fill")
        XCTAssertEqual(TeslaAuthTone.tone(for: .unknown).symbol, "exclamationmark.shield.fill")
    }

    func testToneBadgeFallbacks() {
        XCTAssertEqual(TeslaAuthTone.tone(for: .ok).badgeLabelFallback, "Connected")
        XCTAssertEqual(TeslaAuthTone.tone(for: .warn).badgeLabelFallback, "Expires soon")
        XCTAssertEqual(TeslaAuthTone.tone(for: .expired).badgeLabelFallback, "Token expired")
        XCTAssertEqual(TeslaAuthTone.tone(for: .disconnected).badgeLabelFallback, "Not connected")
        XCTAssertEqual(TeslaAuthTone.tone(for: .unknown).badgeLabelFallback, "Unknown")
    }
}

// MARK: - Number + accessibility

@MainActor final class TeslaAuthNumberTests: XCTestCase {
    func testIntegerGroups() {
        XCTAssertEqual(TeslaAuthNumber.integer(5, locale: enUS), "5")
        XCTAssertEqual(TeslaAuthNumber.integer(1234, locale: enUS), "1,234")
        XCTAssertEqual(TeslaAuthNumber.integer(0, locale: enUS), "0")
    }

    func testAccessibilitySummaryComposition() {
        XCTAssertEqual(
            TeslaAuthAccessibility.summary(
                title: "Tesla account",
                status: "Connected",
                detail: "Token expires in 42 days."
            ),
            "Tesla account, Connected. Token expires in 42 days."
        )
    }
}
