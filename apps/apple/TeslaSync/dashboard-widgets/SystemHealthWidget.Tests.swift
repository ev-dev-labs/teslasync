//
//  SystemHealthWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0099 · SystemHealthWidget (Apple)
//
//  Unit coverage: adapter (cached → projection — SERVICE_KEYS/status/healthyCount/
//  dbSize/conns/memory/goroutines + fmtInt), state holder (phase/freshness/
//  telemetry/source wiring), registry, and the VoiceOver summary. No network/real
//  store — the model is driven by `InMemorySystemHealthSource`.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Adapter: cached payload → projection (port parity with the web body)

@MainActor
final class SystemHealthProjectionTests: XCTestCase {
    private func snapshot(
        status: String = "healthy", components: [String: String] = [:],
        databaseSize: String? = "2.4 GB", dbStatsSize: String? = nil,
        inUse: Int = 0, maxOpen: Int = 0, goroutines: Int? = nil, memoryMB: Double? = nil
    ) -> SystemHealthSnapshot {
        SystemHealthSnapshot(
            health: SystemHealthData(
                status: status,
                components: components.mapValues { SystemHealthComponentData(status: $0) },
                databaseSize: databaseSize
            ),
            dbStats: SystemHealthDBStats(databaseSize: dbStatsSize),
            runtime: SystemHealthRuntimeInfo(inUse: inUse, maxOpen: maxOpen, goroutines: goroutines, memoryMB: memoryMB)
        )
    }

    func testServiceKeysAreTheFourCanonicalComponents() {
        let vitals = SystemHealthProjection.vitals(from: snapshot())
        XCTAssertEqual(vitals.services.map(\.key), ["database", "mqtt", "tesla_api", "fleet_telemetry"])
        XCTAssertEqual(vitals.services.map(\.labelKey), [
            "widget.systemHealth.db", "widget.systemHealth.mqtt",
            "widget.systemHealth.teslaApi", "widget.systemHealth.workers"
        ])
    }

    func testMissingComponentDefaultsToUnhealthy() {
        let vitals = SystemHealthProjection.vitals(from: snapshot(components: [:]))
        XCTAssertTrue(vitals.services.allSatisfy { $0.status == .unhealthy })
        XCTAssertEqual(vitals.healthyCount, 0)
    }

    func testHealthyCountCountsOkAndHealthyOnly() {
        let vitals = SystemHealthProjection.vitals(from: snapshot(components: [
            "database": "ok",
            "mqtt": "healthy",
            "tesla_api": "degraded",
            "fleet_telemetry": "unhealthy"
        ]))
        XCTAssertEqual(vitals.healthyCount, 2)
        XCTAssertEqual(vitals.services.first { $0.key == "tesla_api" }?.status, .degraded)
        XCTAssertEqual(vitals.services.first { $0.key == "fleet_telemetry" }?.status, .unhealthy)
    }

    func testUnknownStatusStringNormalizesToUnhealthy() {
        let vitals = SystemHealthProjection.vitals(from: snapshot(components: ["database": "weird-value"]))
        XCTAssertEqual(vitals.services.first { $0.key == "database" }?.status, .unhealthy)
    }

    func testDefaultLabelsAreTitleCasedKeys() {
        let vitals = SystemHealthProjection.vitals(from: snapshot())
        let labels = Dictionary(uniqueKeysWithValues: vitals.services.map { ($0.key, $0.defaultLabel) })
        XCTAssertEqual(labels["database"], "Database")
        XCTAssertEqual(labels["mqtt"], "Mqtt")
        XCTAssertEqual(labels["tesla_api"], "Tesla Api")
        XCTAssertEqual(labels["fleet_telemetry"], "Fleet Telemetry")
    }

