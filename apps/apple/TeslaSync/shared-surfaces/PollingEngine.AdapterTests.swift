//
//  PollingEngine.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  Coverage for the pure, dependency-light core of the PollingEngine surface:
//    • Duration — the verbatim port of `formatDuration` / `formatTimeUntil` rounding (now / Ns / Nm /
//      Nh Mm), including the `<= 0 → now`, non-finite, and nil-target guards.
//    • Activity — the `activityIcon` / `activityColor` switch tables (parse, tone, symbol, pulse).
//    • Profile — the `profileLabel` switch table (parse, label key, verbatim fallback).
//    • Breakdown — the stacked-bar reduction (total over every key, the `value > 0` filter, canonical
//      ordering, fractions relative to the full total, the empty-when-non-positive guard).
//    • Number — the `toFixed` / `${number}` / `Math.round` / `/1e6` display helpers.
//    • VIN — the `vin.slice(-8)` trailing-8 helper.
//    • Meta + Accessibility — the diagnostics slug + the VoiceOver label builders.
//
//  These have no network and no store, so each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Duration (web `formatDuration` / `formatTimeUntil`)

final class PollingDurationTests: XCTestCase {
    func testNonPositiveAndNonFiniteCollapseToNow() {
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 0), .now)
        XCTAssertEqual(PollingDuration.decompose(milliseconds: -5000), .now)
        XCTAssertEqual(PollingDuration.decompose(milliseconds: .nan), .now)
        XCTAssertEqual(PollingDuration.decompose(milliseconds: .infinity), .now)
    }

    func testSeconds() {
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 1000), .seconds(1))
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 59000), .seconds(59))
    }

    func testMinutes() {
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 60000), .minutes(1))
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 3_599_000), .minutes(59))
    }

    func testHoursMinutes() {
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 3_600_000), .hoursMinutes(1, 0))
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 3_661_000), .hoursMinutes(1, 1))
        XCTAssertEqual(PollingDuration.decompose(milliseconds: 7_320_000), .hoursMinutes(2, 2))
    }

    func testUntilPartsNilTargetIsNow() {
        XCTAssertEqual(PollingDuration.untilParts(target: nil, now: Date()), .now)
    }

    func testUntilPartsPastIsNow() {
        let now = Date(timeIntervalSince1970: 1000)
        let past = Date(timeIntervalSince1970: 940)
        XCTAssertEqual(PollingDuration.untilParts(target: past, now: now), .now)
    }

    func testUntilPartsFuture() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(
            PollingDuration.untilParts(target: now.addingTimeInterval(45), now: now),
            .seconds(45)
        )
        XCTAssertEqual(
            PollingDuration.untilParts(target: now.addingTimeInterval(90), now: now),
            .minutes(1)
        )
    }
}

// MARK: - Activity (web `activityIcon` + `activityColor`)

final class PollingActivityTests: XCTestCase {
    func testParseIsCaseInsensitive() {
        XCTAssertEqual(PollingActivity(raw: "ACTIVE"), .active)
        XCTAssertEqual(PollingActivity(raw: "Moderate"), .moderate)
        XCTAssertEqual(PollingActivity(raw: "sleeping"), .sleeping)
    }

    func testUnknownPreservesRaw() {
        XCTAssertEqual(PollingActivity(raw: "hyperdrive"), .unknown("hyperdrive"))
        XCTAssertEqual(PollingActivity(raw: "hyperdrive").raw, "hyperdrive")
        XCTAssertNil(PollingActivity(raw: "hyperdrive").labelKey)
    }

    func testTonePortsActivityColor() {
        XCTAssertEqual(PollingActivity.active.tone, .success)
        XCTAssertEqual(PollingActivity.critical.tone, .success)
        XCTAssertEqual(PollingActivity.moderate.tone, .info)
        XCTAssertEqual(PollingActivity.low.tone, .warning)
        XCTAssertEqual(PollingActivity.idle.tone, .muted)
        XCTAssertEqual(PollingActivity.sleeping.tone, .muted)
        XCTAssertEqual(PollingActivity.unknown("x").tone, .muted)
    }

    func testSymbolPortsActivityIcon() {
        XCTAssertEqual(PollingActivity.active.symbolName, "bolt.fill")
        XCTAssertEqual(PollingActivity.critical.symbolName, "bolt.fill")
        XCTAssertEqual(PollingActivity.moderate.symbolName, "battery.100.bolt")
        XCTAssertEqual(PollingActivity.low.symbolName, "waveform.path.ecg")
        XCTAssertEqual(PollingActivity.idle.symbolName, "moon.fill")
        XCTAssertEqual(PollingActivity.sleeping.symbolName, "moon.fill")
        XCTAssertEqual(PollingActivity.unknown("x").symbolName, "gauge.medium")
    }

    func testOnlyActivePulses() {
        XCTAssertTrue(PollingActivity.active.pulses)
        XCTAssertFalse(PollingActivity.critical.pulses)
        XCTAssertFalse(PollingActivity.idle.pulses)
    }
}

