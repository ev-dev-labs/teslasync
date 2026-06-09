//
//  ScheduledMaintenanceCard.AdapterTests.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  Adapter-level unit coverage: the mode parsing + `isActive` gate, the lenient ISO parse /
//  `toISOString` formatting, the `now`-relative `minutesToStart` (floor) + 24-hour pre-banner
//  thresholds, and the `handleSchedule` math (duration clamp, end instant, default message, POST
//  assembly + validation guards). Foundation-only; `now` + formatter injected for determinism.
//

import XCTest
@testable import TeslaSync

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

/// Deterministic `formatDateTime` stand-in so the default-message template is asserted verbatim.
private struct FixedMaintenanceFormatter: MaintenanceDateFormatting {
    let stamp: String
    func dateTime(_: Date) -> String {
        stamp
    }
}

// MARK: - Maintenance mode

final class MaintenanceModeTests: XCTestCase {
    func testParsesKnownModesCaseInsensitively() {
        XCTAssertEqual(MaintenanceMode.from(raw: "maintenance"), .maintenance)
        XCTAssertEqual(MaintenanceMode.from(raw: "DEGRADED"), .degraded)
        XCTAssertEqual(MaintenanceMode.from(raw: "ok"), .ok)
    }

    func testUnknownModeFoldsToOk() {
        XCTAssertEqual(MaintenanceMode.from(raw: "weird"), .ok)
        XCTAssertEqual(MaintenanceMode.from(raw: ""), .ok)
    }

    func testOnlyMaintenanceIsActive() {
        XCTAssertTrue(MaintenanceMode.maintenance.isActive)
        XCTAssertFalse(MaintenanceMode.degraded.isActive)
        XCTAssertFalse(MaintenanceMode.ok.isActive)
    }
}

// MARK: - ISO instant parse / format

final class MaintenanceInstantTests: XCTestCase {
    func testParsesWithAndWithoutFractionalSeconds() {
        XCTAssertNotNil(MaintenanceInstant.parse("2026-06-09T10:00:00Z"))
        XCTAssertNotNil(MaintenanceInstant.parse("2026-06-09T10:00:00.500Z"))
    }

    func testUnparseableReturnsNil() {
        XCTAssertNil(MaintenanceInstant.parse("not-a-date"))
        XCTAssertNil(MaintenanceInstant.parse(""))
    }

    func testIsoEmitsMillisecondUtc() {
        XCTAssertEqual(MaintenanceInstant.iso(from: Date(timeIntervalSince1970: 0)), "1970-01-01T00:00:00.000Z")
    }

    func testIsoRoundTrips() throws {
        let iso = MaintenanceInstant.iso(from: fixedNow)
        let parsed = try XCTUnwrap(MaintenanceInstant.parse(iso))
        XCTAssertEqual(parsed.timeIntervalSince1970, fixedNow.timeIntervalSince1970, accuracy: 0.001)
    }
}

// MARK: - Maintenance clock (minutesRemaining + within24h)

final class MaintenanceClockTests: XCTestCase {
    func testMinutesRemainingFloorsTowardNegativeInfinity() {
        XCTAssertEqual(MaintenanceClock.minutesRemaining(until: fixedNow.addingTimeInterval(3600), now: fixedNow), 60)
        XCTAssertEqual(MaintenanceClock.minutesRemaining(until: fixedNow.addingTimeInterval(90), now: fixedNow), 1)
        // web Math.floor(-1.5) === -2
        XCTAssertEqual(MaintenanceClock.minutesRemaining(until: fixedNow.addingTimeInterval(-90), now: fixedNow), -2)
    }

    func testMinutesRemainingNilWhenNoInstant() {
        XCTAssertNil(MaintenanceClock.minutesRemaining(until: nil, now: fixedNow))
    }

    func testWithin24hBoundaries() {
        XCTAssertTrue(MaintenanceClock.within24h(until: fixedNow.addingTimeInterval(3600), now: fixedNow))
        XCTAssertTrue(MaintenanceClock.within24h(until: fixedNow.addingTimeInterval(86400), now: fixedNow))
        XCTAssertFalse(MaintenanceClock.within24h(until: fixedNow.addingTimeInterval(86401), now: fixedNow))
    }

    func testWithin24hExcludesNonFutureAndMissing() {
        XCTAssertFalse(MaintenanceClock.within24h(until: fixedNow, now: fixedNow))
        XCTAssertFalse(MaintenanceClock.within24h(until: fixedNow.addingTimeInterval(-1), now: fixedNow))
        XCTAssertFalse(MaintenanceClock.within24h(until: nil, now: fixedNow))
    }
}

// MARK: - Duration clamp (web `Math.max(5, Number(duration) || 60)`)

final class MaintenanceDurationClampTests: XCTestCase {
    func testFalsyValuesFallBackToSixty() {
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration(""), 60)
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("0"), 60)
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("abc"), 60)
    }

    func testParsedValuesClampToMinimumFive() {
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("3"), 5)
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("-5"), 5)
    }

    func testParsedValuesPassThroughAboveMinimum() {
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("90"), 90)
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("90.5"), 90.5)
        XCTAssertEqual(MaintenanceScheduleMath.clampDuration("  120 "), 120)
    }
}

// MARK: - Schedule request builder (web `handleSchedule`)

final class MaintenanceScheduleMathTests: XCTestCase {
    private let fixed = FixedMaintenanceFormatter(stamp: "STAMP")

    func testMissingStartFailsWithPickGuard() {
        let result = MaintenanceScheduleMath.buildRequest(
            start: nil, durationText: "60", message: "", formatter: fixed
        )
        XCTAssertEqual(result, .failure(.missingStart))
        XCTAssertEqual(MaintenanceScheduleError.missingStart.key, "scheduled.toast.pickStart")
    }

    func testNonFiniteStartFailsWithInvalidGuard() {
        let result = MaintenanceScheduleMath.buildRequest(
            start: Date(timeIntervalSince1970: .infinity), durationText: "60", message: "", formatter: fixed
        )
        XCTAssertEqual(result, .failure(.invalidStart))
        XCTAssertEqual(MaintenanceScheduleError.invalidStart.key, "scheduled.toast.invalidStart")
    }

    func testSuccessUsesDefaultMessageWhenBlank() throws {
        let result = MaintenanceScheduleMath.buildRequest(
            start: fixedNow, durationText: "", message: "  ", formatter: fixed
        )
        let request = try result.get()
        XCTAssertEqual(request.mode, .maintenance)
        XCTAssertEqual(request.message, "Scheduled maintenance · ends STAMP")
        // blank duration → 60 minutes → end = now + 3600s
        XCTAssertEqual(request.until, MaintenanceInstant.iso(from: fixedNow.addingTimeInterval(3600)))
    }

    func testSuccessTrimsAndKeepsOperatorMessage() throws {
        let result = MaintenanceScheduleMath.buildRequest(
            start: fixedNow, durationText: "90", message: "  Upgrade DB  ", formatter: fixed
        )
        let request = try result.get()
        XCTAssertEqual(request.message, "Upgrade DB")
        XCTAssertEqual(request.until, MaintenanceInstant.iso(from: fixedNow.addingTimeInterval(90 * 60)))
    }
}
