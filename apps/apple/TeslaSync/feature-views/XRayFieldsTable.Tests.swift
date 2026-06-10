//
//  XRayFieldsTable.Tests.swift
//  TeslaSync — P4 feature view · 0034 · XRayFieldsTable (Apple)
//
//  Unit coverage for the XRayFieldsTable surface:
//    • Adapter (cached → projection) — value parity with the web component's pipeline:
//      formatValueKind, fmtInt grouping, formatRelative buckets, the sort switch * dir.
//    • State holder — XRayFieldsModel phase resolution, the useSortToggle parity (nextSort +
//      toggleSort), the P1/S11 `view.opened` telemetry (emitted once), refresh + stale
//      auto-refresh wiring.
//    • Accessibility — the per-row VoiceOver label, the table summary, and the sort value.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by InMemoryXRayFieldsSource.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let xrayUTC = TimeZone(identifier: "UTC") ?? .current
private let xrayEnUS = Locale(identifier: "en_US")
private let xrayNow = Date(timeIntervalSince1970: 1_700_000_000)

private func xrayISO(secondsAgo: Double) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = xrayUTC
    return formatter.string(from: xrayNow.addingTimeInterval(-secondsAgo))
}

private enum XRayFixtures {
    static let rows: [XRayFieldStat] = [
        XRayFieldStat(field: "battery_level", sampleCount: 50, lastSeenAt: xrayISO(secondsAgo: 300), valueKind: 3),
        XRayFieldStat(field: "ambient_temp", sampleCount: 90, lastSeenAt: xrayISO(secondsAgo: 60), valueKind: 6),
        XRayFieldStat(field: "charge_state", sampleCount: 50, lastSeenAt: xrayISO(secondsAgo: 1000), valueKind: 1)
    ]
}

/// Test-only telemetry spy (single-threaded under XCTest's serial main actor).
private final class XRayFieldsTableSpyTelemetry: XRayFieldsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

// MARK: - Adapter parity

@MainActor final class XRayFieldsAdapterTests: XCTestCase {
    func testValueKindLabelsMatchWeb() {
        let expected: [Int: String] = [
            0: "unknown", 1: "string", 2: "bool", 3: "int32", 4: "int64",
            5: "float32", 6: "float64", 7: "enum", 8: "invalid", 9: "time", 10: "location"
        ]
        for (kind, label) in expected {
            XCTAssertEqual(XRayValueKind.label(kind), label, "value_kind \(kind)")
        }
        XCTAssertEqual(XRayValueKind.label(11), "kind 11")
        XCTAssertEqual(XRayValueKind.label(255), "kind 255")
    }

    func testIntegerGroupingMatchesEnUS() {
        XCTAssertEqual(XRayNumberFormat.int(0), "0")
        XCTAssertEqual(XRayNumberFormat.int(42), "42")
        XCTAssertEqual(XRayNumberFormat.int(12345), "12,345")
        XCTAssertEqual(XRayNumberFormat.int(1_234_567), "1,234,567")
    }

    func testRelativeTimeBuckets() {
        func rel(_ secondsAgo: Double) -> String {
            XRayRelativeTime.lastSeen(
                fromISO: xrayISO(secondsAgo: secondsAgo),
                now: xrayNow,
                locale: xrayEnUS,
                timeZone: xrayUTC
            )
        }
        XCTAssertEqual(rel(10), "just now")
        XCTAssertEqual(rel(59), "just now")
        XCTAssertEqual(rel(60), "1m ago")
        XCTAssertEqual(rel(125), "2m ago")
        XCTAssertEqual(rel(3600), "1h ago")
        XCTAssertEqual(rel(7205), "2h ago")
        XCTAssertEqual(rel(86400), "1d ago")
        XCTAssertEqual(rel(86400 * 6), "6d ago")
    }

    func testRelativeTimeFutureAndInvalid() {
        let future = XRayRelativeTime.lastSeen(
            fromISO: xrayISO(secondsAgo: -30),
            now: xrayNow,
            locale: xrayEnUS,
            timeZone: xrayUTC
        )
        XCTAssertEqual(future, "just now")
        let invalid = XRayRelativeTime.lastSeen(
            fromISO: "not-a-date",
            now: xrayNow,
            locale: xrayEnUS,
            timeZone: xrayUTC
        )
        XCTAssertEqual(invalid, "—")
    }

    func testRelativeTimeAbsoluteFallback() {
        let absolute = XRayRelativeTime.lastSeen(
            fromISO: xrayISO(secondsAgo: 86400 * 30), now: xrayNow, locale: xrayEnUS, timeZone: xrayUTC
        )
        XCTAssertFalse(absolute.contains("ago"))
        XCTAssertTrue(absolute.contains(","))
        XCTAssertNotNil(absolute.rangeOfCharacter(from: .decimalDigits))
    }
}

// MARK: - Sort parity

@MainActor final class XRayFieldsSorterTests: XCTestCase {
    func testSampleCountSort() {
        XCTAssertEqual(
            XRayFieldsSorter.sorted(XRayFixtures.rows, key: .sampleCount, direction: .descending).map(\.sampleCount),
            [90, 50, 50]
        )
        XCTAssertEqual(
            XRayFieldsSorter.sorted(XRayFixtures.rows, key: .sampleCount, direction: .ascending).map(\.sampleCount),
            [50, 50, 90]
        )
    }

    func testFieldSortUsesLocaleCompare() {
        XCTAssertEqual(
            XRayFieldsSorter.sorted(XRayFixtures.rows, key: .field, direction: .ascending).map(\.field),
            ["ambient_temp", "battery_level", "charge_state"]
        )
    }

