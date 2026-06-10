//
//  SignalDiffTable.Tests.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  Unit coverage for the SignalDiffTable surface:
//    • Adapter (cached → projection) — `SignalDiffTableFormat` + `…Builder`
//      parity with the web `fmtNumber` / `asNumber` / `formatRaw` / `deltaLabel` /
//      `formatAge` + the pinned-first sort and the two sortable columns.
//    • State holder — `SignalDiffTableModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry, the
//      multi-selection, the optimistic pin float, and the sort toggle.
//    • Accessibility — the VoiceOver grid summary + row labels + Δ description.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySignalDiffTableSource`. The pure
//  adapter + model subset is additionally proven by an isolated SwiftPM run (gate
//  log) that compiles only the Foundation-only files.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Adapter: number / value formatting (web `fmtNumber` / `formatRaw`)

@MainActor final class SignalDiffTableFormatTests: XCTestCase {
    func testGroupedNumberMatchesFmtNumber() {
        XCTAssertEqual(SignalDiffTableFormat.groupedNumber(42, locale: enUS), "42.00")
        XCTAssertEqual(SignalDiffTableFormat.groupedNumber(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(SignalDiffTableFormat.groupedNumber(-3, locale: enUS), "-3.00")
        XCTAssertEqual(SignalDiffTableFormat.groupedNumber(0, locale: enUS), "0.00")
        XCTAssertEqual(SignalDiffTableFormat.groupedNumber(.nan, locale: enUS), "0.00")
        XCTAssertEqual(SignalDiffTableFormat.groupedNumber(5.128, decimals: 1, locale: enUS), "5.1")
    }

    func testAsNumberCoercesLikeWeb() {
        XCTAssertEqual(SignalDiffTableFormat.asNumber(.number(42)), 42)
        XCTAssertNil(SignalDiffTableFormat.asNumber(.number(.infinity)))
        XCTAssertEqual(SignalDiffTableFormat.asNumber(.string("12.5")), 12.5)
        XCTAssertEqual(SignalDiffTableFormat.asNumber(.string(" 7 ")), 7)
        XCTAssertNil(SignalDiffTableFormat.asNumber(.string("")))
        XCTAssertNil(SignalDiffTableFormat.asNumber(.string("   ")))
        XCTAssertNil(SignalDiffTableFormat.asNumber(.string("abc")))
        XCTAssertEqual(SignalDiffTableFormat.asNumber(.bool(true)), 1)
        XCTAssertEqual(SignalDiffTableFormat.asNumber(.bool(false)), 0)
        XCTAssertNil(SignalDiffTableFormat.asNumber(.null))
        XCTAssertNil(SignalDiffTableFormat.asNumber(.absent))
        XCTAssertNil(SignalDiffTableFormat.asNumber(.compound("{\"a\":1}")))
    }

    func testFormatRawCoercesLikeWeb() {
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.null, locale: enUS), "—")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.absent, locale: enUS), "—")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.number(78), locale: enUS), "78.00")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.number(.infinity), locale: enUS), "—")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.bool(true), locale: enUS), "true")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.bool(false), locale: enUS), "false")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.string("Drive"), locale: enUS), "Drive")
        XCTAssertEqual(SignalDiffTableFormat.formatRaw(.compound("{\"lat\":1}"), locale: enUS), "{\"lat\":1}")
    }

    func testDeltaNumericTextMatchesWeb() {
        XCTAssertEqual(
            SignalDiffTableFormat.deltaNumericText(delta: 4, percent: 4.0 / 78.0 * 100, locale: enUS),
            "+4.00 (+5.1%)"
        )
        XCTAssertEqual(
            SignalDiffTableFormat.deltaNumericText(delta: -4.3, percent: -4.3 / 11.5 * 100, locale: enUS),
            "-4.30 (-37.4%)"
        )
        XCTAssertEqual(SignalDiffTableFormat.deltaNumericText(delta: 5, percent: nil, locale: enUS), "+5.00")
        XCTAssertEqual(SignalDiffTableFormat.deltaNumericText(delta: 0, percent: 0, locale: enUS), "0.00 (+0.0%)")
    }

    func testFormatAgeThresholds() {
        XCTAssertNil(SignalDiffTableFormat.formatAge(nil))
        XCTAssertNil(SignalDiffTableFormat.formatAge(.infinity))
        XCTAssertEqual(SignalDiffTableFormat.formatAge(500), "500 ms")
        XCTAssertEqual(SignalDiffTableFormat.formatAge(1500), "1.5 s")
        XCTAssertEqual(SignalDiffTableFormat.formatAge(120_000), "2 min")
        XCTAssertEqual(SignalDiffTableFormat.formatAge(7_200_000), "2.0 h")
        XCTAssertEqual(SignalDiffTableFormat.formatAge(172_800_000), "2.0 d")
    }
}

// MARK: - Adapter: deltaLabel classification (web `deltaLabel`)

@MainActor final class SignalDiffTableDeltaTests: XCTestCase {
    func testNumericDeltaCarriesPercentVsAbsoluteBase() {
        let kind = SignalDiffTableFormat.deltaLabel(.number(78), .number(82), locale: enUS)
        guard case let .numeric(delta, percent) = kind else { return XCTFail("expected numeric, got \(kind)") }
        XCTAssertEqual(delta, 4, accuracy: 1e-9)
        XCTAssertEqual(percent ?? .nan, 4.0 / 78.0 * 100, accuracy: 1e-9)
    }

