//
//  ChargingScheduleWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  Adapter coverage for the ChargingScheduleWidget surface — the pure projection
//  layer that has parity-critical logic:
//    • `ChargingScheduleSignals.parse` parity with the web `parseScheduleSignals`
//      (per-field type guards + the `pending` boolean test).
//    • `ChargingScheduleFormat` time/percent ports of `lib/dateFormat.formatTime`
//      (localized wall-clock + em-dash fallback).
//    • `ChargingScheduleMode.resolve` (`modeLabel` / `modeBadgeVariant`).
//    • `ChargingScheduleAdapter.project` — the `timelineItems` derivation, the
//      `hasScheduleData` gate, the compact hero, and the state detail.
//
//  The state-holder / registry / accessibility coverage lives in
//  ChargingScheduleWidget.ModelTests.swift. Both run in the TeslaSync(/-macOS)
//  XCTest targets with no network and no real store.
//

import XCTest
@testable import TeslaSync

private let enUS = ChargingScheduleFormatOptions(localeIdentifier: "en_US", timeZoneIdentifier: "America/Los_Angeles")

private func scheduledSignals(
    mode: String? = "StartAt",
    pending: Bool = true,
    start: String? = "2026-06-08T23:30:00Z",
    departure: String? = "2026-06-09T15:00:00Z",
    soc: Int? = 80
) -> ChargingScheduleSignals {
    ChargingScheduleSignals(
        mode: mode,
        pending: pending,
        startTime: start,
        departureTime: departure,
        chargeLimitSoc: soc
    )
}

// MARK: - Adapter: signal parsing (parity with the web `parseScheduleSignals`)

final class ChargingScheduleParseTests: XCTestCase {
    func testParsesEveryFieldFromTypedValues() {
        let signals = ChargingScheduleSignals.parse(from: [
            "ScheduledChargingMode": .string("DepartBy"),
            "ScheduledChargingPending": .bool(true),
            "ScheduledChargingStartTime": .string("2026-06-08T23:30:00Z"),
            "ScheduledDepartureTime": .string("2026-06-09T15:00:00Z"),
            "ChargeLimitSoc": .number(80)
        ])
        XCTAssertEqual(signals.mode, "DepartBy")
        XCTAssertTrue(signals.pending)
        XCTAssertEqual(signals.startTime, "2026-06-08T23:30:00Z")
        XCTAssertEqual(signals.departureTime, "2026-06-09T15:00:00Z")
        XCTAssertEqual(signals.chargeLimitSoc, 80)
    }

    func testNonStringModeAndTimesCollapseToNil() {
        let signals = ChargingScheduleSignals.parse(from: [
            "ScheduledChargingMode": .number(1),
            "ScheduledChargingStartTime": .bool(true),
            "ScheduledDepartureTime": .other,
            "ChargeLimitSoc": .string("80")
        ])
        XCTAssertNil(signals.mode)
        XCTAssertNil(signals.startTime)
        XCTAssertNil(signals.departureTime)
        // ChargeLimitSoc only survives as a number — a string collapses to nil.
        XCTAssertNil(signals.chargeLimitSoc)
    }

    func testPendingAcceptsBoolTrueOrStringTrueOnly() {
        XCTAssertTrue(ChargingScheduleSignals.parse(from: ["ScheduledChargingPending": .bool(true)]).pending)
        XCTAssertTrue(ChargingScheduleSignals.parse(from: ["ScheduledChargingPending": .string("true")]).pending)
        XCTAssertFalse(ChargingScheduleSignals.parse(from: ["ScheduledChargingPending": .bool(false)]).pending)
        XCTAssertFalse(ChargingScheduleSignals.parse(from: ["ScheduledChargingPending": .string("1")]).pending)
        XCTAssertFalse(ChargingScheduleSignals.parse(from: [:]).pending)
    }

    func testMissingKeysYieldEmptySignals() {
        let signals = ChargingScheduleSignals.parse(from: [:])
        XCTAssertNil(signals.mode)
        XCTAssertFalse(signals.pending)
        XCTAssertNil(signals.startTime)
        XCTAssertNil(signals.departureTime)
        XCTAssertNil(signals.chargeLimitSoc)
    }

