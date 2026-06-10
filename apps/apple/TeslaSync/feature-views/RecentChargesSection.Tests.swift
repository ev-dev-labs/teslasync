//
//  RecentChargesSection.Tests.swift
//  TeslaSync — P4 feature view · 0296 · RecentChargesSection (Apple)
//
//  Unit coverage for the RecentChargesSection surface:
//    • Adapter — the cell formatters (fmtNumber half-up + grouping, fmtInt, the JS-template SOC
//      number, the SI Wh → kWh energy cell, the durationStr composition, the formatCurrency cell,
//      the SOC battery cell, the formatDateTime port + ISO parsing), the five-column metadata
//      (order / labels / sortable / cell / sort key / comparator) and the row projection.
//    • State holder — `RecentChargesSectionProjector` phase resolution across loading / error /
//      empty (nil + []) / data, the `RecentChargesSectionModel` wiring, the stale auto-refresh,
//      and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver row-summary content.
//    • Render — a per-state ImageRenderer smoke pass (data / loading / empty / error / stale /
//      offline) proving every state lays out.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryRecentChargesSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Number / integer / JS-number formatting

final class RecentChargesNumberFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testNumberHalfUpAndGrouping() {
        XCTAssertEqual(RecentChargesFormat.number(12.5, decimals: 2, locale: enUS), "12.50")
        XCTAssertEqual(RecentChargesFormat.number(2.5, decimals: 0, locale: enUS), "3")
        XCTAssertEqual(RecentChargesFormat.number(1234.5, decimals: 1, locale: enUS), "1,234.5")
    }

    func testIntegerIsZeroFractionNumber() {
        XCTAssertEqual(RecentChargesFormat.integer(5, locale: enUS), "5")
        XCTAssertEqual(RecentChargesFormat.integer(59.4, locale: enUS), "59")
    }

    func testJSNumberDropsIntegralFractionAndKeepsDecimals() {
        XCTAssertEqual(RecentChargesFormat.jsNumber(75), "75")
        XCTAssertEqual(RecentChargesFormat.jsNumber(75.0), "75")
        XCTAssertEqual(RecentChargesFormat.jsNumber(20.5), "20.5")
        XCTAssertEqual(RecentChargesFormat.jsNumber(0), "0")
    }
}

// MARK: - Energy / duration / currency / battery cells

final class RecentChargesCellFormatTests: XCTestCase {
    private let metric = RecentChargesFormatting(currencySymbol: "$", currencyPrecision: 2, locale: "en_US")

    func testEnergyConvertsWhToKWhAtGlobalPrecisionWithUnit() {
        XCTAssertEqual(RecentChargesFormat.energyKWh(wh: 12500, formatting: metric), "12.50 kWh")
        XCTAssertEqual(RecentChargesFormat.energyKWh(wh: 42300, formatting: metric), "42.30 kWh")
    }

    func testEnergyNilCoalescesToZero() {
        XCTAssertEqual(RecentChargesFormat.energyKWh(wh: nil, formatting: metric), "0.00 kWh")
    }

    func testDurationHoursAndMinutes() {
        XCTAssertEqual(RecentChargesFormat.duration(minutes: 65, locale: metric.resolvedLocale), "1h 5m")
        XCTAssertEqual(RecentChargesFormat.duration(minutes: 45, locale: metric.resolvedLocale), "45m")
        XCTAssertEqual(RecentChargesFormat.duration(minutes: 125, locale: metric.resolvedLocale), "2h 5m")
        XCTAssertEqual(RecentChargesFormat.duration(minutes: 0, locale: metric.resolvedLocale), "0m")
    }

    func testCurrencySymbolPrefixAndPrecisionElseDash() {
        XCTAssertEqual(RecentChargesFormat.currency(amount: 8.4, formatting: metric), "$8.40")
        XCTAssertEqual(RecentChargesFormat.currency(amount: nil, formatting: metric), "—")
        let euro = RecentChargesFormatting(currencySymbol: "€", currencyPrecision: 2, locale: "en_US")
        XCTAssertEqual(RecentChargesFormat.currency(amount: 2.5, formatting: euro), "€2.50")
    }

    func testBatteryRangeVsStartOnly() {
        XCTAssertEqual(RecentChargesFormat.battery(startSocPct: 20, endSocPct: 80), "20% → 80%")
        XCTAssertEqual(RecentChargesFormat.battery(startSocPct: 64, endSocPct: nil), "64%")
        XCTAssertEqual(RecentChargesFormat.battery(startSocPct: 20.5, endSocPct: 80), "20.5% → 80%")
    }
}

// MARK: - Date formatting + ISO parsing

final class RecentChargesDateFormatTests: XCTestCase {
    private let formatting = RecentChargesFormatting(locale: "en_US", timeZoneIdentifier: "UTC")