    func testOverallStatusAndBadgeMapping() {
        XCTAssertEqual(SystemHealthProjection.vitals(from: snapshot(status: "healthy")).overallBadge, .online)
        XCTAssertEqual(SystemHealthProjection.vitals(from: snapshot(status: "degraded")).overallBadge, .away)
        XCTAssertEqual(SystemHealthProjection.vitals(from: snapshot(status: "unhealthy")).overallBadge, .offline)
        XCTAssertEqual(SystemHealthProjection.vitals(from: snapshot(status: "weird")).overallBadge, .offline)
    }

    func testUnknownOverallStatusWhenHealthAbsent() {
        let vitals = SystemHealthProjection.vitals(from: SystemHealthSnapshot())
        XCTAssertEqual(vitals.overallStatus, "unknown")
        XCTAssertEqual(vitals.overallBadge, .offline)
        XCTAssertEqual(vitals.healthyCount, 0)
        XCTAssertEqual(vitals.dbSize, "—")
    }

    func testDbSizeFallsBackHealthThenDbStatsThenEmDash() {
        XCTAssertEqual(SystemHealthProjection.vitals(from: snapshot(databaseSize: "5 GB")).dbSize, "5 GB")
        XCTAssertEqual(
            SystemHealthProjection.vitals(from: snapshot(databaseSize: nil, dbStatsSize: "3 GB")).dbSize,
            "3 GB"
        )
        XCTAssertEqual(SystemHealthProjection.vitals(from: snapshot(databaseSize: nil, dbStatsSize: nil)).dbSize, "—")
        // Empty/whitespace is treated as absent so a blank API value falls through.
        XCTAssertEqual(
            SystemHealthProjection.vitals(from: snapshot(databaseSize: "  ", dbStatsSize: "9 GB")).dbSize,
            "9 GB"
        )
    }

    func testConnectionAndRuntimeCountersFlowThrough() {
        let vitals = SystemHealthProjection.vitals(
            from: snapshot(inUse: 8, maxOpen: 25, goroutines: 142, memoryMB: 312)
        )
        XCTAssertEqual(vitals.activeConns, 8)
        XCTAssertEqual(vitals.maxConns, 25)
        XCTAssertEqual(vitals.goroutines, 142)
        XCTAssertEqual(vitals.memoryMB, 312)
    }

    func testRuntimeCountersDefaultWhenAbsent() {
        let vitals = SystemHealthProjection.vitals(
            from: SystemHealthSnapshot(health: SystemHealthData(status: "healthy"))
        )
        XCTAssertEqual(vitals.activeConns, 0)
        XCTAssertEqual(vitals.maxConns, 0)
        XCTAssertNil(vitals.goroutines)
        XCTAssertNil(vitals.memoryMB)
    }

    func testTitleCaseHelper() {
        XCTAssertEqual(SystemHealthProjection.titleCase("database"), "Database")
        XCTAssertEqual(SystemHealthProjection.titleCase("tesla_api"), "Tesla Api")
        XCTAssertEqual(SystemHealthProjection.titleCase("fleet_telemetry"), "Fleet Telemetry")
        XCTAssertEqual(SystemHealthProjection.titleCase("mqtt"), "Mqtt")
    }
}

// MARK: - Service status normalization

@MainActor
final class SystemHealthServiceStatusTests: XCTestCase {
    func testRawNormalization() {
        XCTAssertEqual(SystemHealthServiceStatus(raw: "ok"), .ok)
        XCTAssertEqual(SystemHealthServiceStatus(raw: "HEALTHY"), .healthy)
        XCTAssertEqual(SystemHealthServiceStatus(raw: " degraded "), .degraded)
        XCTAssertEqual(SystemHealthServiceStatus(raw: "unhealthy"), .unhealthy)
        XCTAssertEqual(SystemHealthServiceStatus(raw: "anything-else"), .unhealthy)
    }

    func testIsHealthy() {
        XCTAssertTrue(SystemHealthServiceStatus.ok.isHealthy)
        XCTAssertTrue(SystemHealthServiceStatus.healthy.isHealthy)
        XCTAssertFalse(SystemHealthServiceStatus.degraded.isHealthy)
        XCTAssertFalse(SystemHealthServiceStatus.unhealthy.isHealthy)
    }
}

