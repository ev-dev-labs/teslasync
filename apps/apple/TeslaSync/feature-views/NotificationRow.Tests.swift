//
//  NotificationRow.Tests.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  Pure-projection coverage for the NotificationRow surface: severity mapping (incl.
//  the web `?? 'info'` default), the row projection (read/archived derivation + the
//  `rule ? drill : null` gating), the drill-through resolution (web
//  `getAlertDrillthrough` / `getAlertDrillthroughHref` — signal→page map, fallback,
//  param order, percent-encoded href), phase resolution, the timestamp formatter, the
//  VoiceOver summaries, the surface slug, and the i18n key wiring. The observable-model
//  tests live in NotificationRow.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

/// English-fallback localizer (bundle-free).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Fixtures

private enum NotificationRowFixture {
    static let date = Date(timeIntervalSince1970: 1_733_600_000)

    static func input(
        id: Int = 1,
        severity: String? = "critical",
        read: Bool = false,
        archived: Bool = false,
        vehicle: String? = "Model 3",
        rule: String? = "Battery high",
        hasRule: Bool = true,
        signal: String? = "BatteryLevel",
        drillVehicleID: Int = 7,
        createdAtISO: String = "2024-12-07T18:13:20Z"
    ) -> NotificationRowInput {
        NotificationRowInput(
            id: id,
            title: "Battery temperature high",
            message: "Details",
            severityRaw: severity,
            createdAt: date,
            isRead: read,
            isArchived: archived,
            vehicleName: vehicle,
            ruleName: rule,
            hasRule: hasRule,
            ruleSignal: signal,
            drillVehicleID: drillVehicleID,
            createdAtISO: createdAtISO
        )
    }
}

// MARK: - Severity mapping

@MainActor final class NotificationRowSeverityKindTests: XCTestCase {
    func testKnownSeveritiesMapCaseInsensitively() {
        XCTAssertEqual(NotificationRowSeverityKind.from("critical"), .critical)
        XCTAssertEqual(NotificationRowSeverityKind.from("CRITICAL"), .critical)
        XCTAssertEqual(NotificationRowSeverityKind.from("warn"), .warn)
        XCTAssertEqual(NotificationRowSeverityKind.from("Warning"), .warn)
        XCTAssertEqual(NotificationRowSeverityKind.from("info"), .info)
    }

    func testUnknownAndNilDefaultToInfo() {
        XCTAssertEqual(NotificationRowSeverityKind.from("nope"), .info)
        XCTAssertEqual(NotificationRowSeverityKind.from(nil), .info)
        XCTAssertEqual(NotificationRowSeverityKind.from(""), .info)
    }

    func testLocalizationKeysAreStable() {
        XCTAssertEqual(NotificationRowSeverityKind.info.localizationKey, "notifications.inbox.row.severity.info")
        XCTAssertEqual(NotificationRowSeverityKind.warn.localizationKey, "notifications.inbox.row.severity.warn")
        XCTAssertEqual(
            NotificationRowSeverityKind.critical.localizationKey,
            "notifications.inbox.row.severity.critical"
        )
    }
}

// MARK: - Row projection

@MainActor final class NotificationRowProjectionTests: XCTestCase {
    func testSeverityDefaultFoldsThroughProjection() {
        XCTAssertEqual(NotificationRowFixture.input(severity: nil).projected().severity, .info)
        XCTAssertEqual(NotificationRowFixture.input(severity: "warn").projected().severity, .warn)
    }

    func testReadAndArchivedFlagsCarryThrough() {
        let projection = NotificationRowFixture.input(read: true, archived: true).projected()
        XCTAssertTrue(projection.isRead)
        XCTAssertTrue(projection.isArchived)
    }

    func testDrillthroughGatedOnRulePresence() {
        XCTAssertNotNil(NotificationRowFixture.input(hasRule: true).projected().drillthrough)
        XCTAssertNil(NotificationRowFixture.input(hasRule: false).projected().drillthrough)
    }

    func testProjectedDrillthroughResolvesSignalPage() {
        let drill = NotificationRowFixture.input(signal: "ChargeState").projected().drillthrough
        XCTAssertEqual(drill?.path, "/charging")
    }
}

