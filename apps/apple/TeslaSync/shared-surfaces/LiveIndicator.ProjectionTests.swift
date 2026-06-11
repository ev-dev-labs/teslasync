//
//  LiveIndicator.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  Pure-logic coverage for the live-pipeline-health indicator: the status derivation (the web
//  `useLiveConnection` compute step + the 10s reconnecting grace), the snapshot factory, the
//  tone / icon / label / freshness projection across every status and variant, and the relative-time
//  formatter (the `formatRelativeTime` thresholds). All deterministic — the clock, locale, and string
//  facade are injected — so no view, bundle, or network is involved. The state-holder / view /
//  telemetry coverage lives in LiveIndicator.Tests.swift.
//

import Foundation
import XCTest

/// A string resolver that returns the English fallback verbatim, so assertions don't depend on the
/// test host's bundle having the "LiveIndicator" table.
private let englishStrings: LiveIndicatorResolve = { _, fallback in fallback }

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
private let usLocale = Locale(identifier: "en_US")

// MARK: - Status derivation (web `useLiveConnection` compute step)

final class LiveConnectionStatusDeriveTests: XCTestCase {
    func testConnectedTransportAlwaysConnected() {
        let status = LiveConnectionStatus.derive(
            transport: .connected,
            hasEverConnected: false,
            dwell: 999
        )
        XCTAssertEqual(status, .connected)
    }

    func testUnknownWhenNeverConnected() {
        let status = LiveConnectionStatus.derive(
            transport: .reconnecting,
            hasEverConnected: false,
            dwell: 0
        )
        XCTAssertEqual(status, .unknown)
    }

    func testReconnectingWithinGrace() {
        let status = LiveConnectionStatus.derive(
            transport: .reconnecting,
            hasEverConnected: true,
            dwell: 9.9
        )
        XCTAssertEqual(status, .reconnecting)
    }

    func testDisconnectedAtAndAfterGrace() {
        XCTAssertEqual(
            LiveConnectionStatus.derive(transport: .reconnecting, hasEverConnected: true, dwell: 10),
            .disconnected
        )
        XCTAssertEqual(
            LiveConnectionStatus.derive(transport: .reconnecting, hasEverConnected: true, dwell: 30),
            .disconnected
        )
    }

    func testGraceMatchesWebConstant() {
        XCTAssertEqual(LiveConnectionStatus.reconnectingGrace, 10)
    }
}

// MARK: - Snapshot factory

final class LiveConnectionSnapshotTests: XCTestCase {
    func testMakeAppliesDeriveAndCarriesTimestamp() {
        let lastMessage = fixedNow.addingTimeInterval(-120)
        let reading = LiveConnectionReading(
            transport: .reconnecting,
            hasEverConnected: true,
            stateEnteredAt: fixedNow.addingTimeInterval(-5),
            lastMessageAt: lastMessage
        )
        let snapshot = LiveConnectionSnapshot.make(from: reading, now: fixedNow)
        XCTAssertEqual(snapshot.status, .reconnecting)
        XCTAssertEqual(snapshot.lastMessageAt, lastMessage)
    }

    func testMakePromotesToDisconnectedAfterGrace() {
        let reading = LiveConnectionReading(
            transport: .reconnecting,
            hasEverConnected: true,
            stateEnteredAt: fixedNow.addingTimeInterval(-30)
        )
        XCTAssertEqual(LiveConnectionSnapshot.make(from: reading, now: fixedNow).status, .disconnected)
    }

    func testDefaultSnapshotIsUnknown() {
        XCTAssertEqual(LiveConnectionSnapshot().status, .unknown)
        XCTAssertNil(LiveConnectionSnapshot().lastMessageAt)
    }
}

// MARK: - Visual projection (web `cfg[status]` + variant branch)

