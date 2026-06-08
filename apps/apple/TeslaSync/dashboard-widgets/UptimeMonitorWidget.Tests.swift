//
//  UptimeMonitorWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0104 · UptimeMonitorWidget (Apple)
//
//  Unit coverage for the UptimeMonitorWidget surface:
//    • Adapter (cached → projection) — `UptimeMonitorProjector` parity with the web
//      `services` useMemo + healthyCount + overall + statusVariant, plus the
//      DB-size/table-count formatters and status-text mapping.
//    • State holder — `UptimeMonitorModel` phase resolution across loading / empty /
//      error / content, freshness tracking, plus the P1/S11 `view.opened`
//      telemetry + source wiring.
//    • Registry — canonical `uptime-monitor` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryUptimeMonitorSource`. String
//  assertions check the web English fallbacks (the per-surface table folds into
//  the master catalog at integration time, so it resolves to the `value:`
//  fallback in the un-integrated test bundle).
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Adapter: cached payload → projection (port parity with the web useMemo)

final class UptimeMonitorProjectorTests: XCTestCase {
    func testServiceOrderMatchesWebKeys() {
        let projection = UptimeMonitorProjector.project(from: SystemHealthData(status: "healthy"))
        XCTAssertEqual(projection.services.map(\.key), ["database", "mqtt", "tesla_api", "fleet_telemetry"])
        XCTAssertEqual(projection.totalCount, 4)
    }

    func testMissingComponentsDefaultToUnhealthy() {
        let projection = UptimeMonitorProjector.project(from: SystemHealthData(status: "unhealthy"))
        for service in projection.services {
            XCTAssertEqual(service.status, "unhealthy")
            XCTAssertEqual(service.tone, .danger)
            XCTAssertEqual(service.failures, 0)
            XCTAssertNil(service.lastError)
        }
        XCTAssertEqual(projection.healthyCount, 0)
    }

    func testComponentFieldsCarryThrough() throws {
        let data = SystemHealthData(
            status: "degraded",
            components: [
                "tesla_api": SystemHealthComponentData(
                    status: "degraded",
                    consecutiveFailures: 3,
                    lastError: "429"
                )
            ]
        )
        let projection = UptimeMonitorProjector.project(from: data)
        let teslaApi = try XCTUnwrap(projection.services.first(where: { $0.key == "tesla_api" }))
        XCTAssertEqual(teslaApi.status, "degraded")
        XCTAssertEqual(teslaApi.tone, .warning)
        XCTAssertEqual(teslaApi.failures, 3)
        XCTAssertEqual(teslaApi.lastError, "429")
    }

    func testHealthyCountMatchesWebFilter() {
        let data = SystemHealthData(
            status: "degraded",
            components: [
                "database": SystemHealthComponentData(status: "healthy"),
                "mqtt": SystemHealthComponentData(status: "ok"),
                "tesla_api": SystemHealthComponentData(status: "degraded"),
                "fleet_telemetry": SystemHealthComponentData(status: "unhealthy")
            ]
        )
        let projection = UptimeMonitorProjector.project(from: data)
        XCTAssertEqual(projection.healthyCount, 2)
        XCTAssertEqual(projection.totalCount, 4)
    }

    func testOverallFallsBackToUnknown() {
        let projection = UptimeMonitorProjector.project(from: SystemHealthData(status: ""))
        XCTAssertEqual(projection.overallStatus, "unknown")
        XCTAssertEqual(projection.overallTone, .danger)
    }

    func testOverallToneTracksStatus() {
        XCTAssertEqual(UptimeMonitorProjector.project(from: SystemHealthData(status: "healthy")).overallTone, .success)
        XCTAssertEqual(UptimeMonitorProjector.project(from: SystemHealthData(status: "degraded")).overallTone, .warning)
        XCTAssertEqual(
            UptimeMonitorProjector.project(from: SystemHealthData(status: "unhealthy")).overallTone,
            .danger
        )
    }

    func testDatabaseAndTableCarryThrough() {
        let data = SystemHealthData(status: "healthy", databaseSize: "248 MB", tableCount: 87)
        let projection = UptimeMonitorProjector.project(from: data)
        XCTAssertEqual(projection.databaseSize, "248 MB")
        XCTAssertEqual(projection.tableCount, 87)
    }
}

// MARK: - statusVariant / isHealthy parity

final class UptimeStatusToneTests: XCTestCase {
    func testToneMapping() {
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "ok"), .success)
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "healthy"), .success)
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "degraded"), .warning)
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "unhealthy"), .danger)
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "offline"), .danger)
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "unknown"), .danger)
    }

    func testToneIsCaseInsensitive() {
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "Healthy"), .success)
        XCTAssertEqual(UptimeMonitorProjector.tone(for: "DEGRADED"), .warning)
    }

    func testIsHealthy() {
        XCTAssertTrue(UptimeMonitorProjector.isHealthy("ok"))
        XCTAssertTrue(UptimeMonitorProjector.isHealthy("healthy"))
        XCTAssertFalse(UptimeMonitorProjector.isHealthy("degraded"))
        XCTAssertFalse(UptimeMonitorProjector.isHealthy("unhealthy"))
    }
}

// MARK: - Formatters: db-size / table-count / ratio parity

final class UptimeMonitorFormatTests: XCTestCase {
    func testDatabaseSizeFallsBackToEmDash() {
        XCTAssertEqual(UptimeMonitorFormat.databaseSize(nil), "—")
        XCTAssertEqual(UptimeMonitorFormat.databaseSize("   "), "—")
        XCTAssertEqual(UptimeMonitorFormat.databaseSize("1.2 GB"), "1.2 GB")
    }