// MARK: - Formatters: fmtInt + cell strings

@MainActor
final class SystemHealthFormatTests: XCTestCase {
    func testIntGrouping() {
        XCTAssertEqual(SystemHealthFormat.int(18234, locale: enUS), "18,234")
        XCTAssertEqual(SystemHealthFormat.int(0, locale: enUS), "0")
    }

    func testIntFromDoubleRoundsHalfUp() {
        XCTAssertEqual(SystemHealthFormat.int(311.6, locale: enUS), "312")
        XCTAssertEqual(SystemHealthFormat.int(312.4, locale: enUS), "312")
        XCTAssertEqual(SystemHealthFormat.int(Double.nan, locale: enUS), "0")
    }

    func testActiveConns() {
        // Web: maxConns > 0 ? `${inUse}/${maxOpen}` : `${inUse}`
        XCTAssertEqual(SystemHealthFormat.activeConns(inUse: 8, maxOpen: 25, locale: enUS), "8/25")
        XCTAssertEqual(SystemHealthFormat.activeConns(inUse: 3, maxOpen: 0, locale: enUS), "3")
        XCTAssertEqual(SystemHealthFormat.activeConns(inUse: 1200, maxOpen: 2000, locale: enUS), "1,200/2,000")
    }

    func testMemory() {
        // Web: memory != null ? `${fmtInt(memory)} MB` : '—'
        XCTAssertEqual(SystemHealthFormat.memory(312, locale: enUS), "312 MB")
        XCTAssertEqual(SystemHealthFormat.memory(1536, locale: enUS), "1,536 MB")
        XCTAssertEqual(SystemHealthFormat.memory(nil), "—")
    }

    func testGoroutines() {
        // Web: goroutines != null ? fmtInt(goroutines) : '—'
        XCTAssertEqual(SystemHealthFormat.goroutines(142, locale: enUS), "142")
        XCTAssertEqual(SystemHealthFormat.goroutines(nil), "—")
    }

    func testServiceCount() {
        XCTAssertEqual(SystemHealthFormat.serviceCount(healthy: 3, total: 4, locale: enUS), "3/4")
    }

    func testEmDash() {
        XCTAssertEqual(SystemHealthFormat.emDash, "—")
    }
}

// MARK: - Overall labelling

@MainActor
final class SystemHealthOverallTests: XCTestCase {
    func testLabelKeyMapping() {
        XCTAssertEqual(SystemHealthOverall.labelKey(for: "healthy").fallback, "Healthy")
        XCTAssertEqual(SystemHealthOverall.labelKey(for: "degraded").fallback, "Degraded")
        XCTAssertEqual(SystemHealthOverall.labelKey(for: "unhealthy").fallback, "Down")
        XCTAssertEqual(SystemHealthOverall.labelKey(for: "unknown").fallback, "Down")
    }

    func testResolvedLabels() {
        XCTAssertEqual(SystemHealthOverall.label(for: "healthy"), "Healthy")
        XCTAssertEqual(SystemHealthOverall.label(for: "degraded"), "Degraded")
        XCTAssertEqual(SystemHealthOverall.label(for: "down-ish"), "Down")
    }

    func testBadgeLabels() {
        XCTAssertEqual(SystemHealthOverall.badgeLabel(.online), "Online")
        XCTAssertEqual(SystemHealthOverall.badgeLabel(.away), "Away")
        XCTAssertEqual(SystemHealthOverall.badgeLabel(.offline), "Offline")
    }
}

// MARK: - State holder: phases + freshness + telemetry + source wiring

