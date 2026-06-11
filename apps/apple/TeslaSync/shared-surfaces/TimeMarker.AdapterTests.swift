//
//  TimeMarker.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  Pure-core coverage for the alert time-marker (the projection + model + view-composition half lives
//  in TimeMarker.Tests.swift; split to keep each file within the SwiftLint file-length budget). This
//  is the "adapter (cached → projection)" unit test the acceptance calls for: it drives the raw
//  drill-through params through ``AlertContextReducer`` and asserts the verbatim port of the web
//  `useAlertContext` `useMemo`:
//    • severity — `normalizeSeverity` aliases + default (web lib/tokens.ts).
//    • value    — `TimeMarkerValue` equality, the empty-string / ISO initializers, payload accessors.
//    • vehicle  — finite-number parse (web `Number` + `Number.isFinite`).
//    • context  — the `±30min` window, the unparseable / empty `t` branch, the `hasContext` OR.
//    • window   — bound arithmetic + ISO round-trip; the slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure reducer directly.
//

import XCTest
@testable import TeslaSync

// MARK: - MarkerSeverity (web `Severity` + `normalizeSeverity`)

final class MarkerSeverityTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(MarkerSeverity.info.rawValue, "info")
        XCTAssertEqual(MarkerSeverity.warn.rawValue, "warn")
        XCTAssertEqual(MarkerSeverity.critical.rawValue, "critical")
        XCTAssertEqual(MarkerSeverity.success.rawValue, "success")
    }

    func testMarkerDefaultIsWarn() {
        XCTAssertEqual(MarkerSeverity.markerDefault, .warn, "web TimeMarker applies severity ?? 'warn'")
    }

    func testAllCases() {
        XCTAssertEqual(Set(MarkerSeverity.allCases), [.info, .warn, .critical, .success])
    }

    func testNormalizeNilAndEmptyAreInfo() {
        XCTAssertEqual(MarkerSeverity.normalize(nil), .info)
        XCTAssertEqual(MarkerSeverity.normalize(""), .info)
    }

    func testNormalizeCanonicalValues() {
        XCTAssertEqual(MarkerSeverity.normalize("info"), .info)
        XCTAssertEqual(MarkerSeverity.normalize("warn"), .warn)
        XCTAssertEqual(MarkerSeverity.normalize("critical"), .critical)
        XCTAssertEqual(MarkerSeverity.normalize("success"), .success)
    }

    func testNormalizeLegacyAliases() {
        XCTAssertEqual(MarkerSeverity.normalize("warning"), .warn)
        XCTAssertEqual(MarkerSeverity.normalize("error"), .critical)
        XCTAssertEqual(MarkerSeverity.normalize("fatal"), .critical)
        XCTAssertEqual(MarkerSeverity.normalize("ok"), .success)
    }

    func testNormalizeIsCaseInsensitive() {
        XCTAssertEqual(MarkerSeverity.normalize("WARN"), .warn)
        XCTAssertEqual(MarkerSeverity.normalize("Critical"), .critical)
    }

    func testNormalizeUnknownIsInfo() {
        XCTAssertEqual(MarkerSeverity.normalize("bogus"), .info)
    }
}

// MARK: - TimeMarkerValue (web `x: string | number`)

final class TimeMarkerValueTests: XCTestCase {
    func testEquality() {
        XCTAssertEqual(TimeMarkerValue.number(5), .number(5))
        XCTAssertEqual(TimeMarkerValue.text("a"), .text("a"))
        XCTAssertNotEqual(TimeMarkerValue.number(5), .number(6))
        XCTAssertNotEqual(TimeMarkerValue.number(5), .text("5"))
    }

    func testTextInitializerRejectsEmpty() {
        XCTAssertNil(TimeMarkerValue(text: ""), "web `x === ''` maps to nil")
        XCTAssertEqual(TimeMarkerValue(text: "12:30"), .text("12:30"))
    }

    func testISOInitializer() {
        XCTAssertNil(TimeMarkerValue(isoString: ""))
        XCTAssertNil(TimeMarkerValue(isoString: "not-a-date"))
        let value = TimeMarkerValue(isoString: "2026-04-30T13:00:00Z")
        XCTAssertNotNil(value?.dateValue)
    }

    func testPayloadAccessors() {
        let date = Date(timeIntervalSince1970: 1_777_000_000)
        XCTAssertEqual(TimeMarkerValue.date(date).dateValue, date)
        XCTAssertNil(TimeMarkerValue.date(date).numberValue)
        XCTAssertEqual(TimeMarkerValue.number(7).numberValue, 7)
        XCTAssertNil(TimeMarkerValue.number(7).textValue)
        XCTAssertEqual(TimeMarkerValue.text("x").textValue, "x")
        XCTAssertNil(TimeMarkerValue.text("x").dateValue)
    }
}

// MARK: - Vehicle id parsing (web `Number` + `Number.isFinite`)

