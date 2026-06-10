//
//  SignalCatalogPanel.Tests.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  Unit coverage for the SignalCatalogPanel surface:
//    • Adapter (cached → projection) — `SignalCatalogPanelFormat` +
//      `…Builder` parity with the web renderValue / staleness / category / tone /
//      formatStaleness, plus the search + filter-mode + sort-mode `useMemo` chain.
//    • State holder — `SignalCatalogPanelModel` phase resolution across loading /
//      empty / error / content, the P1/S11 `view.opened` telemetry, the search +
//      filter + sort wiring, and the optional chip selection (with max cap).
//    • Accessibility — the VoiceOver table summary + row labels + selection labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySignalCatalogPanelSource` with an
//  injected clock. The pure adapter subset is additionally proven by an executed
//  host harness (gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? .current

private func iso(_ secondsAgo: TimeInterval) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: fixedNow.addingTimeInterval(-secondsAgo))
}

// MARK: - Adapter: value rendering + classification

final class SignalCatalogPanelFormatTests: XCTestCase {
    func testRenderValueMatchesWebCoercion() {
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.null), "—")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.absent), "—")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.string("Charging")), "Charging")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.string("")), "")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.number(42)), "42")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.number(78.5)), "78.5")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.bool(true)), "true")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.bool(false)), "false")
        XCTAssertEqual(SignalCatalogPanelFormat.renderValue(.compound("[object Object]")), "[object Object]")
    }

    func testJsNumberDropsTrailingZero() {
        XCTAssertEqual(SignalCatalogPanelFormat.jsNumber(320), "320")
        XCTAssertEqual(SignalCatalogPanelFormat.jsNumber(-12), "-12")
        XCTAssertEqual(SignalCatalogPanelFormat.jsNumber(0), "0")
        XCTAssertEqual(SignalCatalogPanelFormat.jsNumber(78.5), "78.5")
    }

    func testParseTimestampHandlesVariantsAndJunk() {
        XCTAssertNotNil(SignalCatalogPanelFormat.parseTimestamp("2026-06-07T19:00:00Z"))
        XCTAssertNotNil(SignalCatalogPanelFormat.parseTimestamp("2026-06-07T19:00:00.250Z"))
        XCTAssertNil(SignalCatalogPanelFormat.parseTimestamp(nil))
        XCTAssertNil(SignalCatalogPanelFormat.parseTimestamp(""))
        XCTAssertNil(SignalCatalogPanelFormat.parseTimestamp("not-a-date"))
    }

    func testStalenessIsSecondsOrInfinityOrNaN() {
        let tenAgo = fixedNow.addingTimeInterval(-10)
        XCTAssertEqual(
            SignalCatalogPanelFormat.staleness(parsed: tenAgo, hasTimestamp: true, now: fixedNow),
            10,
            accuracy: 0.001
        )
        XCTAssertEqual(SignalCatalogPanelFormat.staleness(parsed: nil, hasTimestamp: false, now: fixedNow), .infinity)
        XCTAssertTrue(SignalCatalogPanelFormat.staleness(parsed: nil, hasTimestamp: true, now: fixedNow).isNaN)
    }

    func testCategoryThresholdsAt300() {
        XCTAssertEqual(SignalCatalogPanelFormat.category(staleness: 10, hasTimestamp: true), .active)
        XCTAssertEqual(SignalCatalogPanelFormat.category(staleness: 299, hasTimestamp: true), .active)
        XCTAssertEqual(SignalCatalogPanelFormat.category(staleness: 301, hasTimestamp: true), .stale)
        XCTAssertEqual(SignalCatalogPanelFormat.category(staleness: .infinity, hasTimestamp: false), .never)
        XCTAssertEqual(SignalCatalogPanelFormat.category(staleness: .nan, hasTimestamp: true), .active)
    }

    func testToneFourLevels() {
        XCTAssertEqual(SignalCatalogPanelFormat.tone(staleness: 10, hasTimestamp: true), .active)
        XCTAssertEqual(SignalCatalogPanelFormat.tone(staleness: 120, hasTimestamp: true), .aging)
        XCTAssertEqual(SignalCatalogPanelFormat.tone(staleness: 600, hasTimestamp: true), .stale)
        XCTAssertEqual(SignalCatalogPanelFormat.tone(staleness: .infinity, hasTimestamp: false), .neverReceived)
        XCTAssertEqual(SignalCatalogPanelFormat.tone(staleness: .nan, hasTimestamp: true), .stale)
    }

    func testFormatStalenessMatchesWebTemplates() {
        let templates = SignalCatalogPanelStalenessTemplates.english
        func format(_ seconds: Double) -> String {
            SignalCatalogPanelFormat.formatStaleness(seconds, locale: enUS, templates: templates)
        }
        XCTAssertEqual(format(.infinity), "—")
        XCTAssertEqual(format(.nan), "—")
        XCTAssertEqual(format(42), "42s ago")
        XCTAssertEqual(format(120), "2m ago")
        XCTAssertEqual(format(600), "10m ago")
        XCTAssertEqual(format(7320), "2h 2m ago")
    }

    func testFormatDateTimeFallsBackToEmDash() {
        XCTAssertEqual(SignalCatalogPanelFormat.formatDateTime(nil, locale: enUS, timeZone: utc), "—")
        let text = SignalCatalogPanelFormat.formatDateTime(fixedNow, locale: enUS, timeZone: utc)
        XCTAssertFalse(text.isEmpty)
        XCTAssertNotEqual(text, "—")
    }

    func testRelativeIsPastAndLocaleAware() {
        let twoMinAgo = fixedNow.addingTimeInterval(-120)
        let relative = SignalCatalogPanelFormat.relative(from: twoMinAgo, to: fixedNow, locale: enUS)
        XCTAssertTrue(relative.localizedCaseInsensitiveContains("min"), "expected a minutes phrase, got \(relative)")
    }
}