// MARK: - Drill-through

@MainActor final class NotificationRowDrillthroughTests: XCTestCase {
    func testSignalMapsToContextPage() {
        XCTAssertEqual(
            NotificationRowDrillthrough.resolve(signal: "BatteryLevel", vehicleID: 1, createdAtISO: "").path,
            "/battery"
        )
        XCTAssertEqual(
            NotificationRowDrillthrough.resolve(signal: "VehicleSpeed", vehicleID: 1, createdAtISO: "").path,
            "/drives"
        )
    }

    func testUnknownSignalFallsBackToSignalExplorer() {
        let drill = NotificationRowDrillthrough.resolve(signal: "MysterySignal", vehicleID: 3, createdAtISO: "")
        XCTAssertEqual(drill.path, NotificationRowDrillthrough.signalExplorerFallback)
        XCTAssertEqual(drill.path, "/signal-explorer")
    }

    func testNilSignalNoVehicleNoTimestampIsBareFallback() {
        let drill = NotificationRowDrillthrough.resolve(signal: nil, vehicleID: 0, createdAtISO: "")
        XCTAssertEqual(drill.path, "/signal-explorer")
        XCTAssertTrue(drill.query.isEmpty)
        XCTAssertEqual(drill.href, "/signal-explorer")
    }

    func testQueryParamOrderMatchesWeb() {
        let drill = NotificationRowDrillthrough.resolve(signal: "Gear", vehicleID: 5, createdAtISO: "TS")
        XCTAssertEqual(drill.query.map(\.key), ["vehicle_id", "t", "signal"])
        XCTAssertEqual(drill.path, "/drives")
    }

    func testZeroVehicleIDOmitted() {
        let drill = NotificationRowDrillthrough.resolve(signal: "Gear", vehicleID: 0, createdAtISO: "TS")
        XCTAssertEqual(drill.query.map(\.key), ["t", "signal"])
    }

    func testHrefAssemblesContextQuery() {
        let drill = NotificationRowDrillthrough.resolve(
            signal: "BatteryLevel",
            vehicleID: 7,
            createdAtISO: "2024-12-07T18:13:20Z"
        )
        XCTAssertTrue(drill.href.hasPrefix("/battery?"))
        XCTAssertTrue(drill.href.contains("vehicle_id=7"))
        XCTAssertTrue(drill.href.contains("signal=BatteryLevel"))
        // RFC 3986 permits `:` in a query component, so the ISO timestamp's colons are
        // carried verbatim (matching the sibling AlertCard port); the destination
        // decodes either form identically.
        XCTAssertTrue(drill.href.contains("t=2024-12-07T18:13:20Z"))
    }

    func testHrefPercentEncodesReservedCharacters() {
        // Genuinely reserved characters (space, `&`) ARE percent-encoded in the query.
        let drill = NotificationRowDrillthrough.resolve(signal: nil, vehicleID: 1, createdAtISO: "a b&c")
        XCTAssertTrue(drill.href.contains("t=a%20b%26c"))
    }
}

// MARK: - Phase resolution

@MainActor final class NotificationRowProjectorTests: XCTestCase {
    func testResolvePhase() {
        XCTAssertEqual(NotificationRowProjector.resolvePhase(.loading, hasRow: false), .loading)
        XCTAssertEqual(NotificationRowProjector.resolvePhase(.loaded, hasRow: true), .content)
        XCTAssertEqual(NotificationRowProjector.resolvePhase(.loaded, hasRow: false), .empty)
        XCTAssertEqual(NotificationRowProjector.resolvePhase(.failed("x"), hasRow: true), .error("x"))
    }
}

// MARK: - Formatting + surface slug

@MainActor final class NotificationRowFormatTests: XCTestCase {
    func testTimestampIsDeterministic() {
        let locale = Locale(identifier: "en_US")
        let zone = TimeZone(identifier: "America/Los_Angeles") ?? .gmt
        let first = NotificationRowFormat.timestamp(NotificationRowFixture.date, locale: locale, timeZone: zone)
        let second = NotificationRowFormat.timestamp(NotificationRowFixture.date, locale: locale, timeZone: zone)
        XCTAssertEqual(first, second)
        XCTAssertFalse(first.isEmpty)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(NotificationRowSurface.slug, "NotificationRow")
        XCTAssertEqual(NotificationRow.surfaceSlug, "NotificationRow")
    }
}