@MainActor
final class SystemHealthModelTests: XCTestCase {
    private func makeModel(
        _ update: SystemHealthUpdate,
        telemetry: SystemHealthTelemetry = OSLogSystemHealthTelemetry()
    ) -> (SystemHealthModel, InMemorySystemHealthSource) {
        let source = InMemorySystemHealthSource(initial: update)
        let model = SystemHealthModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func dataSnapshot() -> SystemHealthSnapshot {
        SystemHealthSnapshot(
            health: SystemHealthData(
                status: "healthy",
                components: ["database": SystemHealthComponentData(status: "ok")],
                databaseSize: "2.4 GB"
            ),
            runtime: SystemHealthRuntimeInfo(inUse: 8, maxOpen: 25, goroutines: 142, memoryMB: 312)
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SystemHealthUpdate(status: .loading, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutHealthShowsEmpty() {
        let (model, _) = makeModel(SystemHealthUpdate(status: .loaded, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithRuntimeButNoHealthIsStillEmpty() {
        // hasData mirrors the web `health.data != null` — runtime alone is not enough.
        let snap = SystemHealthSnapshot(runtime: SystemHealthRuntimeInfo(inUse: 1, maxOpen: 2))
        let (model, _) = makeModel(SystemHealthUpdate(status: .loaded, snapshot: snap))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SystemHealthUpdate(status: .failed("boom"), snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(SystemHealthUpdate(status: .loading, snapshot: dataSnapshot()))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(SystemHealthUpdate(status: .failed("net"), snapshot: dataSnapshot()))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySystemHealthTelemetry()
        let (model, source) = makeModel(SystemHealthUpdate(status: .loading, snapshot: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SystemHealthWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SystemHealthUpdate(status: .loaded, snapshot: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesToSource() {
        let (model, source) = makeModel(SystemHealthUpdate(status: .loaded, snapshot: nil))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testConnectionVitalsTrackUpdates() {
        let (model, source) = makeModel(SystemHealthUpdate(status: .loading, snapshot: nil))
        model.start()
        source.push(
            SystemHealthUpdate(
                status: .loaded,
                connection: .offline,
                snapshot: dataSnapshot(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vitals.overallStatus, "healthy")
        XCTAssertEqual(model.vitals.activeConns, 8)
        XCTAssertEqual(model.vitals.maxConns, 25)
        XCTAssertEqual(model.vitals.dbSize, "2.4 GB")
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(SystemHealthModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(SystemHealthModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor
final class SystemHealthRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SystemHealthWidget.registration
        XCTAssertEqual(registration.id, "system-health")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SystemHealthWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor
final class SystemHealthAccessibilityTests: XCTestCase {
    func testSummaryIncludesOverallServicesAndStats() {
        let vitals = SystemHealthProjection.vitals(from: SystemHealthSnapshot(
            health: SystemHealthData(
                status: "degraded",
                components: [
                    "database": SystemHealthComponentData(status: "ok"),
                    "mqtt": SystemHealthComponentData(status: "healthy"),
                    "tesla_api": SystemHealthComponentData(status: "degraded"),
                    "fleet_telemetry": SystemHealthComponentData(status: "unhealthy")
                ],
                databaseSize: "2.4 GB"
            ),
            runtime: SystemHealthRuntimeInfo(inUse: 8, maxOpen: 25, goroutines: 142, memoryMB: 312)
        ))
        let summary = SystemHealthAccessibility.summary(from: vitals)
        XCTAssertTrue(summary.contains("System Health"))
        XCTAssertTrue(summary.contains("Degraded"))
        XCTAssertTrue(summary.contains("2/4"))
        XCTAssertTrue(summary.contains("DB Size: 2.4 GB"))
        XCTAssertTrue(summary.contains("Active Conns: 8/25"))
        XCTAssertTrue(summary.contains("Memory: 312 MB"))
        XCTAssertTrue(summary.contains("Goroutines: 142"))
    }

    func testSummaryHandlesMissingRuntime() {
        let vitals = SystemHealthProjection.vitals(from: SystemHealthSnapshot(
            health: SystemHealthData(status: "healthy")
        ))
        let summary = SystemHealthAccessibility.summary(from: vitals)
        XCTAssertTrue(summary.contains("Healthy"))
        XCTAssertTrue(summary.contains("Memory: —"))
        XCTAssertTrue(summary.contains("Goroutines: —"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySystemHealthTelemetry: SystemHealthTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
