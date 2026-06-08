//
//  EventHistoryTable.Tests.swift
//  TeslaSync — P4 feature view · 0042 · EventHistoryTable (Apple)
//
//  Unit coverage for the EventHistoryTable surface:
//    • Adapter — the helpers.ts ports: parseWindowState / doorClosed (bool / number /
//      object / string / JSON-string branches) / allWindowsClosed / windowSummary /
//      doorDisplay, the JS-truthiness Lock/Sentry gate, asNonEmptyString, and the
//      timestamp parser/formatter.
//    • State holder — `EventHistoryProjection` phase resolution across loading / error /
//      data / empty, plus the `EventHistoryModel` wiring and the P1/S11 `view.opened`.
//    • Accessibility — the cell display text + the VoiceOver row summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryEventHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: helpers.ts ports

final class EventHistoryAdapterTests: XCTestCase {
    func testParseWindowState() {
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.string("Closed")), .closed)
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.string("0")), .closed)
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.string("Venting")), .venting)
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.string("Open")), .open)
        // Any non-empty value that is not closed/vent falls through to open (web rule).
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.string("garbage")), .open)
        // A boolean has no non-empty string → Unknown (web asNonEmptyString → null).
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.bool(false)), .unknown)
        XCTAssertEqual(EventHistoryAdapter.parseWindowState(.null), .unknown)
    }

    func testDoorClosedScalarBranches() {
        XCTAssertTrue(EventHistoryAdapter.doorClosed(.null))
        XCTAssertTrue(EventHistoryAdapter.doorClosed(.bool(false)))
        XCTAssertFalse(EventHistoryAdapter.doorClosed(.bool(true)))
        XCTAssertTrue(EventHistoryAdapter.doorClosed(.number(0)))
        XCTAssertFalse(EventHistoryAdapter.doorClosed(.number(1)))
    }

    func testDoorClosedStringBranches() {
        for sentinel in ["Closed", "ClosedAll", "0", "false", "", "   "] {
            XCTAssertTrue(EventHistoryAdapter.doorClosed(.string(sentinel)), "\(sentinel) should be closed")
        }
        XCTAssertFalse(EventHistoryAdapter.doorClosed(.string("DriverFrontOpen")))
    }

    func testDoorClosedObjectAndJSONStringBranches() {
        let object = SecuritySignal.object(["df": .bool(false), "pf": .null])
        XCTAssertTrue(EventHistoryAdapter.doorClosed(object))
        XCTAssertFalse(EventHistoryAdapter.doorClosed(.object(["df": .string("open")])))
        XCTAssertTrue(EventHistoryAdapter.doorClosed(.string("{\"df\":false,\"pf\":false}")))
        XCTAssertFalse(EventHistoryAdapter.doorClosed(.string("{\"df\":\"open\"}")))
        // A `{`-prefixed but unparseable value is not closed (web try/catch fall-through).
        XCTAssertFalse(EventHistoryAdapter.doorClosed(.string("{not json")))
    }

    func testAllWindowsClosed() {
        let closed = Array(repeating: SecuritySignal.string("Closed"), count: 4)
        XCTAssertTrue(EventHistoryAdapter.allWindowsClosed(closed))
        var oneOpen = closed
        oneOpen[1] = .string("Open")
        XCTAssertFalse(EventHistoryAdapter.allWindowsClosed(oneOpen))
        // Booleans parse to Unknown (not Closed) → not all closed.
        XCTAssertFalse(EventHistoryAdapter.allWindowsClosed(Array(repeating: .bool(false), count: 4)))
    }

    func testWindowSummary() {
        let closed = Array(repeating: SecuritySignal.string("Closed"), count: 4)
        XCTAssertEqual(EventHistoryAdapter.windowSummary(closed), .allClosed)
        let mixed: [SecuritySignal] = [.string("Closed"), .string("Open"), .string("Vent"), .string("Closed")]
        XCTAssertEqual(EventHistoryAdapter.windowSummary(mixed), .openVenting(2))
    }

    func testDoorDisplay() {
        XCTAssertEqual(EventHistoryAdapter.doorDisplay(.string("DriverOpen")), .raw("DriverOpen"))
        XCTAssertEqual(EventHistoryAdapter.doorDisplay(.bool(false)), .closedLabel)
        XCTAssertEqual(EventHistoryAdapter.doorDisplay(.null), .closedLabel)
        XCTAssertEqual(EventHistoryAdapter.doorDisplay(.bool(true)), .dash)
    }

    func testTruthinessGate() {
        XCTAssertTrue(SecuritySignal.bool(true).isTruthy)
        XCTAssertFalse(SecuritySignal.bool(false).isTruthy)
        XCTAssertFalse(SecuritySignal.null.isTruthy)
        XCTAssertTrue(SecuritySignal.string("Armed").isTruthy)
        // Non-empty string is truthy even when it reads "off" — matches web `row.sentryMode ?`.
        XCTAssertTrue(SecuritySignal.string("off").isTruthy)
        XCTAssertFalse(SecuritySignal.string("").isTruthy)
        XCTAssertTrue(SecuritySignal.number(1).isTruthy)
        XCTAssertFalse(SecuritySignal.number(0).isTruthy)
    }

    func testAsNonEmptyString() {
        XCTAssertEqual(SecuritySignal.string("x").asNonEmptyString, "x")
        XCTAssertNil(SecuritySignal.string("").asNonEmptyString)
        XCTAssertNil(SecuritySignal.bool(true).asNonEmptyString)
        XCTAssertNil(SecuritySignal.null.asNonEmptyString)
    }

    func testRowProjectionAndTimeComparator() {
        let input = SecurityEventInput(
            id: "9",
            createdAt: "2026-01-05T15:04:05Z",
            locked: .bool(true),
            sentryMode: .string("Armed"),
            doorState: .string("Closed"),
            fdWindow: .string("Closed"),
            fpWindow: .string("Open"),
            rdWindow: .string("Closed"),
            rpWindow: .string("Closed")
        )
        let row = EventHistoryAdapter.row(from: input)
        XCTAssertEqual(row.id, "9")
        XCTAssertTrue(row.locked)
        XCTAssertTrue(row.sentryOn)
        XCTAssertTrue(row.doorClosed)
        XCTAssertEqual(row.door, .raw("Closed"))
        XCTAssertFalse(row.windowsClosed)
        XCTAssertEqual(row.windows, .openVenting(1))
        XCTAssertNotNil(row.createdAt)

        let older = EventHistoryAdapter.row(from: SecurityEventInput(id: "1", createdAt: "2026-01-01T00:00:00Z"))
        XCTAssertEqual(EventHistoryAdapter.compareByTime(older, row), .orderedAscending)
        XCTAssertEqual(EventHistoryAdapter.compareByTime(row, row), .orderedSame)
    }
}

