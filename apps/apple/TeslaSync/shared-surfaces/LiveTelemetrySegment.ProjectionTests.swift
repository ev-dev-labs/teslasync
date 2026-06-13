//
//  LiveTelemetrySegment.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  Pure-logic coverage for the footer live-telemetry segment: the tone / icon / label projection across
//  every status, the `iconOnly` gating of the short label + inline age stamp, the tooltip + aria
//  composition, and the compact age formatter (the web `ageSecondsLabel` thresholds + the em-dash
//  fallback). All deterministic — the clock, locale, and string facade are injected — so no view,
//  bundle, or network is involved. The state-holder / view / telemetry coverage lives in
//  LiveTelemetrySegment.Tests.swift.
//

import Foundation
import XCTest

/// A string resolver that returns the English fallback verbatim, so assertions don't depend on the test
/// host's bundle having the "LiveTelemetrySegment" table.
private let englishStrings: LiveTelemetrySegmentResolve = { _, fallback in fallback }

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
private let usLocale = Locale(identifier: "en_US")

// MARK: - Visual projection (web `cfg[status]`)

final class LiveTelemetrySegmentProjectionTests: XCTestCase {
    private func resolve(
        _ status: LiveConnectionStatus,
        iconOnly: Bool = false,
        lastMessageAt: Date? = nil
    ) -> LiveTelemetrySegmentResolved {
        LiveTelemetrySegmentProjection.resolve(
            snapshot: LiveConnectionSnapshot(status: status, lastMessageAt: lastMessageAt),
            iconOnly: iconOnly,
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
        XCTAssertEqual(resolved.shortLabel, "Live")
    }

    func testReconnectingToneIconLabelSpins() {
        let resolved = resolve(.reconnecting)
        XCTAssertEqual(resolved.tone, .warning)
        XCTAssertEqual(resolved.icon, .reconnecting)
        XCTAssertTrue(resolved.isSpinning)
        XCTAssertEqual(resolved.shortLabel, "Reconnecting")
    }

    func testDisconnectedToneIconLabel() {
        let resolved = resolve(.disconnected)
        XCTAssertEqual(resolved.tone, .danger)
        XCTAssertEqual(resolved.icon, .wifiSlash)
        XCTAssertEqual(resolved.shortLabel, "Offline")
    }

    /// The web `LiveTelemetrySegment` labels the never-connected state "Idle" (not the data-display
    /// "Unknown") — guard the divergence.
    func testUnknownLabelsIdle() {
        let resolved = resolve(.unknown)
        XCTAssertEqual(resolved.tone, .muted)
        XCTAssertEqual(resolved.icon, .wifiSlash)
        XCTAssertEqual(resolved.shortLabel, "Idle")
    }

    func testRouteIsSignalDiff() {
        XCTAssertEqual(resolve(.connected).route, "/signal-diff")
        XCTAssertEqual(LiveTelemetrySegmentMeta.route, "/signal-diff")
    }

    // MARK: Age stamp gating (web `!iconOnly && connected && lastMessageAt`)

    func testAgeShownWhenExpandedConnectedWithTimestamp() {
        let resolved = resolve(.connected, lastMessageAt: fixedNow.addingTimeInterval(-300))
        XCTAssertEqual(resolved.ageText, "5m")
        XCTAssertTrue(resolved.showsLabel)
    }

    func testAgeHiddenWhenIconOnly() {
        let resolved = resolve(.connected, iconOnly: true, lastMessageAt: fixedNow.addingTimeInterval(-300))
        XCTAssertNil(resolved.ageText)
        XCTAssertFalse(resolved.showsLabel)
    }

    func testAgeHiddenWhenNotConnected() {
        XCTAssertNil(resolve(.reconnecting, lastMessageAt: fixedNow.addingTimeInterval(-300)).ageText)
        XCTAssertNil(resolve(.disconnected, lastMessageAt: fixedNow.addingTimeInterval(-300)).ageText)
        XCTAssertNil(resolve(.unknown, lastMessageAt: fixedNow.addingTimeInterval(-300)).ageText)
    }

    func testAgeHiddenWhenNoTimestamp() {
        XCTAssertNil(resolve(.connected, lastMessageAt: nil).ageText)
    }

    // MARK: Tooltip + aria (web `tooltipBody` + `aria-label`)

    func testTooltipConnectedFoldsInAge() {
        let resolved = resolve(.connected, lastMessageAt: fixedNow.addingTimeInterval(-45))
        XCTAssertEqual(resolved.tooltip, "Live telemetry stream · Last message 45s ago")
    }

    func testTooltipNonConnectedUsesShortLabel() {
        XCTAssertEqual(resolve(.disconnected).tooltip, "Live telemetry stream · Offline")
        XCTAssertEqual(resolve(.unknown).tooltip, "Live telemetry stream · Idle")
    }

    func testTooltipConnectedWithoutTimestampUsesFallbackAge() {
        XCTAssertEqual(resolve(.connected).tooltip, "Live telemetry stream · Last message — ago")
    }

    func testAccessibilityLabelComposesStatus() {
        XCTAssertEqual(resolve(.connected).accessibilityLabel, "Live telemetry status: Live")
        XCTAssertEqual(resolve(.unknown).accessibilityLabel, "Live telemetry status: Idle")
    }
}

// MARK: - Compact age formatter (web `ageSecondsLabel`)

final class LiveTelemetrySegmentAgeTests: XCTestCase {
    private func label(_ secondsAgo: TimeInterval) -> String {
        LiveTelemetrySegmentAge.label(
            for: fixedNow.addingTimeInterval(-secondsAgo),
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
    }

    func testSecondsUnderOneMinute() {
        XCTAssertEqual(label(0), "0s")
        XCTAssertEqual(label(5), "5s")
        XCTAssertEqual(label(59), "59s")
    }

    func testMinutesUnderOneHour() {
        XCTAssertEqual(label(60), "1m")
        XCTAssertEqual(label(300), "5m")
        XCTAssertEqual(label(59 * 60), "59m")
    }

    func testHoursAtAndBeyondOneHour() {
        XCTAssertEqual(label(60 * 60), "1h")
        XCTAssertEqual(label(2 * 60 * 60), "2h")
        XCTAssertEqual(label(50 * 60 * 60), "50h")
    }

    func testNilInstantIsFallbackGlyph() {
        let result = LiveTelemetrySegmentAge.label(
            for: nil,
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
        XCTAssertEqual(result, "—")
    }

    func testFutureInstantIsFallbackGlyph() {
        let result = LiveTelemetrySegmentAge.label(
            for: fixedNow.addingTimeInterval(120),
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
        XCTAssertEqual(result, "—")
    }
}

@testable import TeslaSync