    func testTableCountGroupingAndEmDash() {
        XCTAssertEqual(UptimeMonitorFormat.tableCount(nil), "—")
        XCTAssertEqual(UptimeMonitorFormat.tableCount(87, locale: enUS), "87")
        XCTAssertEqual(UptimeMonitorFormat.tableCount(1234, locale: enUS), "1,234")
    }

    func testHealthRatio() {
        XCTAssertEqual(UptimeMonitorFormat.healthRatio(healthy: 3, total: 4), "3/4")
        XCTAssertEqual(UptimeMonitorFormat.healthRatio(healthy: 0, total: 4), "0/4")
    }
}

// MARK: - Status text: web 'OK'/'All OK'/raw-status parity (English fallbacks)

final class UptimeMonitorStatusTextTests: XCTestCase {
    func testServiceBadgeText() {
        XCTAssertEqual(UptimeMonitorStatusText.serviceBadge("ok"), "OK")
        XCTAssertEqual(UptimeMonitorStatusText.serviceBadge("healthy"), "OK")
        XCTAssertEqual(UptimeMonitorStatusText.serviceBadge("degraded"), "Degraded")
        XCTAssertEqual(UptimeMonitorStatusText.serviceBadge("unhealthy"), "Unhealthy")
    }

    func testOverallBadgeText() {
        XCTAssertEqual(UptimeMonitorStatusText.overallBadge("healthy"), "All OK")
        XCTAssertEqual(UptimeMonitorStatusText.overallBadge("degraded"), "Degraded")
        XCTAssertEqual(UptimeMonitorStatusText.overallBadge("unknown"), "Unknown")
    }

    func testUnexpectedStatusFallsBackToRawToken() {
        XCTAssertEqual(UptimeMonitorStatusText.localizedStatus("provisioning"), "provisioning")
    }
}

// MARK: - i18n facade: humanize + serviceLabel parity

final class UptimeMonitorStringsTests: XCTestCase {
    func testHumanizeMatchesWeb() {
        XCTAssertEqual(UptimeMonitorStrings.humanize("database"), "Database")
        XCTAssertEqual(UptimeMonitorStrings.humanize("mqtt"), "Mqtt")
        XCTAssertEqual(UptimeMonitorStrings.humanize("tesla_api"), "Tesla Api")
        XCTAssertEqual(UptimeMonitorStrings.humanize("fleet_telemetry"), "Fleet Telemetry")
    }

    func testServiceLabelUsesHumanizedFallback() {
        XCTAssertEqual(UptimeMonitorStrings.serviceLabel("tesla_api"), "Tesla Api")
        XCTAssertEqual(UptimeMonitorStrings.serviceLabel("fleet_telemetry"), "Fleet Telemetry")
    }
}

// MARK: - State holder: phases + freshness + telemetry + source wiring

@MainActor
final class UptimeMonitorModelTests: XCTestCase {
    private func makeModel(
        _ update: UptimeMonitorUpdate,
        telemetry: UptimeMonitorTelemetry = OSLogUptimeMonitorTelemetry()
    ) -> (UptimeMonitorModel, InMemoryUptimeMonitorSource) {
        let source = InMemoryUptimeMonitorSource(initial: update)
        let model = UptimeMonitorModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(UptimeMonitorUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(UptimeMonitorUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(UptimeMonitorUpdate(status: .failed("boom"), data: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let data = SystemHealthData(status: "healthy")
        let (loading, _) = makeModel(UptimeMonitorUpdate(status: .loading, data: data))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(UptimeMonitorUpdate(status: .failed("net"), data: data))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyUptimeMonitorTelemetry()
        let (model, source) = makeModel(UptimeMonitorUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [UptimeMonitorWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(UptimeMonitorUpdate(status: .loaded, data: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(UptimeMonitorUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            UptimeMonitorUpdate(
                status: .loaded,
                connection: .offline,
                data: SystemHealthData(
                    status: "degraded",
                    components: [
                        "database": SystemHealthComponentData(status: "healthy"),
                        "mqtt": SystemHealthComponentData(status: "healthy")
                    ],
                    databaseSize: "248 MB",
                    tableCount: 87
                ),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.healthyCount, 2)
        XCTAssertEqual(model.projection.overallTone, .warning)
        XCTAssertEqual(model.projection.databaseSize, "248 MB")
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(UptimeMonitorModel.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertFalse(UptimeMonitorModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(UptimeMonitorModel.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
    }

    func testIsTallThreshold() {
        XCTAssertTrue(UptimeMonitorModel.isTall(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(UptimeMonitorModel.isTall(DashboardWidgetSize(cols: 2, rows: 1)))
    }
}

// MARK: - Registry parity

final class UptimeMonitorRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = UptimeMonitorWidget.registration
        XCTAssertEqual(registration.id, "uptime-monitor")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = UptimeMonitorWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class UptimeMonitorAccessibilityTests: XCTestCase {
    func testSummaryIncludesOverallHealthCountAndDatabase() {
        let projection = UptimeMonitorProjector.project(
            from: SystemHealthData(
                status: "degraded",
                components: [
                    "database": SystemHealthComponentData(status: "healthy"),
                    "mqtt": SystemHealthComponentData(status: "healthy"),
                    "tesla_api": SystemHealthComponentData(status: "degraded"),
                    "fleet_telemetry": SystemHealthComponentData(status: "unhealthy")
                ],
                databaseSize: "248 MB",
                tableCount: 87
            )
        )
        let summary = UptimeMonitorAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Degraded"))
        XCTAssertTrue(summary.contains("2"))
        XCTAssertTrue(summary.contains("248 MB"))
        XCTAssertTrue(summary.contains("87"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyUptimeMonitorTelemetry: UptimeMonitorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