    func testChargeLimitRoundsNumberToInt() {
        XCTAssertEqual(ChargingScheduleSignals.parse(from: ["ChargeLimitSoc": .number(79.6)]).chargeLimitSoc, 80)
        XCTAssertEqual(ChargingScheduleSignals.parse(from: ["ChargeLimitSoc": .number(50)]).chargeLimitSoc, 50)
    }
}

// MARK: - Adapter: time + percent formatting (parity with the web `formatTime`)

final class ChargingScheduleFormatTests: XCTestCase {
    func testFormatsWallClockTimeInLocaleAndZone() {
        XCTAssertEqual(ChargingScheduleFormat.time("2026-06-08T23:30:00Z", options: enUS), "4:30 PM")
        XCTAssertEqual(ChargingScheduleFormat.time("2026-06-09T15:00:00Z", options: enUS), "8:00 AM")
    }

    func testToleratesFractionalSeconds() {
        XCTAssertEqual(ChargingScheduleFormat.time("2026-06-08T23:30:00.000Z", options: enUS), "4:30 PM")
    }

    func testHonorsTwentyFourHourLocale() {
        let enGB = ChargingScheduleFormatOptions(localeIdentifier: "en_GB", timeZoneIdentifier: "America/Los_Angeles")
        XCTAssertEqual(ChargingScheduleFormat.time("2026-06-08T23:30:00Z", options: enGB), "16:30")
    }

    func testNilOrUnparseableTimeReturnsEmDash() {
        XCTAssertEqual(ChargingScheduleFormat.time(nil, options: enUS), "—")
        XCTAssertEqual(ChargingScheduleFormat.time("", options: enUS), "—")
        XCTAssertEqual(ChargingScheduleFormat.time("07:00", options: enUS), "—")
    }

    func testPercent() {
        XCTAssertEqual(ChargingScheduleFormat.percent(80), "80%")
        XCTAssertEqual(ChargingScheduleFormat.percent(0), "0%")
    }
}

// MARK: - Adapter: mode label + tone (parity with `modeLabel` / `modeBadgeVariant`)

final class ChargingScheduleModeTests: XCTestCase {
    func testKnownModesResolveLabelAndTone() {
        let startAt = ChargingScheduleMode.resolve("StartAt")
        XCTAssertEqual(startAt.label, "Start At")
        XCTAssertEqual(startAt.tone, .success)

        let departBy = ChargingScheduleMode.resolve("DepartBy")
        XCTAssertEqual(departBy.label, "Depart By")
        XCTAssertEqual(departBy.tone, .success)

        let off = ChargingScheduleMode.resolve("Off")
        XCTAssertEqual(off.label, "Off")
        XCTAssertEqual(off.tone, .neutral)
    }

    func testUnknownModeShowsVerbatimWithWarningTone() {
        let other = ChargingScheduleMode.resolve("SolarOptimized")
        XCTAssertEqual(other.label, "SolarOptimized")
        XCTAssertEqual(other.tone, .warning)
    }

    func testNilModeLocalizesToUnknownWithWarningTone() {
        let none = ChargingScheduleMode.resolve(nil)
        XCTAssertEqual(none.label, "Unknown")
        XCTAssertEqual(none.tone, .warning)
    }
}

// MARK: - Adapter: projection (parity with the web `timelineItems` + `hasScheduleData`)

