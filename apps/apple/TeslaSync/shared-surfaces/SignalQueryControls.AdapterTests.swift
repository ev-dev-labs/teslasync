//
//  SignalQueryControls.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  Adapter-tier coverage — the native port of the web `SignalQueryControls.adapter.test.ts`
//  (`adaptSignalHistoryPoint` / `adaptSignalHistoryResp`) plus the value / timestamp formatting
//  helpers. Pure + view-free, so they run in the TeslaSync(/-macOS) XCTest targets with no network.
//

import XCTest
@testable import TeslaSync

// MARK: - adaptSignalHistoryPoint (web per-kind mapping)

@MainActor final class SignalQueryAdaptPointTests: XCTestCase {
    private func point(_ value: SignalHistoryValue, kind: String = "ValueKindDouble") -> SignalHistoryPoint {
        SignalHistoryPoint(ts: "2026-05-13T01:04:51.177284Z", kind: kind, value: value)
    }

    func testMapsDoubleToValueNum() {
        let row = SignalQueryHistoryAdapter.point(point(.number(43_343_694.999)), signal: "Odometer")
        XCTAssertEqual(row, SignalLogEntry(
            createdAt: "2026-05-13T01:04:51.177284Z",
            signal: "Odometer",
            valueNum: 43_343_694.999
        ))
    }

    func testMapsInt64ToValueNum() {
        let row = SignalQueryHistoryAdapter.point(point(.number(42), kind: "ValueKindInt64"), signal: "Soc")
        XCTAssertEqual(row.valueNum, 42)
        XCTAssertNil(row.valueStr)
        XCTAssertNil(row.valueBool)
    }

    func testMapsBoolToValueBool() {
        let row = SignalQueryHistoryAdapter.point(point(.bool(true), kind: "ValueKindBool"), signal: "Locked")
        XCTAssertEqual(row.valueBool, true)
        XCTAssertNil(row.valueNum)
        XCTAssertNil(row.valueStr)
    }

    func testMapsBoolFalseToValueBoolNotNil() {
        let row = SignalQueryHistoryAdapter.point(point(.bool(false), kind: "ValueKindBool"), signal: "Locked")
        XCTAssertEqual(row.valueBool, false)
    }

    func testMapsStringToValueStr() {
        let row = SignalQueryHistoryAdapter.point(point(.string("Driving"), kind: "ValueKindString"), signal: "Gear")
        XCTAssertEqual(row.valueStr, "Driving")
        XCTAssertNil(row.valueNum)
        XCTAssertNil(row.valueBool)
    }

    func testMapsEnumLabelToValueStr() {
        let row = SignalQueryHistoryAdapter.point(
            point(.string("CHARGING"), kind: "ValueKindEnum"), signal: "ChargeState"
        )
        XCTAssertEqual(row.valueStr, "CHARGING")
    }

    func testMapsTimeToValueStr() {
        let row = SignalQueryHistoryAdapter.point(
            SignalHistoryPoint(
                ts: "2026-05-13T05:06:43Z",
                kind: "ValueKindTime",
                value: .string("2026-05-13T05:06:43Z")
            ),
            signal: "TripStart"
        )
        XCTAssertEqual(row.valueStr, "2026-05-13T05:06:43Z")
    }

    func testPassesTimestampThroughVerbatim() {
        // Invalid-Date regression: `ts` is preserved into `createdAt` and parses to a real instant.
        let row = SignalQueryHistoryAdapter.point(point(.number(1.0), kind: "ValueKindFloat"), signal: "X")
        XCTAssertEqual(row.createdAt, "2026-05-13T01:04:51.177284Z")
        XCTAssertNotEqual(SignalTimestamp.formatTimestampMs(row.createdAt, timeZone: .utc), "—")
    }

    func testMapsNonFiniteNumbersToNil() {
        XCTAssertNil(SignalQueryHistoryAdapter.point(point(.number(.nan)), signal: "X").valueNum)
        XCTAssertNil(SignalQueryHistoryAdapter.point(point(.number(.infinity)), signal: "X").valueNum)
        XCTAssertNil(SignalQueryHistoryAdapter.point(point(.number(-.infinity)), signal: "X").valueNum)
    }

    func testMapsNullToAllNils() {
        let row = SignalQueryHistoryAdapter.point(point(.null), signal: "X")
        XCTAssertNil(row.valueNum)
        XCTAssertNil(row.valueStr)
        XCTAssertNil(row.valueBool)
    }
}

// MARK: - adaptSignalHistoryResp (web envelope mapping)

@MainActor final class SignalQueryAdaptRespTests: XCTestCase {
    private func point(_ value: Double) -> SignalHistoryPoint {
        SignalHistoryPoint(ts: "2026-05-13T01:04:51.177284Z", kind: "ValueKindDouble", value: .number(value))
    }

    func testReturnsEmptyForNilResponse() {
        XCTAssertEqual(SignalQueryHistoryAdapter.response(nil), [])
    }

    func testReturnsEmptyWhenDataMissing() {
        XCTAssertEqual(SignalQueryHistoryAdapter.response(SignalHistoryResp(signal: "Odometer")), [])
    }

