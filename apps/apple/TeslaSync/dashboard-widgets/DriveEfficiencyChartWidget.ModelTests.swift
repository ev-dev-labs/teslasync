//
//  DriveEfficiencyChartWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  State-holder, registry, and accessibility coverage for the
//  DriveEfficiencyChartWidget surface (split from the adapter-focused
//  `DriveEfficiencyChartWidget.Tests.swift` to keep each file focused):
//    • State holder — `DriveEfficiencyChartModel` phase resolution across
//      loading / empty / error / content, plus the P1/S11 `view.opened`
//      telemetry + source wiring and the compact/wide size thresholds.
//    • Registry — canonical `drive-efficiency-chart` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-point value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryDriveEfficiencyChartSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Test fixtures

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar
}

private func makeDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    return utcCalendar().date(from: components) ?? Date(timeIntervalSince1970: 0)
}

private func isoStamp(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> String {
    String(format: "%04d-%02d-%02dT%02d:00:00Z", year, month, day, hour)
}

/// An energy-based drive sample: `km` kilometres consuming `whPerKm` Wh/km.
private func energyDrive(_ year: Int, _ month: Int, _ day: Int, km: Double, whPerKm: Double) -> DriveEfficiencySample {
    DriveEfficiencySample(
        startTs: isoStamp(year, month, day),
        distanceM: km * 1000,
        energyUsedWh: whPerKm * km
    )
}

/// Identity labeler so projection-based tests stay locale-independent.
private func identityLabel(_ key: String) -> String {
    key
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class DriveEfficiencyChartModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveEfficiencyChartUpdate,
        telemetry: DriveEfficiencyChartTelemetry = OSLogDriveEfficiencyChartTelemetry()
    ) -> (DriveEfficiencyChartModel, InMemoryDriveEfficiencyChartSource) {
        let source = InMemoryDriveEfficiencyChartSource(initial: update)
        let model = DriveEfficiencyChartModel(
            source: source,
            telemetry: telemetry,
            now: { makeDate(2026, 4, 30) },
            calendar: utcCalendar()
        )
        return (model, source)
    }

    private func validDrives() -> [DriveEfficiencySample] {
        (1 ... 5).map { energyDrive(2026, 4, $0, km: 10, whPerKm: 120) }
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(DriveEfficiencyChartUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(
            DriveEfficiencyChartUpdate(status: .loaded, drives: validDrives(), distanceUnit: "km")
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(DriveEfficiencyChartUpdate(status: .loaded, drives: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(DriveEfficiencyChartUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let (failed, _) = makeModel(
            DriveEfficiencyChartUpdate(
                status: .failed("net"),
                connection: .offline,
                drives: validDrives(),
                distanceUnit: "km"
            )
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(
            DriveEfficiencyChartUpdate(status: .loading, drives: validDrives(), distanceUnit: "km")
        )
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDriveEfficiencyChartTelemetry()
        let (model, source) = makeModel(DriveEfficiencyChartUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveEfficiencyChartWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DriveEfficiencyChartUpdate(status: .loaded, drives: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DriveEfficiencyChartUpdate(status: .loading))
        model.start()
        source.push(
            DriveEfficiencyChartUpdate(
                status: .loaded,
                connection: .stale,
                drives: validDrives(),
                distanceUnit: "km",
                updatedAt: makeDate(2026, 4, 30)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.bestDay ?? 0, 120, accuracy: 0.0001)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(DriveEfficiencyChartModel.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertFalse(DriveEfficiencyChartModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(DriveEfficiencyChartModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(DriveEfficiencyChartModel.isWide(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(DriveEfficiencyChartModel.isWide(DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

final class DriveEfficiencyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DriveEfficiencyChartWidget.registration
        XCTAssertEqual(registration.id, "drive-efficiency-chart")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DriveEfficiencyChartWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
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

// MARK: - Accessibility content

final class DriveEfficiencyAccessibilityTests: XCTestCase {
    private func projection() -> DriveEfficiencyProjection {
        DriveEfficiencyBuilder.buildProjection(
            samples: (1 ... 8).map { energyDrive(2026, 4, $0, km: 10, whPerKm: Double(90 + $0 * 10)) },
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
    }

    func testSummaryIncludesStatsAndUnit() {
        let summary = DriveEfficiencyChartAccessibility.summary(for: projection())
        XCTAssertTrue(summary.contains("Avg"))
        XCTAssertTrue(summary.contains("135"))
        XCTAssertTrue(summary.contains("Best day"))
        XCTAssertTrue(summary.contains("100"))
        XCTAssertTrue(summary.contains("Trend"))
        XCTAssertTrue(summary.contains("Wh/km"))
    }

    func testSummaryEmptyWhenNoData() {
        let summary = DriveEfficiencyChartAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No efficiency data yet")
    }

    func testPointLabelIncludesRollingNote() {
        let withRolling = DriveEfficiencyPoint(
            date: "2026-04-08",
            index: 7,
            label: "Apr 8",
            efficiency: 170,
            rollingAvg: 140
        )
        let withoutRolling = DriveEfficiencyPoint(
            date: "2026-04-01",
            index: 0,
            label: "Apr 1",
            efficiency: 100,
            rollingAvg: nil
        )
        let rollingLabel = DriveEfficiencyChartAccessibility.pointLabel(withRolling, unit: "Wh/km")
        XCTAssertTrue(rollingLabel.contains("Apr 8"))
        XCTAssertTrue(rollingLabel.contains("7-day avg"))
        XCTAssertTrue(rollingLabel.contains("140"))
        XCTAssertFalse(DriveEfficiencyChartAccessibility.pointLabel(withoutRolling, unit: "Wh/km")
            .contains("7-day avg"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDriveEfficiencyChartTelemetry: DriveEfficiencyChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