// MARK: - Timestamp formatting (web TimeStamp / formatDateTime)

final class EventHistoryFormatTests: XCTestCase {
    func testEmptyAndInvalidReturnDash() {
        XCTAssertNil(EventHistoryFormat.parse(""))
        XCTAssertNil(EventHistoryFormat.parse("not-a-date"))
        XCTAssertEqual(EventHistoryFormat.absolute(for: nil), "—")
    }

    func testValidISORendersHumanReadable() {
        let locale = Locale(identifier: "en_US_POSIX")
        let utc = TimeZone(identifier: "UTC") ?? .current
        let date = EventHistoryFormat.parse("2026-01-05T15:04:05Z")
        XCTAssertNotNil(date)
        let out = EventHistoryFormat.absolute(for: date, locale: locale, timeZone: utc)
        XCTAssertNotEqual(out, "—")
        XCTAssertTrue(out.contains("2026"))
    }

    func testEpochSecondsParse() {
        XCTAssertNotNil(EventHistoryFormat.parse("1736089445"))
    }
}

// MARK: - Projection: phase resolution across every branch

final class EventHistoryProjectionTests: XCTestCase {
    private var sampleEvents: [SecurityEventInput] {
        [SecurityEventInput(id: "1", createdAt: "2026-01-05T15:04:05Z", locked: .bool(true))]
    }

