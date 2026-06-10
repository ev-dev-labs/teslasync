//
//  AlertCard.Tests.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  Unit coverage for the AlertCard surface: the Adapter projections (severity
//  normalize + tone, the per-type icon + label, the relative-time buckets, the
//  acknowledged-badge copy, the acknowledge/reopen action, the freshness chip, the
//  drill-through route resolution), the `isAcknowledged` derivation, the VoiceOver
//  summaries, the i18n key parity (referenced == the web keys), and the P1/S11
//  `view.opened` telemetry. No network, no real store, no rendering host — the pure
//  projections are exercised directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum AlertCardFixture {
    nonisolated(unsafe) static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func iso(_ secondsAgo: TimeInterval) -> String {
        ISO8601DateFormatter().string(from: now.addingTimeInterval(-secondsAgo))
    }

    static func alert(
        type: String = "low_battery",
        severity: String = "warning",
        title: String = "Battery low",
        message: String = "State of charge dropped below the threshold.",
        isRead: Bool = false,
        createdAt: String = "2023-11-14T19:02:00Z",
        acknowledgedAt: String? = nil,
        acknowledgedBy: String? = nil,
        vehicleID: Int64 = 1,
        ruleSignal: String? = "BatteryLevel"
    ) -> AlertCardData {
        AlertCardData(
            id: 7,
            type: type,
            severity: severity,
            title: title,
            message: message,
            isRead: isRead,
            createdAt: createdAt,
            acknowledgedAt: acknowledgedAt,
            acknowledgedBy: acknowledgedBy,
            vehicleID: vehicleID,
            ruleSignal: ruleSignal
        )
    }
}

// MARK: - Severity (web normalizeSeverity + severityTokens)

@MainActor final class AlertSeverityTests: XCTestCase {
    func testNormalizeFoldsAliases() {
        XCTAssertEqual(AlertSeverity.normalize(nil), .info)
        XCTAssertEqual(AlertSeverity.normalize(""), .info)
        XCTAssertEqual(AlertSeverity.normalize("info"), .info)
        XCTAssertEqual(AlertSeverity.normalize("warn"), .warn)
        XCTAssertEqual(AlertSeverity.normalize("warning"), .warn)
        XCTAssertEqual(AlertSeverity.normalize("critical"), .critical)
        XCTAssertEqual(AlertSeverity.normalize("error"), .critical)
        XCTAssertEqual(AlertSeverity.normalize("fatal"), .critical)
        XCTAssertEqual(AlertSeverity.normalize("ok"), .success)
        XCTAssertEqual(AlertSeverity.normalize("success"), .success)
        XCTAssertEqual(AlertSeverity.normalize("nonsense"), .info)
    }

    func testNormalizeIsCaseInsensitive() {
        XCTAssertEqual(AlertSeverity.normalize("WARNING"), .warn)
        XCTAssertEqual(AlertSeverity.normalize("Critical"), .critical)
    }

    func testToneMapping() {
        XCTAssertEqual(AlertSeverity.info.tone, .info)
        XCTAssertEqual(AlertSeverity.warn.tone, .warning)
        XCTAssertEqual(AlertSeverity.critical.tone, .danger)
        XCTAssertEqual(AlertSeverity.success.tone, .success)
    }
}

// MARK: - Type icon + label (web TYPE_ICONS + type display)

@MainActor final class AlertTypeIconTests: XCTestCase {
    func testKnownTypesMapToSymbols() {
        XCTAssertEqual(AlertTypeIcon.systemImage(for: "geofence_exit"), "mappin.and.ellipse")
        XCTAssertEqual(AlertTypeIcon.systemImage(for: "low_battery"), "battery.50")
        XCTAssertEqual(AlertTypeIcon.systemImage(for: "charging_complete"), "bolt.fill")
        XCTAssertEqual(AlertTypeIcon.systemImage(for: "sentry_event"), "shield.lefthalf.filled")
        XCTAssertEqual(AlertTypeIcon.systemImage(for: "system_mqtt"), "dot.radiowaves.left.and.right")
    }

    func testUnknownTypeFallsBackToBell() {
        XCTAssertEqual(AlertTypeIcon.systemImage(for: "made_up_type"), "bell.fill")
        XCTAssertEqual(AlertTypeIcon.systemImage(for: ""), "bell.fill")
    }

    func testDisplayLabelReplacesUnderscores() {
        XCTAssertEqual(AlertTypeIcon.displayLabel(for: "geofence_exit"), "geofence exit")
        XCTAssertEqual(AlertTypeIcon.displayLabel(for: "software_update"), "software update")
        XCTAssertEqual(AlertTypeIcon.displayLabel(for: ""), "notification")
    }
}

// MARK: - Relative time (web getTimeAgo)

@MainActor final class AlertTimeFormatTests: XCTestCase {
    private let echo = AlertCardLocalizer.echo