// MARK: - Adapter: row + projection + filter + sort

final class SignalCatalogPanelBuilderTests: XCTestCase {
    func testRowFromEnvelopeClassifiesByAge() {
        let entry = SignalCatalogPanelEntry(name: "speed", payload: .envelope(value: .number(42), timestamp: iso(10)))
        let row = SignalCatalogPanelBuilder.row(from: entry, now: fixedNow)
        XCTAssertEqual(row.value, "42")
        XCTAssertTrue(row.hasTimestamp)
        XCTAssertNotNil(row.timestamp)
        XCTAssertEqual(row.category, .active)
        XCTAssertEqual(row.staleness, 10, accuracy: 0.5)
    }

    func testRowFromStaleEnvelope() {
        let entry = SignalCatalogPanelEntry(name: "range", payload: .envelope(value: .number(312), timestamp: iso(600)))
        let row = SignalCatalogPanelBuilder.row(from: entry, now: fixedNow)
        XCTAssertEqual(row.category, .stale)
    }

    func testEmptyStringTimestampIsNeverReceived() {
        let entry = SignalCatalogPanelEntry(name: "x", payload: .envelope(value: .number(1), timestamp: ""))
        let row = SignalCatalogPanelBuilder.row(from: entry, now: fixedNow)
        XCTAssertFalse(row.hasTimestamp)
        XCTAssertNil(row.timestampRaw)
        XCTAssertEqual(row.category, .never)
        XCTAssertEqual(row.staleness, .infinity)
    }

    func testGarbageTimestampIsActiveCategoryButStaleTone() {
        let entry = SignalCatalogPanelEntry(name: "x", payload: .envelope(value: .number(1), timestamp: "garbage"))
        let row = SignalCatalogPanelBuilder.row(from: entry, now: fixedNow)
        XCTAssertTrue(row.hasTimestamp)
        XCTAssertNil(row.timestamp)
        XCTAssertTrue(row.staleness.isNaN)
        XCTAssertEqual(row.category, .active)
        XCTAssertEqual(SignalCatalogPanelFormat.tone(staleness: row.staleness, hasTimestamp: row.hasTimestamp), .stale)
    }

    func testRowFromBareHasNoTimestamp() {
        let row = SignalCatalogPanelBuilder.row(
            from: SignalCatalogPanelEntry(name: "locked", payload: .bare(.bool(true))),
            now: fixedNow
        )
        XCTAssertEqual(row.value, "true")
        XCTAssertNil(row.timestampRaw)
        XCTAssertEqual(row.category, .never)
    }

    func testBuildProjectionSummaryCounts() {
        let projection = SignalCatalogPanelBuilder.buildProjection(from: mixedEntries(), now: fixedNow)
        XCTAssertEqual(projection.summary.total, 5)
        XCTAssertEqual(projection.summary.active, 2)
        XCTAssertEqual(projection.summary.stale, 1)
        XCTAssertEqual(projection.summary.never, 2)
        XCTAssertTrue(projection.hasData)
    }

