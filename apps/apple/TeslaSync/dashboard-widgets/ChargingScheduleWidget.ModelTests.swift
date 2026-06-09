//
//  ChargingScheduleWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  State-holder / registry / accessibility coverage for the surface:
//    • `ChargingScheduleModel` phase resolution across loading / empty / error /
//      content, the P1/S11 `view.opened` telemetry, source wiring (start/refresh),
//      stale auto-refresh, freshness/projection tracking, and the compact/tall
//      thresholds.
//    • Registry — canonical `charging-schedule` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  The pure adapter/format coverage lives in ChargingScheduleWidget.Tests.swift.
//  Both run in the TeslaSync(/-macOS) XCTest targets with no network and no real
//  store: the model is driven by `InMemoryChargingScheduleSource`.
//

import XCTest
@testable import TeslaSync

private let modelOptions = ChargingScheduleFormatOptions(
    localeIdentifier: "en_US",
    timeZoneIdentifier: "America/Los_Angeles"
)

private func modelSignals(
    mode: String? = "StartAt",
    pending: Bool = true,
    start: String? = "2026-06-08T23:30:00Z",
    departure: String? = "2026-06-09T15:00:00Z",
    soc: Int? = 80
) -> ChargingScheduleSignals {
    ChargingScheduleSignals(
        mode: mode,
        pending: pending,
        startTime: start,
        departureTime: departure,
        chargeLimitSoc: soc
    )
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargingScheduleModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingScheduleUpdate,
        telemetry: ChargingScheduleTelemetry = OSLogChargingScheduleTelemetry()
    ) -> (ChargingScheduleModel, InMemoryChargingScheduleSource) {
        let source = InMemoryChargingScheduleSource(initial: update)
        let model = ChargingScheduleModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargingScheduleUpdate(status: .loading, signals: ChargingScheduleSignals()))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ChargingScheduleUpdate(status: .loaded, signals: ChargingScheduleSignals()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargingScheduleUpdate(status: .failed("boom"), signals: ChargingScheduleSignals()))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testScheduleDataShowsContentEvenWhileLoadingOrFailed() {
        let signals = modelSignals()
        let (loading, _) = makeModel(ChargingScheduleUpdate(status: .loading, signals: signals))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(ChargingScheduleUpdate(status: .failed("net"), signals: signals))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargingScheduleTelemetry()
        let (model, source) = makeModel(ChargingScheduleUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingScheduleWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargingScheduleUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (staleModel, staleSource) = makeModel(
            ChargingScheduleUpdate(status: .loaded, connection: .stale, isFetching: false, signals: modelSignals())
        )
        staleModel.start()
        staleModel.autoRefreshIfStale()
        XCTAssertEqual(staleSource.refreshCount, 1)

        let (liveModel, liveSource) = makeModel(
            ChargingScheduleUpdate(status: .loaded, connection: .live, signals: modelSignals())
        )
        liveModel.start()
        liveModel.autoRefreshIfStale()
        XCTAssertEqual(liveSource.refreshCount, 0)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargingScheduleUpdate(status: .loading))
        model.start()
        source.push(
            ChargingScheduleUpdate(
                status: .loaded,
                connection: .offline,
                signals: modelSignals(mode: "DepartBy"),
                state: ChargingScheduleStateDTO(batteryLevel: 55, isCharging: false),
                options: modelOptions,
                updatedAt: Date(timeIntervalSince1970: 5000)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasScheduleData)
        XCTAssertEqual(model.projection.mode.label, "Depart By")
        XCTAssertEqual(model.projection.timelineItems.first?.id, "start")
        XCTAssertEqual(model.updatedAt, Date(timeIntervalSince1970: 5000))
    }

    func testCompactAndTallThresholds() {
        XCTAssertTrue(ChargingScheduleModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertFalse(ChargingScheduleModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(ChargingScheduleModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 2)))

        XCTAssertTrue(ChargingScheduleModel.isTall(for: DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(ChargingScheduleModel.isTall(for: DashboardWidgetSize(cols: 2, rows: 1)))
    }
}

// MARK: - Registry parity

@MainActor final class ChargingScheduleRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargingScheduleWidget.registration
        XCTAssertEqual(registration.id, "charging-schedule")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ChargingScheduleWidget.surfaceSlug, "ChargingScheduleWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargingScheduleWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

final class ChargingScheduleAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleModeAndScheduledRows() {
        let projection = ChargingScheduleAdapter.project(
            signals: modelSignals(),
            state: ChargingScheduleStateDTO(batteryLevel: 64, isCharging: true),
            options: modelOptions
        )
        let summary = ChargingScheduleAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Charging Schedule"))
        XCTAssertTrue(summary.contains("Start At"))
        XCTAssertTrue(summary.contains("Pending"))
        XCTAssertTrue(summary.contains("Start Charging"))
        XCTAssertTrue(summary.contains("4:30 PM"))
        XCTAssertTrue(summary.contains("Target Limit"))
        XCTAssertTrue(summary.contains("80%"))
    }

    func testSummaryHandlesNoScheduleData() {
        let projection = ChargingScheduleAdapter.project(
            signals: ChargingScheduleSignals(),
            state: nil,
            options: modelOptions
        )
        let summary = ChargingScheduleAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Charging Schedule"))
        XCTAssertTrue(summary.contains("No schedule data"))
    }

    func testSummaryHandlesNoScheduledTimes() {
        let projection = ChargingScheduleAdapter.project(
            signals: ChargingScheduleSignals(mode: "Off"),
            state: nil,
            options: modelOptions
        )
        let summary = ChargingScheduleAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Off"))
        XCTAssertTrue(summary.contains("No scheduled times set"))
    }

    func testCompactSummary() {
        let summary = ChargingScheduleAccessibility.compactSummary(limitText: "80%")
        XCTAssertTrue(summary.contains("Charge Limit"))
        XCTAssertTrue(summary.contains("80%"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingScheduleTelemetry: ChargingScheduleTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