// MARK: - Profile (web `profileLabel`)

final class PollingProfileTests: XCTestCase {
    func testKnownProfiles() {
        XCTAssertEqual(PollingProfile(raw: "driving"), .driving)
        XCTAssertEqual(PollingProfile(raw: "Charging"), .charging)
        XCTAssertEqual(PollingProfile.driving.labelKey, "polling.profile.driving")
        XCTAssertEqual(PollingProfile.driving.fallback, "Driving")
    }

    func testOtherPreservesRaw() {
        XCTAssertEqual(PollingProfile(raw: "valet"), .other("valet"))
        XCTAssertNil(PollingProfile.other("valet").labelKey)
        XCTAssertEqual(PollingProfile.other("valet").fallback, "valet")
    }
}

// MARK: - Breakdown (web stacked-bar reduction)

final class PollingBreakdownTests: XCTestCase {
    func testTotalSumsEveryKey() {
        let breakdown = ["fleet_telemetry": 50.0, "idle_detection": 30.0, "extra_key": 20.0]
        XCTAssertEqual(PollingBreakdown.total(of: breakdown), 100, accuracy: 0.0001)
    }

    func testSegmentsFilterNonPositiveAndOrderCanonically() {
        let breakdown = [
            "fleet_telemetry": 60.0,
            "idle_detection": 0.0,
            "prediction": 30.0,
            "sleep_detection": 10.0
        ]
        let segments = PollingBreakdown.segments(from: breakdown)
        XCTAssertEqual(segments.map(\.category), [.fleetTelemetry, .prediction, .sleepDetection])
        XCTAssertEqual(segments.map(\.id), ["fleetTelemetry", "prediction", "sleepDetection"])
    }

    func testFractionsAreRelativeToFullTotal() {
        // A non-category key inflates the denominator (web sums Object.values).
        let breakdown = ["fleet_telemetry": 50.0, "other": 50.0]
        let segments = PollingBreakdown.segments(from: breakdown)
        XCTAssertEqual(segments.count, 1)
        XCTAssertEqual(segments[0].fraction, 0.5, accuracy: 0.0001)
    }

    func testEmptyWhenTotalNonPositive() {
        XCTAssertTrue(PollingBreakdown.segments(from: [:]).isEmpty)
        XCTAssertTrue(PollingBreakdown.segments(from: ["fleet_telemetry": 0]).isEmpty)
    }
}

// MARK: - Number (web `toFixed` / `${number}` / `Math.round` / `/1e6`)

final class PollingNumberTests: XCTestCase {
    func testPlainTrimsToWebNumber() {
        XCTAssertEqual(PollingNumber.plain(78), "78")
        XCTAssertEqual(PollingNumber.plain(0), "0")
        XCTAssertEqual(PollingNumber.plain(12.5), "12.5")
        XCTAssertEqual(PollingNumber.plain(12.50), "12.5")
    }

    func testFixedMatchesToFixed() {
        XCTAssertEqual(PollingNumber.fixed(42.5, decimals: 1), "42.5")
        XCTAssertEqual(PollingNumber.fixed(12.844, decimals: 2), "12.84")
        XCTAssertEqual(PollingNumber.fixed(1284, decimals: 0), "1284")
    }

    func testRoundedPercentMatchesMathRound() {
        XCTAssertEqual(PollingNumber.roundedPercent(0.82), 82)
        XCTAssertEqual(PollingNumber.roundedPercent(0.876), 88)
        XCTAssertEqual(PollingNumber.roundedPercent(0.005), 1)
    }

    func testNanosToMillis() {
        XCTAssertEqual(PollingNumber.nanosToMillis(1_000_000_000), 1000, accuracy: 0.0001)
    }
}

// MARK: - VIN (web `vin.slice(-8)`)

final class PollingVINTests: XCTestCase {
    func testShortReturnsTrailingEight() {
        XCTAssertEqual(PollingVIN.short("5YJ3E1EA7KF317261"), "KF317261")
    }

    func testShortReturnsWholeWhenShorter() {
        XCTAssertEqual(PollingVIN.short("ABC"), "ABC")
    }
}

// MARK: - Meta + Accessibility

final class PollingEngineMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(PollingEngineMeta.surfaceSlug, "PollingEngine")
        XCTAssertEqual(PollingEngine.surfaceSlug, "PollingEngine")
    }
}

final class PollingEngineAccessibilityTests: XCTestCase {
    func testMetricLabel() {
        XCTAssertEqual(
            PollingEngineAccessibility.metricLabel(label: "Polls Saved", value: "42.5%"),
            "Polls Saved: 42.5%"
        )
    }

    func testVehicleLabel() {
        XCTAssertEqual(
            PollingEngineAccessibility.vehicleLabel(
                vin: "KF317261",
                activity: "active",
                profile: "Driving",
                next: "1m"
            ),
            "KF317261, active, Driving, 1m"
        )
    }

    func testFreshnessLabel() {
        XCTAssertEqual(PollingEngineAccessibility.freshnessLabel("Stale"), "Stale")
    }
}