final class AlertContextVehicleIDTests: XCTestCase {
    func testNilAndEmptyAreNil() {
        XCTAssertNil(AlertContextReducer.parseVehicleID(nil))
        XCTAssertNil(AlertContextReducer.parseVehicleID(""))
        XCTAssertNil(AlertContextReducer.parseVehicleID("   "))
    }

    func testIntegerParse() {
        XCTAssertEqual(AlertContextReducer.parseVehicleID("12"), 12)
        XCTAssertEqual(AlertContextReducer.parseVehicleID(" 12 "), 12)
        XCTAssertEqual(AlertContextReducer.parseVehicleID("-3"), -3)
    }

    func testFiniteDecimalTruncates() {
        XCTAssertEqual(AlertContextReducer.parseVehicleID("12.9"), 12)
    }

    func testNonNumericIsNil() {
        XCTAssertNil(AlertContextReducer.parseVehicleID("abc"), "web Number('abc') → NaN → null")
    }
}

// MARK: - AlertContextReducer (web useAlertContext useMemo)

final class AlertContextReducerTests: XCTestCase {
    private let iso = "2026-04-30T13:00:00Z"

    func testEmptyParamsResolveToEmptyContext() {
        let context = AlertContextReducer.resolve(.none)
        XCTAssertNil(context.vehicleID)
        XCTAssertNil(context.timestamp)
        XCTAssertNil(context.signal)
        XCTAssertNil(context.timeWindow)
        XCTAssertFalse(context.hasContext)
        XCTAssertNil(context.markerValue)
    }

    func testTimestampProducesCenteredWindow() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(timestamp: iso))
        let parsed = try? XCTUnwrap(TimeMarkerDateParser.parse(iso))
        let window = try? XCTUnwrap(context.timeWindow)
        XCTAssertEqual(window?.from, parsed?.addingTimeInterval(-30 * 60))
        XCTAssertEqual(window?.to, parsed?.addingTimeInterval(30 * 60))
        XCTAssertTrue(context.hasContext)
        XCTAssertEqual(context.markerValue, parsed.map(TimeMarkerValue.date))
    }

    func testEmptyTimestampIsPresentButHasNoWindowOrMarker() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(timestamp: ""))
        XCTAssertEqual(context.timestamp, "")
        XCTAssertNil(context.timeWindow, "web `if (t)` is falsy for '' → no window")
        XCTAssertNil(context.markerValue, "no parseable timestamp → no marker (web x == '')")
        XCTAssertTrue(context.hasContext, "web hasContext uses `t != null`; '' is present")
    }

    func testUnparseableTimestampHasNoWindowButHasContext() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(timestamp: "not-a-date"))
        XCTAssertNil(context.timeWindow)
        XCTAssertNil(context.markerValue)
        XCTAssertTrue(context.hasContext)
    }

    func testVehicleIDAloneSetsContext() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(vehicleID: "5"))
        XCTAssertEqual(context.vehicleID, 5)
        XCTAssertTrue(context.hasContext)
        XCTAssertNil(context.markerValue)
    }

    func testSignalAloneSetsContext() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(signal: "BatteryLevel"))
        XCTAssertEqual(context.signal, "BatteryLevel")
        XCTAssertTrue(context.hasContext)
    }

    func testFullContextCarriesAllFields() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(
            vehicleID: "12",
            timestamp: iso,
            signal: "BatteryLevel"
        ))
        XCTAssertEqual(context.vehicleID, 12)
        XCTAssertEqual(context.signal, "BatteryLevel")
        XCTAssertNotNil(context.timeWindow)
        XCTAssertNotNil(context.markerValue)
        XCTAssertTrue(context.hasContext)
    }

    func testCustomWindowHalfWidth() {
        let context = AlertContextReducer.resolve(
            TimeMarkerParams(timestamp: iso),
            windowHalfWidth: 60
        )
        let parsed = try? XCTUnwrap(TimeMarkerDateParser.parse(iso))
        XCTAssertEqual(context.timeWindow?.from, parsed?.addingTimeInterval(-60))
        XCTAssertEqual(context.timeWindow?.to, parsed?.addingTimeInterval(60))
    }
}

// MARK: - TimeMarkerWindow

final class TimeMarkerWindowTests: XCTestCase {
    func testRangeIsOrdered() {
        let from = Date(timeIntervalSince1970: 1000)
        let to = Date(timeIntervalSince1970: 2000)
        XCTAssertEqual(TimeMarkerWindow(from: from, to: to).range, from ... to)
        XCTAssertEqual(TimeMarkerWindow(from: to, to: from).range, from ... to)
    }

    func testISOAccessorsRoundTrip() {
        let from = Date(timeIntervalSince1970: 1_777_000_000)
        let to = from.addingTimeInterval(3600)
        let window = TimeMarkerWindow(from: from, to: to)
        XCTAssertEqual(TimeMarkerDateParser.parse(window.fromISO), from)
        XCTAssertEqual(TimeMarkerDateParser.parse(window.toISO), to)
    }
}

// MARK: - Meta (diagnostics slug)

final class TimeMarkerSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(TimeMarkerSurface.slug, "TimeMarker")
    }
}
