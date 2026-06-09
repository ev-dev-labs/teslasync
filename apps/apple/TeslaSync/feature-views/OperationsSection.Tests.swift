//
//  OperationsSection.Tests.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  Unit coverage for the OperationsSection surface: the Adapter (formatters, status
//  classification, success-rate, channel summary), the state holder (projection across
//  loading / error / ready, resolved derivations, model wiring + P1/S11 telemetry +
//  stale auto-refresh), and the Accessibility label content. Driven by
//  `InMemoryOperationsSource` with an injected locale / time zone for determinism; no
//  network, no real store.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let nyTimeZone = TimeZone(identifier: "America/New_York") ?? .gmt

private func notif(
    id: Int = 1,
    status: String,
    title: String = "Title",
    message: String = "Message",
    createdAt: Date? = nil
) -> NotificationLogItem {
    NotificationLogItem(id: id, status: status, title: title, message: message, createdAt: createdAt)
}

private func audit(
    id: Int = 1,
    action: String = "vehicle.command",
    resource: String = "vehicle/42",
    details: String = "Details",
    createdAt: Date? = nil
) -> AuditLogItem {
    AuditLogItem(id: id, action: action, resource: resource, details: details, createdAt: createdAt)
}

// MARK: - Number / int / percent formatting (port of numberFormat.ts)