final class ChargingScheduleAdapterTests: XCTestCase {
    func testFullScheduleBuildsAllThreeTimelineRowsInOrder() {
        let projection = ChargingScheduleAdapter.project(
            signals: scheduledSignals(),
            state: ChargingScheduleStateDTO(batteryLevel: 64, isCharging: true),
            options: enUS
        )
        XCTAssertTrue(projection.hasScheduleData)
        XCTAssertTrue(projection.hasTimes)
        XCTAssertEqual(projection.timelineItems.map(\.kind), [.start, .departure, .limit])

        let start = projection.timelineItems[0]
        XCTAssertEqual(start.title, "Start Charging")
        XCTAssertEqual(start.subtitle, "Pending")
        XCTAssertEqual(start.time, "4:30 PM")
        XCTAssertEqual(start.tone, .start)

        let departure = projection.timelineItems[1]
        XCTAssertEqual(departure.title, "Departure")
        XCTAssertNil(departure.subtitle)
        XCTAssertEqual(departure.time, "8:00 AM")
        XCTAssertEqual(departure.tone, .departure)

        let limit = projection.timelineItems[2]
        XCTAssertEqual(limit.title, "Target Limit")
        XCTAssertEqual(limit.time, "80%")
        XCTAssertEqual(limit.tone, .limit)
    }

    func testStartRowOmitsPendingSubtitleWhenNotPending() {
        let projection = ChargingScheduleAdapter.project(
            signals: scheduledSignals(pending: false, departure: nil, soc: nil),
            state: nil,
            options: enUS
        )
        XCTAssertEqual(projection.timelineItems.map(\.kind), [.start])
        XCTAssertNil(projection.timelineItems.first?.subtitle)
    }

    func testHasScheduleDataIgnoresDepartureOnlySignals() {
        // Departure time alone does NOT make the widget show content — the web
        // `hasScheduleData` reads mode || startTime || chargeLimit (not departure).
        let projection = ChargingScheduleAdapter.project(
            signals: ChargingScheduleSignals(departureTime: "2026-06-09T15:00:00Z"),
            state: nil,
            options: enUS
        )
        XCTAssertFalse(projection.hasScheduleData)
        // The departure row is still projected (the timeline renders it once shown).
        XCTAssertEqual(projection.timelineItems.map(\.kind), [.departure])
    }

    func testModeOnlyCountsAsScheduleDataButHasNoTimes() {
        let projection = ChargingScheduleAdapter.project(
            signals: ChargingScheduleSignals(mode: "Off"),
            state: nil,
            options: enUS
        )
        XCTAssertTrue(projection.hasScheduleData)
        XCTAssertFalse(projection.hasTimes)
        XCTAssertEqual(projection.mode.label, "Off")
        XCTAssertEqual(projection.mode.tone, .neutral)
    }

    func testCompactLimitTextAndDashFallback() {
        XCTAssertEqual(
            ChargingScheduleAdapter.project(signals: scheduledSignals(soc: 90), state: nil, options: enUS)
                .compactLimitText,
            "90%"
        )
        XCTAssertEqual(
            ChargingScheduleAdapter.project(
                signals: scheduledSignals(soc: nil),
                state: nil,
                options: enUS
            ).compactLimitText,
            "—"
        )
    }

    func testEmptySignalsProduceNoScheduleData() {
        let projection = ChargingScheduleAdapter.project(
            signals: ChargingScheduleSignals(),
            state: nil,
            options: enUS
        )
        XCTAssertFalse(projection.hasScheduleData)
        XCTAssertTrue(projection.timelineItems.isEmpty)
        XCTAssertEqual(projection.compactLimitText, "—")
        XCTAssertFalse(projection.hasState)
    }

    func testStateDetailProjectsBatteryAndChargingFlag() {
        let charging = ChargingScheduleAdapter.project(
            signals: scheduledSignals(),
            state: ChargingScheduleStateDTO(batteryLevel: 72, isCharging: true),
            options: enUS
        )
        XCTAssertTrue(charging.hasState)
        XCTAssertEqual(charging.batteryLevel, 72)
        XCTAssertTrue(charging.isCharging)

        // Missing battery level mirrors the web `battery_level ?? 0`.
        let unknown = ChargingScheduleAdapter.project(
            signals: scheduledSignals(),
            state: ChargingScheduleStateDTO(batteryLevel: nil, isCharging: false),
            options: enUS
        )
        XCTAssertEqual(unknown.batteryLevel, 0)
        XCTAssertFalse(unknown.isCharging)
    }
}