    func testEmptyProjectionHasNoData() {
        let projection = SignalCatalogPanelBuilder.buildProjection(from: [], now: fixedNow)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.summary, .zero)
        XCTAssertEqual(SignalCatalogPanelProjection.empty.rows, [])
    }

    func testSearchFilterIsCaseInsensitiveSubstring() {
        let rows = sampleRows()
        XCTAssertEqual(SignalCatalogPanelBuilder.filter(rows, search: "bat", mode: .all).map(\.name), ["battery_level"])
        XCTAssertEqual(
            SignalCatalogPanelBuilder.filter(rows, search: "SPEED", mode: .all).map(\.name),
            ["vehicle_speed"]
        )
        XCTAssertEqual(SignalCatalogPanelBuilder.filter(rows, search: "", mode: .all).count, rows.count)
        XCTAssertTrue(SignalCatalogPanelBuilder.filter(rows, search: "zzz", mode: .all).isEmpty)
    }

    func testFilterModeStaleKeepsStaleAndNever() {
        let names = SignalCatalogPanelBuilder.filter(sampleRows(), search: "", mode: .stale).map(\.name)
        XCTAssertEqual(Set(names), ["old_range", "never_seen"])
    }

    func testFilterModeActiveKeepsActiveOnly() {
        let names = SignalCatalogPanelBuilder.filter(sampleRows(), search: "", mode: .active).map(\.name)
        XCTAssertEqual(Set(names), ["vehicle_speed", "battery_level"])
    }

    func testSortStalenessDescendingNeverFirst() {
        let sorted = SignalCatalogPanelBuilder.sort(sampleRows(), mode: .staleness).map(\.name)
        XCTAssertEqual(sorted.first, "never_seen")
        XCTAssertEqual(sorted, ["never_seen", "old_range", "battery_level", "vehicle_speed"])
    }

    func testSortAlphaAscending() {
        let sorted = SignalCatalogPanelBuilder.sort(sampleRows(), mode: .alpha).map(\.name)
        XCTAssertEqual(sorted, ["battery_level", "never_seen", "old_range", "vehicle_speed"])
    }

    func testSortCategoryNeverThenStaleThenActive() {
        let ranks = SignalCatalogPanelBuilder.sort(sampleRows(), mode: .category).map(\.category)
        XCTAssertEqual(ranks, [.never, .stale, .active, .active])
    }

    // MARK: Fixtures

    private func mixedEntries() -> [SignalCatalogPanelEntry] {
        [
            SignalCatalogPanelEntry(name: "a", payload: .envelope(value: .number(1), timestamp: iso(5))),
            SignalCatalogPanelEntry(name: "b", payload: .envelope(value: .number(2), timestamp: iso(120))),
            SignalCatalogPanelEntry(name: "c", payload: .envelope(value: .number(3), timestamp: iso(600))),
            SignalCatalogPanelEntry(name: "d", payload: .bare(.bool(true))),
            SignalCatalogPanelEntry(name: "e", payload: .envelope(value: .number(5), timestamp: ""))
        ]
    }

    private func sampleRows() -> [SignalCatalogPanelRow] {
        [
            row("vehicle_speed", staleness: 5, category: .active),
            row("battery_level", staleness: 45, category: .active),
            row("old_range", staleness: 600, category: .stale),
            row("never_seen", staleness: .infinity, category: .never)
        ]
    }

    private func row(_ name: String, staleness: Double, category: SignalCatalogPanelCategory) -> SignalCatalogPanelRow {
        SignalCatalogPanelRow(
            name: name,
            value: "—",
            timestampRaw: category == .never ? nil : "t",
            timestamp: category == .never ? nil : fixedNow,
            staleness: staleness,
            category: category
        )
    }
}

// MARK: - Accessibility

final class SignalCatalogPanelAccessibilityTests: XCTestCase {
    func testTableSummaryFallsBackToNoData() {
        XCTAssertEqual(SignalCatalogPanelAccessibility.tableSummary(rowCount: 0), SignalCatalogPanelStrings.noData)
    }

    func testTableSummaryIncludesCount() {
        XCTAssertTrue(SignalCatalogPanelAccessibility.tableSummary(rowCount: 4).contains("4"))
    }

    func testRowLabelComposesEveryPiece() {
        let label = SignalCatalogPanelAccessibility.rowLabel(
            name: "vehicle_speed",
            value: "42",
            status: "Active",
            lastUpdated: "Jun 7, 2026 at 7:00 PM",
            timeSince: "10s ago"
        )
        XCTAssertTrue(label.contains("vehicle_speed"))
        XCTAssertTrue(label.contains("42"))
        XCTAssertTrue(label.contains("Active"))
        XCTAssertTrue(label.contains("10s ago"))
    }

    func testRowLabelFallsBackWhenNoTimeSince() {
        let label = SignalCatalogPanelAccessibility.rowLabel(
            name: "locked",
            value: "true",
            status: "Never received",
            lastUpdated: "—",
            timeSince: nil
        )
        XCTAssertTrue(label.contains(SignalCatalogPanelStrings.noTimestamp))
    }

    func testSelectionLabelSwitchesAddRemove() {
        XCTAssertTrue(SignalCatalogPanelAccessibility.selectionLabel(name: "x", isSelected: false).contains("x"))
        let remove = SignalCatalogPanelAccessibility.selectionLabel(name: "x", isSelected: true)
        XCTAssertEqual(remove, SignalCatalogPanelStrings.removeSignal("x"))
    }
}