@MainActor final class OperationsFormatNumberTests: XCTestCase {
    func testNumberGroupsFixesDecimalsAndCoercesNonFinite() {
        XCTAssertEqual(OperationsFormat.number(1000, locale: enUS), "1,000.00")
        XCTAssertEqual(OperationsFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(OperationsFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(OperationsFormat.number(.infinity, locale: enUS), "0.00")
    }

    func testIntGroupsWithoutDecimals() {
        XCTAssertEqual(OperationsFormat.int(1284, locale: enUS), "1,284")
        XCTAssertEqual(OperationsFormat.int(0, locale: enUS), "0")
    }

    func testPercentDefaultsToOneDecimalAndHonoursOverride() {
        XCTAssertEqual(OperationsFormat.percent(98.5, locale: enUS), "98.5%")
        XCTAssertEqual(OperationsFormat.percent(100, locale: enUS), "100.0%")
        XCTAssertEqual(OperationsFormat.percent(97.1183, decimals: 2, locale: enUS), "97.12%")
        XCTAssertEqual(OperationsFormat.percent(50, decimals: 0, locale: enUS), "50%")
    }
}

// MARK: - Date formatting (port of dateFormat.ts formatDateTime)

@MainActor final class OperationsFormatDateTests: XCTestCase {
    func testNilYieldsDash() {
        XCTAssertEqual(OperationsFormat.dateTime(nil, locale: enUS, timeZone: nyTimeZone), "—")
    }

    func testRendersLocaleOrderedDateTime() {
        var components = DateComponents()
        components.year = 2026
        components.month = 4
        components.day = 4
        components.hour = 9
        components.minute = 5
        components.timeZone = nyTimeZone
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = nyTimeZone
        let date = calendar.date(from: components)
        XCTAssertNotNil(date)

        let rendered = OperationsFormat.dateTime(date, locale: enUS, timeZone: nyTimeZone)
        XCTAssertTrue(rendered.contains("Apr"), rendered)
        XCTAssertTrue(rendered.contains("2026"), rendered)
        XCTAssertTrue(rendered.contains("9:05"), rendered)
    }
}

// MARK: - Status classification (web getStatusIcon / statusTextClass)

@MainActor final class OperationsStatusKindTests: XCTestCase {
    func testClassifiesNotificationStatesCaseInsensitively() {
        XCTAssertEqual(OperationsStatusKind(raw: "sent"), .healthy)
        XCTAssertEqual(OperationsStatusKind(raw: "COMPLETED"), .healthy)
        XCTAssertEqual(OperationsStatusKind(raw: "Pending"), .pending)
        XCTAssertEqual(OperationsStatusKind(raw: "failed"), .failed)
    }

    func testUnknownFallback() {
        XCTAssertEqual(OperationsStatusKind(raw: "deferred_dnd"), .neutral)
        XCTAssertEqual(OperationsStatusKind(raw: ""), .neutral)
    }

    func testToneMapping() {
        XCTAssertEqual(OperationsStatusKind.healthy.tone, .success)
        XCTAssertEqual(OperationsStatusKind.pending.tone, .warning)
        XCTAssertEqual(OperationsStatusKind.failed.tone, .danger)
        XCTAssertEqual(OperationsStatusKind.neutral.tone, .neutral)
    }

    func testSymbolMapping() {
        XCTAssertEqual(OperationsStatusKind.healthy.symbolName, "checkmark.circle.fill")
        XCTAssertEqual(OperationsStatusKind.pending.symbolName, "exclamationmark.triangle.fill")
        XCTAssertEqual(OperationsStatusKind.failed.symbolName, "xmark.circle.fill")
        XCTAssertEqual(OperationsStatusKind.neutral.symbolName, "exclamationmark.triangle.fill")
    }
}

// MARK: - Success rate (web successRate + threshold tone)

@MainActor final class OperationsSuccessRateTests: XCTestCase {
    func testNilStatsIsHundredPercent() {
        XCTAssertEqual(OperationsSuccessRate.compute(nil), 100, accuracy: 1e-9)
    }

    func testZeroTotalSentIsHundredPercent() {
        let stats = NotificationStatsSnapshot(totalSent: 0, sent: 0)
        XCTAssertEqual(OperationsSuccessRate.compute(stats), 100, accuracy: 1e-9)
    }

    func testComputesRatio() {
        let stats = NotificationStatsSnapshot(totalSent: 100, sent: 80)
        XCTAssertEqual(OperationsSuccessRate.compute(stats), 80, accuracy: 1e-9)
        let perfect = NotificationStatsSnapshot(totalSent: 1284, sent: 1284)
        XCTAssertEqual(OperationsSuccessRate.compute(perfect), 100, accuracy: 1e-9)
    }

    func testToneThresholds() {
        XCTAssertEqual(OperationsSuccessRate.tone(for: 100), .success)
        XCTAssertEqual(OperationsSuccessRate.tone(for: 95), .success)
        XCTAssertEqual(OperationsSuccessRate.tone(for: 94.99), .warning)
        XCTAssertEqual(OperationsSuccessRate.tone(for: 80), .warning)
        XCTAssertEqual(OperationsSuccessRate.tone(for: 79.99), .danger)
        XCTAssertEqual(OperationsSuccessRate.tone(for: 0), .danger)
    }

    func testChannelSummaryJoinsEnabledOverTotal() {
        let stats = NotificationStatsSnapshot(totalChannels: 6, enabledChannels: 4)
        XCTAssertEqual(OperationsChannels.summary(stats), "4/6")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor final class OperationsProjectionTests: XCTestCase {
    private let stats = NotificationStatsSnapshot(
        totalSent: 100,
        sent: 95,
        failed: 5,
        totalChannels: 4,
        enabledChannels: 3
    )

    func testErrorTakesPrecedence() {
        let resolved = OperationsProjection.resolve(
            OperationsInput(stats: stats, notifLogs: [notif(status: "sent")], errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertFalse(resolved.hasStats)
        XCTAssertNil(resolved.notifLogs)
        XCTAssertTrue(resolved.auditLogs.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = OperationsProjection.resolve(OperationsInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertFalse(resolved.hasStats)
    }

    func testReadyResolvesAllThreeFeeds() {
        let resolved = OperationsProjection.resolve(
            OperationsInput(
                stats: stats,
                notifLogs: [notif(status: "sent"), notif(id: 2, status: "failed")],
                auditLogs: [audit()]
            )
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertTrue(resolved.hasStats)
        XCTAssertEqual(resolved.notifLogs?.count, 2)
        XCTAssertEqual(resolved.auditLogs.count, 1)
    }

    func testNotifLogsNilIsNotLoaded() {
        let resolved = OperationsProjection.resolve(OperationsInput(stats: stats, notifLogs: nil))
        XCTAssertFalse(resolved.notifLogsLoaded)
        XCTAssertFalse(resolved.hasNotifLogs)
    }

    func testNotifLogsEmptyIsLoadedButHasNone() {
        let resolved = OperationsProjection.resolve(OperationsInput(stats: stats, notifLogs: []))
        XCTAssertTrue(resolved.notifLogsLoaded)
        XCTAssertFalse(resolved.hasNotifLogs)
    }

    func testNotifLogsWithRowsHasContent() {
        let resolved = OperationsProjection.resolve(OperationsInput(stats: stats, notifLogs: [notif(status: "sent")]))
        XCTAssertTrue(resolved.notifLogsLoaded)
        XCTAssertTrue(resolved.hasNotifLogs)
    }

    func testAuditDefaultsToEmptyAndNotHidden() {
        let resolved = OperationsProjection.resolve(OperationsInput(stats: stats))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertTrue(resolved.auditLogs.isEmpty)
        XCTAssertFalse(resolved.hasAuditLogs)
    }

    func testReadyWithNoStatsIsEmptyButNotHidden() {
        let resolved = OperationsProjection.resolve(OperationsInput())
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertFalse(resolved.hasStats)
        XCTAssertFalse(resolved.showStatsBadge)
        XCTAssertEqual(resolved.successRate, 100, accuracy: 1e-9)
    }
}

// MARK: - Resolved derivations (success rate, gauge, badge flags)

@MainActor final class OperationsResolvedTests: XCTestCase {
    private func resolved(_ input: OperationsInput) -> OperationsResolved {
        OperationsProjection.resolve(input)
    }

    func testSuccessRateAndTone() {
        let warn = resolved(OperationsInput(stats: NotificationStatsSnapshot(totalSent: 100, sent: 90)))
        XCTAssertEqual(warn.successRate, 90, accuracy: 1e-9)
        XCTAssertEqual(warn.successTone, .warning)
    }

    func testGaugeFractionScalesAndClamps() {
        let normal = resolved(OperationsInput(stats: NotificationStatsSnapshot(totalSent: 100, sent: 80)))
        XCTAssertEqual(normal.gaugeFraction, 0.8, accuracy: 1e-9)

        // sent > totalSent is non-physical upstream but must clamp, never exceed 1.
        let over = resolved(OperationsInput(stats: NotificationStatsSnapshot(totalSent: 100, sent: 150)))
        XCTAssertEqual(over.gaugeFraction, 1, accuracy: 1e-9)
    }

    func testGaugeColorIndexTracksTone() {
        let success = resolved(OperationsInput(stats: NotificationStatsSnapshot(totalSent: 100, sent: 100)))
        XCTAssertEqual(success.gaugeColorIndex, 2)

        let warning = resolved(OperationsInput(stats: NotificationStatsSnapshot(totalSent: 100, sent: 85)))
        XCTAssertEqual(warning.gaugeColorIndex, 1)

        let danger = resolved(OperationsInput(stats: NotificationStatsSnapshot(totalSent: 100, sent: 50)))
        XCTAssertEqual(danger.gaugeColorIndex, 5)
    }

    func testStatsBadgeOnlyWithStats() {
        XCTAssertTrue(resolved(OperationsInput(stats: NotificationStatsSnapshot())).showStatsBadge)
        XCTAssertFalse(resolved(OperationsInput()).showStatsBadge)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class OperationsModelTests: XCTestCase {
    private func makeModel(
        _ input: OperationsInput,
        telemetry: OperationsTelemetry = OSLogOperationsTelemetry()
    ) -> (OperationsModel, InMemoryOperationsSource) {
        let source = InMemoryOperationsSource(initial: input)
        let model = OperationsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: OperationsInput {
        OperationsInput(
            stats: NotificationStatsSnapshot(totalSent: 100, sent: 97),
            notifLogs: [notif(status: "sent")],
            auditLogs: [audit()]
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyOperationsTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.notifLogs?.count, 1)
        XCTAssertEqual(spy.surfaces, [OperationsSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(OperationsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertFalse(model.resolved.hasStats)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(OperationsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.resolved.hasAuditLogs)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(OperationsInput(stats: dataInput.stats, notifLogs: dataInput.notifLogs, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(OperationsInput(stats: dataInput.stats, notifLogs: dataInput.notifLogs, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(OperationsInput(stats: dataInput.stats, notifLogs: dataInput.notifLogs, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(OperationsSection.surfaceSlug, "OperationsSection")
    }
}

// MARK: - Accessibility summary content

@MainActor final class OperationsAccessibilityTests: XCTestCase {
    func testSuccessRateLabelJoinsParts() {
        XCTAssertEqual(
            OperationsAccessibility.successRateLabel(percent: "97.1%", suffix: "success rate"),
            "97.1% success rate"
        )
    }

    func testNotificationRowLabelJoinsParts() {
        XCTAssertEqual(
            OperationsAccessibility.notificationRowLabel(
                status: "sent",
                title: "Charging complete",
                message: "Model Y finished charging.",
                time: "Apr 4, 2026, 9:05 AM"
            ),
            "sent, Charging complete, Model Y finished charging., Apr 4, 2026, 9:05 AM"
        )
    }

    func testAuditRowLabelJoinsParts() {
        XCTAssertEqual(
            OperationsAccessibility.auditRowLabel(
                time: "Apr 4, 2026, 9:05 AM",
                action: "vehicle.command",
                resource: "vehicle/42/wake",
                details: "Woke vehicle."
            ),
            "Apr 4, 2026, 9:05 AM, vehicle.command, vehicle/42/wake, Woke vehicle."
        )
    }
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyOperationsTelemetry: OperationsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