    func testTimeAgoBuckets() {
        XCTAssertEqual(AlertTimeFormat.timeAgo(nil, now: AlertCardFixture.now, localize: echo), "—")
        XCTAssertEqual(AlertTimeFormat.timeAgo("not-a-date", now: AlertCardFixture.now, localize: echo), "—")
        XCTAssertEqual(
            AlertTimeFormat.timeAgo(AlertCardFixture.iso(30), now: AlertCardFixture.now, localize: echo),
            "0m ago"
        )
        XCTAssertEqual(
            AlertTimeFormat.timeAgo(AlertCardFixture.iso(300), now: AlertCardFixture.now, localize: echo),
            "5m ago"
        )
        XCTAssertEqual(
            AlertTimeFormat.timeAgo(AlertCardFixture.iso(7200), now: AlertCardFixture.now, localize: echo),
            "2h ago"
        )
        XCTAssertEqual(
            AlertTimeFormat.timeAgo(AlertCardFixture.iso(259_200), now: AlertCardFixture.now, localize: echo),
            "3d ago"
        )
    }
}

// MARK: - Acknowledged badge + action (web isAcked branch)

@MainActor final class AlertAckTests: XCTestCase {
    private let echo = AlertCardLocalizer.echo

    func testIsAcknowledgedDerivation() {
        XCTAssertFalse(AlertCardFixture.alert().isAcknowledged)
        XCTAssertFalse(AlertCardFixture.alert(acknowledgedAt: "").isAcknowledged)
        XCTAssertTrue(AlertCardFixture.alert(acknowledgedAt: "2023-11-14T19:30:00Z").isAcknowledged)
    }

    func testAckBadgeLabel() {
        XCTAssertNil(AlertAckBadge.label(for: AlertCardFixture.alert(), localize: echo))
        let named = AlertCardFixture.alert(acknowledgedAt: "2023-11-14T19:30:00Z", acknowledgedBy: "sam")
        XCTAssertEqual(AlertAckBadge.label(for: named, localize: echo), "Acknowledged by sam")
        let anon = AlertCardFixture.alert(acknowledgedAt: "2023-11-14T19:30:00Z", acknowledgedBy: nil)
        XCTAssertEqual(AlertAckBadge.label(for: anon, localize: echo), "Acknowledged")
    }

    func testAckActionResolveAndMetadata() {
        XCTAssertEqual(AlertAckAction.resolve(AlertCardFixture.alert()), .acknowledge)
        XCTAssertEqual(
            AlertAckAction.resolve(AlertCardFixture.alert(acknowledgedAt: "2023-11-14T19:30:00Z")),
            .reopen
        )
        XCTAssertEqual(AlertAckAction.acknowledge.labelKey, "alerts.ack.button")
        XCTAssertEqual(AlertAckAction.reopen.labelKey, "alerts.timeline.kindAnonymous.reopened")
        XCTAssertEqual(AlertAckAction.acknowledge.labelFallback, "Acknowledge")
        XCTAssertEqual(AlertAckAction.reopen.labelFallback, "Reopened")
    }
}

// MARK: - Freshness chip (stale / offline)

@MainActor final class AlertFreshnessTests: XCTestCase {
    func testProjection() {
        XCTAssertNil(AlertFreshnessChip.project(.live))
        XCTAssertEqual(AlertFreshnessChip.project(.stale), .stale)
        XCTAssertEqual(AlertFreshnessChip.project(.offline), .offline)
    }

    func testMetadataAndConnectionFreshness() {
        XCTAssertEqual(AlertFreshnessChip.stale.labelKey, "alerts.freshness.stale")
        XCTAssertEqual(AlertFreshnessChip.offline.labelKey, "alerts.freshness.offline")
        XCTAssertEqual(AlertFreshnessChip.stale.tone, .warning)
        XCTAssertEqual(AlertFreshnessChip.offline.tone, .neutral)
        XCTAssertTrue(AlertLiveConnection.live.isFresh)
        XCTAssertFalse(AlertLiveConnection.stale.isFresh)
        XCTAssertFalse(AlertLiveConnection.offline.isFresh)
    }
}

// MARK: - Drill-through (web getAlertDrillthrough / getAlertDrillthroughHref)

@MainActor final class AlertDrillthroughTests: XCTestCase {
    func testMappedSignalRoutesToContextPage() {
        let target = AlertDrillthrough.resolve(
            AlertCardFixture.alert(createdAt: "2023-11-14T19:02:00Z", vehicleID: 1, ruleSignal: "BatteryLevel")
        )
        XCTAssertEqual(target.path, "/battery")
        XCTAssertEqual(target.query.map(\.key), ["vehicle_id", "t", "signal"])
        XCTAssertEqual(target.query.first { $0.key == "vehicle_id" }?.value, "1")
        XCTAssertEqual(target.query.first { $0.key == "signal" }?.value, "BatteryLevel")
    }

    func testUnmappedSignalFallsBackToExplorer() {
        let target = AlertDrillthrough.resolve(AlertCardFixture.alert(ruleSignal: "CustomRuleSignal"))
        XCTAssertEqual(target.path, AlertDrillthrough.signalExplorerFallback)
        XCTAssertEqual(target.query.first { $0.key == "signal" }?.value, "CustomRuleSignal")
    }