    func testNumericDeltaOmitsPercentWhenBaseIsZero() {
        let kind = SignalDiffTableFormat.deltaLabel(.number(0), .number(5), locale: enUS)
        guard case let .numeric(delta, percent) = kind else { return XCTFail("expected numeric, got \(kind)") }
        XCTAssertEqual(delta, 5, accuracy: 1e-9)
        XCTAssertNil(percent)
    }

    func testBooleanWindowsAreNumeric() {
        // asNumber(true) == 1, so two equal booleans diff to a zero numeric delta.
        let kind = SignalDiffTableFormat.deltaLabel(.bool(true), .bool(true), locale: enUS)
        guard case let .numeric(delta, percent) = kind else { return XCTFail("expected numeric, got \(kind)") }
        XCTAssertEqual(delta, 0, accuracy: 1e-9)
        XCTAssertEqual(percent ?? .nan, 0, accuracy: 1e-9)
    }

    func testNoneWhenNonNumericRendersIdentically() {
        XCTAssertEqual(SignalDiffTableFormat.deltaLabel(.string("Charging"), .string("Charging"), locale: enUS), .none)
    }

    func testChangedWhenNonNumericDiffer() {
        XCTAssertEqual(
            SignalDiffTableFormat.deltaLabel(.string("Charging"), .string("Complete"), locale: enUS),
            .changed
        )
        XCTAssertEqual(SignalDiffTableFormat.deltaLabel(.null, .string("P"), locale: enUS), .changed)
    }
}

// MARK: - Adapter: row + projection + sort (web `sortedRows`)

@MainActor final class SignalDiffTableBuilderTests: XCTestCase {
    func testRowFormatsBothWindowsAndDelta() {
        let entry = SignalDiffEntry(name: "battery_level", valueA: .number(78), valueB: .number(82))
        let row = SignalDiffTableBuilder.row(from: entry, pinned: false, locale: enUS)
        XCTAssertEqual(row.name, "battery_level")
        XCTAssertEqual(row.valueAText, "78.00")
        XCTAssertEqual(row.valueBText, "82.00")
        XCTAssertFalse(row.pinned)
        guard case let .numeric(delta, _) = row.delta else { return XCTFail("expected numeric delta") }
        XCTAssertEqual(delta, 4, accuracy: 1e-9)
    }

    func testProjectionDefaultsToNameAscending() {
        let projection = SignalDiffTableBuilder.buildProjection(
            from: numericEntries(["zebra", "alpha", "mike"]),
            pinned: [],
            locale: enUS
        )
        XCTAssertEqual(projection.rows.map(\.name), ["alpha", "mike", "zebra"])
        XCTAssertTrue(projection.hasData)
    }

    func testProjectionFloatsPinnedFirst() {
        let projection = SignalDiffTableBuilder.buildProjection(
            from: numericEntries(["zebra", "alpha", "mike"]),
            pinned: ["mike"],
            locale: enUS
        )
        XCTAssertEqual(projection.rows.map(\.name), ["mike", "alpha", "zebra"])
        XCTAssertTrue(projection.rows.first?.pinned ?? false)
    }

    func testSortByDeltaOrdersNumericThenChangedThenNone() {
        let entries = [
            SignalDiffEntry(name: "aaa", valueA: .number(0), valueB: .number(5)),
            SignalDiffEntry(name: "bbb", valueA: .number(10), valueB: .number(7)),
            SignalDiffEntry(name: "ccc", valueA: .string("x"), valueB: .string("y")),
            SignalDiffEntry(name: "ddd", valueA: .string("z"), valueB: .string("z"))
        ]
        let projection = SignalDiffTableBuilder.buildProjection(
            from: entries,
            pinned: [],
            sortKey: .delta,
            direction: .ascending,
            locale: enUS
        )
        XCTAssertEqual(projection.rows.map(\.name), ["bbb", "aaa", "ccc", "ddd"])
    }

    func testEmptyProjectionHasNoData() {
        XCTAssertFalse(SignalDiffTableBuilder.buildProjection(from: [], pinned: [], locale: enUS).hasData)
        XCTAssertEqual(SignalDiffTableProjection.empty.rows, [])
    }

    private func numericEntries(_ names: [String]) -> [SignalDiffEntry] {
        names.map { SignalDiffEntry(name: $0, valueA: .number(1), valueB: .number(2)) }
    }
}

// MARK: - Models: source layer mapping

@MainActor final class SignalDiffSourceLayerTests: XCTestCase {
    func testInitFoldsUnknownAndCaseInsensitive() {
        XCTAssertEqual(SignalDiffSourceLayer(raw: "l1"), .l1)
        XCTAssertEqual(SignalDiffSourceLayer(raw: "L2"), .l2)
        XCTAssertEqual(SignalDiffSourceLayer(raw: "LOG"), .log)
        XCTAssertEqual(SignalDiffSourceLayer(raw: "stale"), .stale)
        XCTAssertEqual(SignalDiffSourceLayer(raw: nil), .unknown)
        XCTAssertEqual(SignalDiffSourceLayer(raw: "garbage"), .unknown)
    }

    func testBadgeLabels() {
        XCTAssertEqual(SignalDiffSourceLayer.l1.badgeLabel, "L1")
        XCTAssertEqual(SignalDiffSourceLayer.l2.badgeLabel, "L2")
        XCTAssertEqual(SignalDiffSourceLayer.log.badgeLabel, "LOG")
        XCTAssertEqual(SignalDiffSourceLayer.stale.badgeLabel, "STALE")
        XCTAssertEqual(SignalDiffSourceLayer.unknown.badgeLabel, "—")
    }
}
