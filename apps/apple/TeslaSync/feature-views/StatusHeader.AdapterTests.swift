//
//  StatusHeader.AdapterTests.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  Adapter-level coverage for the StatusHeader surface: the `StatusHeaderNumberFormat`
//  formatting helpers (web `fmtInt` / `fmtNumber` / `safeNumber` parity) and the
//  `StatusHeaderAccessibility` VoiceOver card summary (label, value, sublabel — incl. the
//  localized `Enabled` / `Disabled` replay-mode value). Pure value-in / value-out — no store, no
//  bundle, no rendered view.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (web parity)

@MainActor final class StatusHeaderNumberFormatTests: XCTestCase {
    func testSafeCoercesNonFinite() {
        XCTAssertEqual(StatusHeaderNumberFormat.safe(42), 42, accuracy: 0.0001)
        XCTAssertEqual(StatusHeaderNumberFormat.safe(.nan), 0)
        XCTAssertEqual(StatusHeaderNumberFormat.safe(.infinity), 0)
        XCTAssertEqual(StatusHeaderNumberFormat.safe(-.infinity), 0)
    }

    func testFmtIntGroupsThousands() {
        // Web `fmtInt(v)` → `toLocaleString` grouped integer.
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(0), "0")
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(912), "912")
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(1284), "1,284")
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(1_234_567), "1,234,567")
    }

    func testFmtIntRoundsDoubleHalfAwayFromZero() {
        // Web `fmtInt(12345.6)` → "12,346".
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(12345.6), "12,346")
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(0.5), "1")
    }

    func testFmtIntGuardsNonFinite() {
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(Double.nan), "0")
        XCTAssertEqual(StatusHeaderNumberFormat.fmtInt(Double.infinity), "0")
    }

    func testFmtNumberPrecisionAndGrouping() {
        XCTAssertEqual(StatusHeaderNumberFormat.fmtNumber(1284, decimals: 0), "1,284")
        XCTAssertEqual(StatusHeaderNumberFormat.fmtNumber(1284, decimals: 2), "1,284.00")
    }
}

// MARK: - Accessibility summary

@MainActor final class StatusHeaderAccessibilityTests: XCTestCase {
    /// Mirrors the strings facade bundle-free: echo the fallback for every key.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCardSummaryReadsLabelValueSublabel() {
        let item = StatusHeaderCardItem(
            id: "total",
            labelKey: "admin.dlq.stats.total",
            labelFallback: "Total entries",
            sublabelKey: "admin.dlq.stats.totalSub",
            sublabelFallback: "in dead-letter queue",
            value: .text("1,284"),
            systemImage: "tray.full"
        )
        XCTAssertEqual(
            StatusHeaderAccessibility.cardSummary(item, localize: echo),
            "Total entries, 1,284, in dead-letter queue"
        )
    }

    func testCardSummaryResolvesLocalizedReplayModeValue() {
        let item = StatusHeaderCardItem(
            id: "replayMode",
            labelKey: "admin.dlq.stats.replayMode",
            labelFallback: "Replay mode",
            sublabelKey: "admin.dlq.stats.replayModeSub",
            sublabelFallback: "DLQ_REPLAY_ENABLED env",
            value: .localized(key: "admin.dlq.stats.disabled", fallback: "Disabled"),
            systemImage: "exclamationmark.octagon"
        )
        XCTAssertEqual(
            StatusHeaderAccessibility.cardSummary(item, localize: echo),
            "Replay mode, Disabled, DLQ_REPLAY_ENABLED env"
        )
    }

    func testResolvedValueHandlesBothCases() {
        XCTAssertEqual(StatusHeaderAccessibility.resolvedValue(.text("912"), localize: echo), "912")
        XCTAssertEqual(
            StatusHeaderAccessibility.resolvedValue(
                .localized(key: "admin.dlq.stats.enabled", fallback: "Enabled"),
                localize: echo
            ),
            "Enabled"
        )
    }
}