final class LiveIndicatorProjectionTests: XCTestCase {
    private func resolve(
        _ status: LiveConnectionStatus,
        variant: LiveIndicatorVariant = .pill,
        lastMessageAt: Date? = nil
    ) -> LiveIndicatorResolved {
        LiveIndicatorProjection.resolve(
            snapshot: LiveConnectionSnapshot(status: status, lastMessageAt: lastMessageAt),
            variant: variant,
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
    }

    func testConnectedToneIconLabel() {
        let resolved = resolve(.connected)
        XCTAssertEqual(resolved.tone, .success)
        XCTAssertEqual(resolved.icon, .wifi)
        XCTAssertFalse(resolved.isSpinning)
        XCTAssertEqual(resolved.label, "Live")
    }

    func testReconnectingToneIconLabelSpins() {
        let resolved = resolve(.reconnecting)
        XCTAssertEqual(resolved.tone, .warning)
        XCTAssertEqual(resolved.icon, .reconnecting)
        XCTAssertTrue(resolved.isSpinning)
        XCTAssertEqual(resolved.label, "Reconnecting…")
    }

    func testDisconnectedToneIconLabel() {
        let resolved = resolve(.disconnected)
        XCTAssertEqual(resolved.tone, .danger)
        XCTAssertEqual(resolved.icon, .wifiSlash)
        XCTAssertEqual(resolved.label, "Offline")
    }

    func testUnknownToneIconLabel() {
        let resolved = resolve(.unknown)
        XCTAssertEqual(resolved.tone, .muted)
        XCTAssertEqual(resolved.icon, .wifiSlash)
        XCTAssertEqual(resolved.label, "Unknown")
    }

    func testPillFreshnessShownWhenConnectedWithTimestamp() {
        let resolved = resolve(.connected, variant: .pill, lastMessageAt: fixedNow.addingTimeInterval(-300))
        XCTAssertEqual(resolved.freshness, "5m ago")
        XCTAssertEqual(resolved.accessibilityValue, "5m ago")
    }

    func testFreshnessHiddenForCompactVariant() {
        let resolved = resolve(.connected, variant: .compact, lastMessageAt: fixedNow.addingTimeInterval(-300))
        XCTAssertNil(resolved.freshness)
        XCTAssertNil(resolved.accessibilityValue)
    }

    func testFreshnessHiddenForDotVariant() {
        let resolved = resolve(.connected, variant: .dot, lastMessageAt: fixedNow.addingTimeInterval(-300))
        XCTAssertNil(resolved.freshness)
    }

    func testFreshnessHiddenWhenNotConnected() {
        let resolved = resolve(.reconnecting, variant: .pill, lastMessageAt: fixedNow.addingTimeInterval(-300))
        XCTAssertNil(resolved.freshness)
    }

    func testFreshnessHiddenWhenNoTimestamp() {
        XCTAssertNil(resolve(.connected, variant: .pill, lastMessageAt: nil).freshness)
    }

    func testAccessibilityLabelMirrorsStatusLabel() {
        let resolved = resolve(.disconnected)
        XCTAssertEqual(resolved.accessibilityLabel, resolved.label)
    }

    func testVariantPropagatesToResolved() {
        XCTAssertEqual(resolve(.connected, variant: .dot).variant, .dot)
        XCTAssertEqual(resolve(.connected, variant: .compact).variant, .compact)
    }
}

// MARK: - Relative-time formatter (web `formatRelativeTime`)

final class LiveIndicatorRelativeTimeTests: XCTestCase {
    private func string(_ secondsAgo: TimeInterval) -> String {
        LiveIndicatorRelativeTime.string(
            for: fixedNow.addingTimeInterval(-secondsAgo),
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
    }

    func testJustNowUnderOneMinute() {
        XCTAssertEqual(string(0), "Just now")
        XCTAssertEqual(string(59), "Just now")
    }

    func testMinutesAgo() {
        XCTAssertEqual(string(60), "1m ago")
        XCTAssertEqual(string(300), "5m ago")
        XCTAssertEqual(string(59 * 60), "59m ago")
    }

    func testHoursAgo() {
        XCTAssertEqual(string(60 * 60), "1h ago")
        XCTAssertEqual(string(3 * 60 * 60), "3h ago")
        XCTAssertEqual(string(23 * 60 * 60), "23h ago")
    }

    func testAbsoluteBeyondOneDay() {
        let result = string(48 * 60 * 60)
        XCTAssertFalse(result.isEmpty)
        XCTAssertFalse(result.contains("ago"))
        XCTAssertNotEqual(result, "Just now")
    }

    func testFutureInstantIsJustNow() {
        let result = LiveIndicatorRelativeTime.string(
            for: fixedNow.addingTimeInterval(120),
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
        XCTAssertEqual(result, "Just now")
    }

    func testNilInstantIsFallbackGlyph() {
        let result = LiveIndicatorRelativeTime.string(
            for: nil,
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
        XCTAssertEqual(result, "—")
    }
}

@testable import TeslaSync