    func testDateTimeRendersYearMonthMinute() {
        let text = RecentChargesFormat.dateTime(iso: "2026-04-04T15:45:00Z", formatting: formatting)
        XCTAssertTrue(text.contains("2026"), text)
        XCTAssertTrue(text.contains("Apr"), text)
        XCTAssertTrue(text.contains("45"), text)
    }

    func testDateTimeNilEmptyAndInvalidRenderDash() {
        XCTAssertEqual(RecentChargesFormat.dateTime(iso: nil, formatting: formatting), "—")
        XCTAssertEqual(RecentChargesFormat.dateTime(iso: "", formatting: formatting), "—")
        XCTAssertEqual(RecentChargesFormat.dateTime(iso: "not-a-date", formatting: formatting), "—")
    }

    func testParseISOWithAndWithoutFractionalSeconds() {
        XCTAssertNotNil(RecentChargesFormat.parseISO("2026-04-04T15:45:00Z"))
        XCTAssertNotNil(RecentChargesFormat.parseISO("2026-04-04T15:45:00.123Z"))
        XCTAssertNil(RecentChargesFormat.parseISO("nope"))
    }
}

// MARK: - Column metadata

final class RecentChargesColumnTests: XCTestCase {
    private let row = RecentChargesRow(
        id: 1, date: "Apr 4", energy: "42.30 kWh", energySortKey: 42300,
        duration: "1h 5m", cost: "$8.40", battery: "20% → 80%"
    )

    func testColumnOrderMatchesWebComposition() {
        XCTAssertEqual(RecentChargesColumn.allCases, [.date, .energy, .duration, .cost, .battery])
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(RecentChargesColumn.date.labelKey, "common.date")
        XCTAssertEqual(RecentChargesColumn.energy.labelFallback, "Energy")
        XCTAssertEqual(RecentChargesColumn.battery.labelKey, "common.battery")
    }

    func testOnlyEnergyIsSortable() {
        XCTAssertTrue(RecentChargesColumn.energy.isSortable)
        for column in RecentChargesColumn.allCases where column != .energy {
            XCTAssertFalse(column.isSortable, "\(column) must not be sortable")
            XCTAssertNil(column.makeComparator())
            XCTAssertNil(column.sortKey(row))
        }
    }

    func testCellMapping() {
        XCTAssertEqual(RecentChargesColumn.date.cell(row), "Apr 4")
        XCTAssertEqual(RecentChargesColumn.energy.cell(row), "42.30 kWh")
        XCTAssertEqual(RecentChargesColumn.duration.cell(row), "1h 5m")
        XCTAssertEqual(RecentChargesColumn.cost.cell(row), "$8.40")
        XCTAssertEqual(RecentChargesColumn.battery.cell(row), "20% → 80%")
    }

    func testEnergyComparatorOrdersBySortKeyNotText() {
        let low = RecentChargesRow(
            id: 2, date: "", energy: "6.20 kWh", energySortKey: 6200,
            duration: "", cost: "", battery: ""
        )
        let comparator = RecentChargesColumn.energy.makeComparator()
        XCTAssertNotNil(comparator)
        XCTAssertEqual(comparator?(low, row), .orderedAscending)
        XCTAssertEqual(comparator?(row, low), .orderedDescending)
        XCTAssertEqual(comparator?(row, row), .orderedSame)
        XCTAssertEqual(RecentChargesColumn.energy.sortKey(row), 42300)
    }
}

// MARK: - Projection

final class RecentChargesProjectionTests: XCTestCase {
    private let formatting = RecentChargesFormatting(currencySymbol: "$", currencyPrecision: 2, locale: "en_US")

    func testMakeProjectsEachSessionRow() {
        let sessions = [
            RecentChargesSession(
                id: 7, startTs: "2026-04-04T15:45:00Z", totalEnergyAddedWh: 42300,
                durationMin: 65, cost: 8.4, startSocPct: 20, endSocPct: 80
            ),
            RecentChargesSession(
                id: 9, startTs: nil, totalEnergyAddedWh: 6200,
                durationMin: 125, cost: nil, startSocPct: 64, endSocPct: nil
            )
        ]
        let rows = RecentChargesProjection.make(sessions: sessions, formatting: formatting).rows
        XCTAssertEqual(rows.map(\.id), [7, 9])
        XCTAssertEqual(rows[0].energy, "42.30 kWh")
        XCTAssertEqual(rows[0].energySortKey, 42300)
        XCTAssertEqual(rows[0].duration, "1h 5m")
        XCTAssertEqual(rows[0].cost, "$8.40")
        XCTAssertEqual(rows[0].battery, "20% → 80%")
        XCTAssertEqual(rows[1].date, "—")
        XCTAssertEqual(rows[1].cost, "—")
        XCTAssertEqual(rows[1].battery, "64%")
        XCTAssertEqual(rows[1].energySortKey, 6200)
    }