    func testUsesEnvelopeSignalForEveryRow() {
        let resp = SignalHistoryResp(
            vehicleID: 1,
            signal: "Odometer",
            expectedKind: "ValueKindFloat",
            count: 2,
            data: [point(1), point(2)]
        )
        let rows = SignalQueryHistoryAdapter.response(resp)
        XCTAssertEqual(rows.count, 2)
        XCTAssertTrue(rows.allSatisfy { $0.signal == "Odometer" })
        XCTAssertEqual(rows.map(\.valueNum), [1, 2])
    }

    func testFullTypedResponseProducesRenderableRows() {
        let resp = SignalHistoryResp(
            vehicleID: 1,
            signal: "Odometer",
            expectedKind: "ValueKindFloat",
            from: "2026-05-12T05:06:43.714715484Z",
            to: "2026-05-13T05:06:43.714715484Z",
            count: 2,
            data: [
                SignalHistoryPoint(
                    ts: "2026-05-13T01:04:51.177284Z", kind: "ValueKindDouble", value: .number(43_343_694.999)
                ),
                SignalHistoryPoint(
                    ts: "2026-05-13T01:05:40.191573Z", kind: "ValueKindDouble", value: .number(43_343_861.59125)
                )
            ]
        )
        let rows = SignalQueryHistoryAdapter.response(resp)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].createdAt, "2026-05-13T01:04:51.177284Z")
        XCTAssertEqual(rows[0].valueNum, 43_343_694.999)
    }
}

// MARK: - Value typing + formatting (web `getValueType` / `formatValue`)

@MainActor final class SignalQueryValueFormatTests: XCTestCase {
    func testValueTypePriority() {
        XCTAssertEqual(
            SignalQueryValueFormat.valueType(of: SignalLogEntry(createdAt: "t", signal: "s", valueNum: 1)), .num
        )
        XCTAssertEqual(
            SignalQueryValueFormat.valueType(of: SignalLogEntry(createdAt: "t", signal: "s", valueStr: "x")), .str
        )
        XCTAssertEqual(
            SignalQueryValueFormat.valueType(of: SignalLogEntry(createdAt: "t", signal: "s", valueBool: false)), .bool
        )
        XCTAssertEqual(
            SignalQueryValueFormat.valueType(of: SignalLogEntry(createdAt: "t", signal: "s")), .null
        )
    }

    func testFormatValue() {
        XCTAssertEqual(
            SignalQueryValueFormat.formatValue(of: SignalLogEntry(createdAt: "t", signal: "s", valueNum: 42)), "42"
        )
        XCTAssertEqual(
            SignalQueryValueFormat.formatValue(
                of: SignalLogEntry(createdAt: "t", signal: "s", valueNum: 43_343_694.999)
            ),
            "43343694.999"
        )
        XCTAssertEqual(
            SignalQueryValueFormat.formatValue(of: SignalLogEntry(
                createdAt: "t",
                signal: "s",
                valueStr: "Drive"
            )), "Drive"
        )
        XCTAssertEqual(
            SignalQueryValueFormat.formatValue(of: SignalLogEntry(createdAt: "t", signal: "s", valueBool: true)), "true"
        )
        XCTAssertEqual(
            SignalQueryValueFormat.formatValue(of: SignalLogEntry(
                createdAt: "t",
                signal: "s",
                valueBool: false
            )), "false"
        )
        XCTAssertEqual(SignalQueryValueFormat.formatValue(of: SignalLogEntry(createdAt: "t", signal: "s")), "—")
    }

    func testFormatNumberMatchesJSStringSemantics() {
        XCTAssertEqual(SignalQueryValueFormat.formatNumber(42), "42")
        XCTAssertEqual(SignalQueryValueFormat.formatNumber(1), "1")
        XCTAssertEqual(SignalQueryValueFormat.formatNumber(0.5), "0.5")
        XCTAssertEqual(SignalQueryValueFormat.formatNumber(-3), "-3")
        XCTAssertEqual(SignalQueryValueFormat.formatNumber(.nan), "—")
    }
}

// MARK: - Timestamps (web `formatTimestampMs` / `toLocalDatetimeStr`)

@MainActor final class SignalQueryTimestampTests: XCTestCase {
    func testFormatsFractionalSecondsToMilliseconds() {
        XCTAssertEqual(
            SignalTimestamp.formatTimestampMs("2026-05-13T01:04:51.177284Z", timeZone: .utc),
            "2026-05-13 01:04:51.177"
        )
    }

    func testFormatsWholeSecondInstant() {
        XCTAssertEqual(
            SignalTimestamp.formatTimestampMs("2026-05-13T05:06:43Z", timeZone: .utc),
            "2026-05-13 05:06:43.000"
        )
    }

    func testReturnsEmDashForInvalidInstant() {
        XCTAssertEqual(SignalTimestamp.formatTimestampMs("not-a-date", timeZone: .utc), "—")
    }

    func testToLocalDatetimeStrRoundTripShape() {
        let date = Date(timeIntervalSince1970: 1_715_562_291)
        XCTAssertEqual(SignalTimestamp.toLocalDatetimeStr(date, timeZone: .utc), "2024-05-13T01:04:51")
    }
}

private extension TimeZone {
    static let utc = TimeZone(identifier: "UTC")!
}