    func testLoadingTakesPrecedence() {
        let resolved = EventHistoryProjection.resolve(
            EventHistoryInput(events: sampleEvents, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testErrorWhenNotLoading() {
        let resolved = EventHistoryProjection.resolve(
            EventHistoryInput(events: sampleEvents, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testDataWhenRowsPresent() {
        let resolved = EventHistoryProjection.resolve(EventHistoryInput(events: sampleEvents))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 1)
    }

    func testEmptyWhenNoRows() {
        let resolved = EventHistoryProjection.resolve(EventHistoryInput(events: []))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.rows.isEmpty)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class EventHistoryModelTests: XCTestCase {
    private func makeModel(
        _ input: EventHistoryInput,
        telemetry: EventHistoryTelemetry = OSLogEventHistoryTelemetry()
    ) -> (EventHistoryModel, InMemoryEventHistorySource) {
        let source = InMemoryEventHistorySource(initial: input)
        let model = EventHistoryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyEventHistoryTelemetry()
        let events = [SecurityEventInput(id: "1", createdAt: "2026-01-05T15:04:05Z")]
        let (model, source) = makeModel(EventHistoryInput(events: events), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(spy.surfaces, [EventHistoryDiagnostics.surface])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EventHistoryInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(EventHistoryInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(EventHistoryInput(events: [SecurityEventInput(id: "7", createdAt: "2026-01-05T15:04:05Z")]))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.first?.id, "7")
    }
}

// MARK: - Accessibility + display text content

final class EventHistoryAccessibilityTests: XCTestCase {
    /// Bundle-free localizer that returns the English fallback (the web `t` default).
    private let localize: EventHistoryAccessibility.Localize = { _, fallback in fallback }

    func testLockAndSentryText() {
        XCTAssertEqual(EventHistoryAccessibility.lockText(true, localize), "Locked")
        XCTAssertEqual(EventHistoryAccessibility.lockText(false, localize), "Unlocked")
        XCTAssertEqual(EventHistoryAccessibility.sentryText(true, localize), "On")
        XCTAssertEqual(EventHistoryAccessibility.sentryText(false, localize), "Off")
    }

    func testDoorAndWindowText() {
        XCTAssertEqual(EventHistoryAccessibility.doorText(.raw("DriverOpen"), localize), "DriverOpen")
        XCTAssertEqual(EventHistoryAccessibility.doorText(.closedLabel, localize), "Closed")
        XCTAssertEqual(EventHistoryAccessibility.doorText(.dash, localize), "—")
        XCTAssertEqual(EventHistoryAccessibility.windowText(.allClosed, localize), "All Closed")
        XCTAssertEqual(EventHistoryAccessibility.windowText(.openVenting(2), localize), "2 Open/Venting")
    }

    func testRowSummaryCombinesEveryColumn() {
        let row = EventHistoryAdapter.row(from: SecurityEventInput(
            id: "1",
            createdAt: "2026-01-05T15:04:05Z",
            locked: .bool(true),
            sentryMode: .string("Armed"),
            doorState: .string("Closed"),
            fdWindow: .string("Open"),
            fpWindow: .string("Closed"),
            rdWindow: .string("Closed"),
            rpWindow: .string("Closed")
        ))
        let summary = EventHistoryAccessibility.rowSummary(for: row, localize)
        XCTAssertTrue(summary.contains("Lock: Locked"))
        XCTAssertTrue(summary.contains("Sentry: On"))
        XCTAssertTrue(summary.contains("Doors: Closed"))
        XCTAssertTrue(summary.contains("Windows: 1 Open/Venting"))
        XCTAssertTrue(summary.contains("Time:"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEventHistoryTelemetry: EventHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