    func testNilSignalOmitsSignalParamAndUsesFallback() {
        let target = AlertDrillthrough.resolve(AlertCardFixture.alert(ruleSignal: nil))
        XCTAssertEqual(target.path, "/signal-explorer")
        XCTAssertFalse(target.query.contains { $0.key == "signal" })
    }

    func testUnscopedVehicleAndEmptyTimestampAreOmitted() {
        let target = AlertDrillthrough.resolve(
            AlertCardFixture.alert(createdAt: "", vehicleID: 0, ruleSignal: "Gear")
        )
        XCTAssertEqual(target.path, "/drives")
        XCTAssertEqual(target.query.map(\.key), ["signal"])
    }

    func testHrefAssembly() {
        let target = AlertDrillthrough.resolve(
            AlertCardFixture.alert(createdAt: "2023-11-14T19:02:00Z", vehicleID: 3, ruleSignal: "VehicleSpeed")
        )
        XCTAssertTrue(target.href.hasPrefix("/drives?"), target.href)
        XCTAssertTrue(target.href.contains("vehicle_id=3"), target.href)
        XCTAssertTrue(target.href.contains("signal=VehicleSpeed"), target.href)
    }

    func testEmptyQueryHrefIsBarePath() {
        let target = AlertDrillthrough.resolve(
            AlertCardFixture.alert(createdAt: "", vehicleID: 0, ruleSignal: nil)
        )
        XCTAssertEqual(target.href, "/signal-explorer")
    }
}

// MARK: - State accessor

@MainActor final class AlertCardStateTests: XCTestCase {
    func testAlertAccessor() {
        let data = AlertCardFixture.alert()
        XCTAssertEqual(AlertCardState.loaded(data).alert, data)
        XCTAssertNil(AlertCardState.loading.alert)
        XCTAssertNil(AlertCardState.empty.alert)
        XCTAssertNil(AlertCardState.error(message: nil).alert)
    }
}

// MARK: - Accessibility + i18n key parity

@MainActor final class AlertCardAccessibilityTests: XCTestCase {
    private let echo = AlertCardLocalizer.echo

    func testCardLabelComposesUnreadAlert() {
        let data = AlertCardFixture.alert(
            severity: "critical",
            title: "Battery low",
            isRead: false,
            createdAt: AlertCardFixture.iso(300)
        )
        let label = AlertCardAccessibility.cardLabel(for: data, now: AlertCardFixture.now, localize: echo)
        XCTAssertEqual(label, "Battery low, critical, Unread, 5m ago")
    }

    func testCardLabelComposesReadAcknowledgedAlert() {
        let data = AlertCardFixture.alert(
            severity: "info",
            title: "Charging complete",
            isRead: true,
            createdAt: AlertCardFixture.iso(7200),
            acknowledgedAt: AlertCardFixture.iso(60),
            acknowledgedBy: "sam"
        )
        let label = AlertCardAccessibility.cardLabel(for: data, now: AlertCardFixture.now, localize: echo)
        XCTAssertEqual(label, "Charging complete, info, Read, 2h ago, Acknowledged by sam")
    }

    func testInteractiveLabels() {
        XCTAssertEqual(AlertCardAccessibility.viewContextLabel(echo), "View context")
        XCTAssertEqual(AlertCardAccessibility.unreadLabel(echo), "Unread")
        XCTAssertEqual(AlertCardAccessibility.markReadLabel(echo), "Mark read")
        XCTAssertEqual(AlertCardAccessibility.auditTimelineLabel(echo), "Audit timeline")
    }

    /// Guards that the keys the surface references are exactly the web keys — a
    /// regression here means the folded catalog would miss a string.
    func testWebKeyParity() {
        XCTAssertEqual(AlertAckAction.acknowledge.labelKey, "alerts.ack.button")
        XCTAssertEqual(AlertAckAction.reopen.labelKey, "alerts.timeline.kindAnonymous.reopened")
        let acked = AlertCardFixture.alert(acknowledgedAt: "2023-11-14T19:30:00Z", acknowledgedBy: "sam")
        XCTAssertEqual(AlertAckBadge.label(for: acked, localize: echo), "Acknowledged by sam")
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class AlertCardTelemetryTests: XCTestCase {
    private final class Recorder: AlertCardTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [String] = []
        var surfaces: [String] {
            lock.lock(); defer { lock.unlock() }
            return stored
        }

        func viewOpened(surface: String) {
            lock.lock(); stored.append(surface); lock.unlock()
        }
    }

    @MainActor
    func testReportOpenEmitsSlug() {
        let recorder = Recorder()
        AlertCardSurface.reportOpen(to: recorder)
        XCTAssertEqual(recorder.surfaces, ["AlertCard"])
        XCTAssertEqual(AlertCard.surfaceSlug, "AlertCard")
    }
}