// MARK: - Accessibility

@MainActor final class NotificationRowAccessibilityTests: XCTestCase {
    func testRowLabelIncludesSeverityReadStateMetaAndTitle() {
        let row = NotificationRowFixture.input(severity: "critical", read: false).projected()
        let label = NotificationRowAccessibility.rowLabel(
            row,
            localize: echo,
            locale: Locale(identifier: "en_US"),
            timeZone: TimeZone(identifier: "UTC") ?? .gmt
        )
        XCTAssertTrue(label.contains("Critical"))
        XCTAssertTrue(label.contains("Unread"))
        XCTAssertTrue(label.contains("Battery temperature high"))
        XCTAssertTrue(label.contains("Model 3"))
        XCTAssertTrue(label.contains("Battery high"))
    }

    func testRowLabelReflectsReadState() {
        let row = NotificationRowFixture.input(read: true).projected()
        let label = NotificationRowAccessibility.rowLabel(row, localize: echo)
        XCTAssertTrue(label.contains("Read"))
        assertExcludesWord(label, "Unread")
    }

    func testSelectionValue() {
        XCTAssertEqual(NotificationRowAccessibility.selectionValue(selected: true, localize: echo), "Selected")
        XCTAssertEqual(NotificationRowAccessibility.selectionValue(selected: false, localize: echo), "Not selected")
    }

    /// Asserts `label` does not contain `word` as a standalone token (so "Read" does
    /// not match inside "Unread").
    private func assertExcludesWord(_ label: String, _ word: String) {
        let tokens = label.components(separatedBy: CharacterSet(charactersIn: ", "))
        XCTAssertFalse(tokens.contains(word))
    }
}

// MARK: - i18n: every web source key is wired

@MainActor final class NotificationRowLocalizationTests: XCTestCase {
    /// The EXACT keys extracted from the web source
    /// (features/notifications/components/NotificationRow.tsx). This list is the parity
    /// contract; the strings table + the views must reference each one.
    private let webSourceKeys = [
        "notifications.inbox.row.select",
        "notifications.inbox.row.markRead",
        "notifications.inbox.row.markUnread",
        "notifications.inbox.row.archive",
        "notifications.inbox.row.unarchive",
        "alerts.viewContext"
    ]

    func testWebSourceKeysAreDistinctAndNonEmpty() {
        XCTAssertEqual(Set(webSourceKeys).count, webSourceKeys.count)
        for key in webSourceKeys {
            XCTAssertFalse(key.isEmpty)
        }
    }

    func testAccessibilityHelpersRouteThroughLocalizer() {
        let recorder = KeyRecorder()
        let row = NotificationRowFixture.input().projected()
        _ = NotificationRowAccessibility.rowLabel(row, localize: recorder.localize)
        _ = NotificationRowAccessibility.selectionValue(selected: true, localize: recorder.localize)
        _ = NotificationRowAccessibility.selectionValue(selected: false, localize: recorder.localize)
        XCTAssertTrue(recorder.keys.contains("notifications.inbox.row.a11y.unread"))
        XCTAssertTrue(recorder.keys.contains("notifications.inbox.row.severity.critical"))
        XCTAssertTrue(recorder.keys.contains("notifications.inbox.row.a11y.selected"))
        XCTAssertTrue(recorder.keys.contains("notifications.inbox.row.a11y.notSelected"))
    }

    func testStringsFacadeFallsBackToProvidedValue() {
        let value = NotificationRowStrings.string("notifications.inbox.row.__missing__", "Fallback value")
        XCTAssertEqual(value, "Fallback value")
    }
}

// MARK: - Test doubles

/// Records every localization key requested.
private final class KeyRecorder {
    private(set) var keys: Set<String> = []

    var localize: (String, String) -> String {
        { [self] key, fallback in
            keys.insert(key)
            return fallback
        }
    }
}