    func testMakeEmptyYieldsNoRows() {
        XCTAssertTrue(RecentChargesProjection.make(sessions: [], formatting: formatting).rows.isEmpty)
    }
}

// MARK: - Projector: phase resolution

final class RecentChargesProjectorTests: XCTestCase {
    private func session() -> RecentChargesSession {
        RecentChargesSession(id: 1, totalEnergyAddedWh: 10000, durationMin: 30, startSocPct: 30, endSocPct: 60)
    }

    func testErrorTakesPrecedenceOverData() {
        let input = RecentChargesSectionInput(sessions: [session()], errorMessage: "boom")
        XCTAssertEqual(RecentChargesSectionProjector.resolve(input).phase, .error("boom"))
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = RecentChargesSectionInput(sessions: [session()], isLoading: true)
        XCTAssertEqual(RecentChargesSectionProjector.resolve(input).phase, .loading)
    }

    func testEmptyWhenSessionsNil() {
        XCTAssertEqual(RecentChargesSectionProjector.resolve(RecentChargesSectionInput()).phase, .empty)
    }

    func testEmptyWhenSessionsEmptyArray() {
        XCTAssertEqual(RecentChargesSectionProjector.resolve(RecentChargesSectionInput(sessions: [])).phase, .empty)
    }

    func testDataWhenSessionsPresent() {
        let resolved = RecentChargesSectionProjector.resolve(RecentChargesSectionInput(sessions: [session()]))
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.rows.count, 1)
    }

    func testEmptyErrorMessageIsNotError() {
        let resolved = RecentChargesSectionProjector.resolve(
            RecentChargesSectionInput(sessions: nil, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .empty)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class RecentChargesSectionModelTests: XCTestCase {
    private func makeModel(
        _ input: RecentChargesSectionInput,
        telemetry: RecentChargesSectionTelemetry = OSLogRecentChargesSectionTelemetry()
    ) -> (RecentChargesSectionModel, InMemoryRecentChargesSource) {
        let source = InMemoryRecentChargesSource(initial: input)
        let model = RecentChargesSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func session() -> RecentChargesSession {
        RecentChargesSession(id: 1, totalEnergyAddedWh: 10000, durationMin: 30, startSocPct: 30, endSocPct: 60)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = RecentChargesSpyTelemetry()
        let (model, source) = makeModel(RecentChargesSectionInput(sessions: [session()]), telemetry: spy)
        model.start()
        model.start()
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(spy.surfaces, [RecentChargesSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RecentChargesSectionInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjectionAndConnection() {
        let (model, source) = makeModel(RecentChargesSectionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(RecentChargesSectionInput(sessions: [session()], connection: .offline))
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(RecentChargesSectionInput(sessions: [session()]))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(RecentChargesSectionInput(sessions: [session()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(RecentChargesSectionInput(sessions: [session()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "no re-refresh while already stale")
    }
}

// MARK: - Accessibility summary

final class RecentChargesAccessibilityTests: XCTestCase {
    func testRowSummaryPairsLabelsAndValues() {
        let summary = RecentChargesAccessibility.rowSummary(
            labels: ["Date", "Energy", "Battery"],
            values: ["Apr 4", "42.30 kWh", "20% → 80%"]
        )
        XCTAssertEqual(summary, "Date Apr 4, Energy 42.30 kWh, Battery 20% → 80%")
    }

    func testRowSummaryDropsEmptyFragments() {
        let summary = RecentChargesAccessibility.rowSummary(labels: ["Cost", "Battery"], values: ["", "64%"])
        XCTAssertEqual(summary, "Cost, Battery 64%")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Per-state render smoke (every state lays out)

@MainActor
final class RecentChargesSectionRenderTests: XCTestCase {
    private func render(_ input: RecentChargesSectionInput) throws {
        let source = InMemoryRecentChargesSource(initial: input)
        let model = RecentChargesSectionModel(source: source)
        model.start()
        let view = RecentChargesSection(model: model).frame(width: 620, height: 420)
        let renderer = ImageRenderer(content: view)
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage)
        #endif
    }

    func testEveryStateRenders() throws {
        let sessions = [
            RecentChargesSession(
                id: 1, startTs: "2026-04-04T15:45:00Z", totalEnergyAddedWh: 42300,
                durationMin: 65, cost: 8.4, startSocPct: 20, endSocPct: 80
            )
        ]
        try render(RecentChargesSectionInput(isLoading: true))
        try render(RecentChargesSectionInput(sessions: sessions))
        try render(RecentChargesSectionInput(sessions: []))
        try render(RecentChargesSectionInput(errorMessage: "503"))
        try render(RecentChargesSectionInput(sessions: sessions, connection: .stale))
        try render(RecentChargesSectionInput(sessions: sessions, connection: .offline))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RecentChargesSpyTelemetry: RecentChargesSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