    func testValueKindSort() {
        XCTAssertEqual(
            XRayFieldsSorter.sorted(XRayFixtures.rows, key: .valueKind, direction: .descending).map(\.valueKind),
            [6, 3, 1]
        )
    }

    func testLastSeenSortMostRecentFirst() {
        XCTAssertEqual(
            XRayFieldsSorter.sorted(XRayFixtures.rows, key: .lastSeenAt, direction: .descending).map(\.field),
            ["ambient_temp", "battery_level", "charge_state"]
        )
    }

    func testStableForEqualKeys() {
        let rows = [
            XRayFieldStat(field: "a", sampleCount: 5, lastSeenAt: xrayISO(secondsAgo: 10), valueKind: 1),
            XRayFieldStat(field: "b", sampleCount: 5, lastSeenAt: xrayISO(secondsAgo: 20), valueKind: 1),
            XRayFieldStat(field: "c", sampleCount: 5, lastSeenAt: xrayISO(secondsAgo: 30), valueKind: 1)
        ]
        XCTAssertEqual(
            XRayFieldsSorter.sorted(rows, key: .sampleCount, direction: .descending).map(\.field),
            ["a", "b", "c"]
        )
    }
}

// MARK: - Projection + accessibility

@MainActor final class XRayFieldsProjectionTests: XCTestCase {
    private func project() -> [XRayFieldRow] {
        XRayFieldsProjector.project(
            rows: XRayFixtures.rows, sortKey: .sampleCount, sortDirection: .descending,
            context: XRayFieldsRenderContext(now: xrayNow, locale: xrayEnUS, timeZone: xrayUTC)
        )
    }

    func testProjectionOrderAndFormatting() {
        let rows = project()
        XCTAssertEqual(rows.map(\.field), ["ambient_temp", "battery_level", "charge_state"])
        XCTAssertEqual(rows.first?.samplesText, "90")
        XCTAssertEqual(rows.first?.kindLabel, "float64")
        XCTAssertEqual(rows.first?.lastSeenText, "1m ago")
    }

    func testAccessibilityRowLabelContainsAllColumns() {
        guard let row = project().first else { return XCTFail("no rows") }
        let label = XRayFieldsAccessibility.rowLabel(row)
        XCTAssertTrue(label.contains("ambient_temp"))
        XCTAssertTrue(label.contains("90"))
        XCTAssertTrue(label.contains("float64"))
    }

    func testAccessibilitySummaryAndSortValue() {
        XCTAssertTrue(XRayFieldsAccessibility.summary(count: 3).contains("3"))
        XCTAssertEqual(XRayFieldsAccessibility.sortValue(isActive: false, direction: .ascending), "")
        XCTAssertEqual(XRayFieldsAccessibility.sortValue(isActive: true, direction: .ascending), "ascending")
        XCTAssertEqual(XRayFieldsAccessibility.sortValue(isActive: true, direction: .descending), "descending")
    }
}

// MARK: - Model (state holder)

@MainActor final class XRayFieldsModelTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .loading, hasRows: false), .loading)
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .loading, hasRows: true), .content)
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .empty, hasRows: false), .empty)
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .loaded, hasRows: true), .content)
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .loaded, hasRows: false), .empty)
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .failed("x"), hasRows: false), .error("x"))
        XCTAssertEqual(XRayFieldsModel.resolvePhase(status: .failed("x"), hasRows: true), .content)
    }

    func testNextSortMatchesUseSortToggle() {
        let flip = XRayFieldsModel.nextSort(current: .sampleCount, direction: .descending, tapped: .sampleCount)
        XCTAssertEqual(flip.key, .sampleCount)
        XCTAssertEqual(flip.direction, .ascending)
        let newColumn = XRayFieldsModel.nextSort(current: .sampleCount, direction: .ascending, tapped: .field)
        XCTAssertEqual(newColumn.key, .field)
        XCTAssertEqual(newColumn.direction, .descending)
    }

    func testStartEmitsTelemetryOnce() {
        let spy = XRayFieldsTableSpyTelemetry()
        let model = XRayFieldsModel(source: InMemoryXRayFieldsSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["XRayFieldsTable"])
    }

    func testDefaultSortIsSampleCountDescending() {
        let model = XRayFieldsModel(source: InMemoryXRayFieldsSource())
        XCTAssertEqual(model.sortKey, .sampleCount)
        XCTAssertEqual(model.sortDirection, .descending)
    }

    func testToggleSortFlipsAndSwitches() {
        let model = XRayFieldsModel(source: InMemoryXRayFieldsSource())
        model.toggleSort(.sampleCount)
        XCTAssertEqual(model.sortDirection, .ascending)
        model.toggleSort(.field)
        XCTAssertEqual(model.sortKey, .field)
        XCTAssertEqual(model.sortDirection, .descending)
    }

    func testSnapshotDrivesPhaseAndRows() {
        let source = InMemoryXRayFieldsSource()
        let model = XRayFieldsModel(source: source)
        model.start()
        source.push(XRayFieldsUpdate(status: .loaded, connection: .live, rows: XRayFixtures.rows))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 3)
        source.push(XRayFieldsUpdate(status: .empty, rows: []))
        XCTAssertEqual(model.phase, .empty)
    }

    func testAutoRefreshOnlyWhenStaleAndIdle() {
        let source = InMemoryXRayFieldsSource()
        let model = XRayFieldsModel(source: source)
        model.start()
        source.push(XRayFieldsUpdate(status: .loaded, connection: .live, isFetching: false, rows: XRayFixtures.rows))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(XRayFieldsUpdate(status: .loaded, connection: .stale, isFetching: false, rows: XRayFixtures.rows))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
        source.push(XRayFieldsUpdate(status: .loaded, connection: .stale, isFetching: true, rows: XRayFixtures.rows))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
    }
}
