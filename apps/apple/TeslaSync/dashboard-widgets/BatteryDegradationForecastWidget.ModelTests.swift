//
//  BatteryDegradationForecastWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  State-holder + registry coverage for the BatteryDegradationForecastWidget
//  surface (the adapter / formatting / accessibility coverage lives in
//  BatteryDegradationForecastWidget.Tests.swift):
//    • State holder — `BatteryDegradationForecastModel` phase resolution across
//      loading / empty / error / content (empty vs cached), the P1/S11
//      `view.opened` telemetry, refresh delegation, and connection tracking.
//    • Registry — canonical `battery-degradation-forecast` metadata + size clamp.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real
//  store: the model is driven by `InMemoryBatteryDegradationForecastSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum BatteryDegradationForecastWidgetForecastFixture {
    static func projectedDate() -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar.date(from: DateComponents(year: 2027, month: 4, day: 1)) ?? Date(timeIntervalSince1970: 0)
    }

    static func riskFactors(_ count: Int) -> [BatteryDegradationForecastRiskFactor] {
        (0 ..< count).map { index in
            BatteryDegradationForecastRiskFactor(
                name: "Risk \(index)",
                score: Double(index),
                label: "Label \(index)",
                detail: "d"
            )
        }
    }

    static func populated() -> BatteryDegradationForecastSnapshot {
        BatteryDegradationForecastSnapshot(
            currentHealthPct: 92.4,
            degradationRatePctPerMonth: 0.11,
            projected80Date: projectedDate(),
            riskFactors: riskFactors(3),
            recommendations: ["A", "B"]
        )
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class BatteryDegradationForecastModelTests: XCTestCase {
    private let vehicle = BatteryDegradationForecastVehicle(id: 7, displayName: "Lightning")

    private func makeModel(
        _ update: BatteryDegradationForecastUpdate,
        telemetry: BatteryDegradationForecastTelemetry = OSLogBatteryDegradationForecastTelemetry()
    ) -> (BatteryDegradationForecastModel, InMemoryBatteryDegradationForecastSource) {
        let source = InMemoryBatteryDegradationForecastSource(initial: update)
        let model = BatteryDegradationForecastModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutContentShowsLoading() {
        let (model, _) = makeModel(BatteryDegradationForecastUpdate(status: .loading, snapshot: .empty))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedContentStaysContent() {
        let (model, _) = makeModel(
            BatteryDegradationForecastUpdate(
                status: .loading,
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated()
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(BatteryDegradationForecastUpdate(status: .loaded, snapshot: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(
            BatteryDegradationForecastUpdate(
                status: .loaded,
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated()
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.currentHealth, 92.4)
        XCTAssertEqual(model.projection.tier, .normal)
        XCTAssertEqual(model.projection.visibleRiskFactors.count, 3)
    }

    func testEmptyStatusShowsEmptyEvenWithCache() {
        let (model, _) = makeModel(
            BatteryDegradationForecastUpdate(
                status: .empty,
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated()
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(BatteryDegradationForecastUpdate(status: .failed("boom"), snapshot: .empty))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCacheStaysContent() {
        let (model, _) = makeModel(
            BatteryDegradationForecastUpdate(
                status: .failed("boom"),
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated()
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = BDFSpyForecastTelemetry()
        let (model, source) = makeModel(
            BatteryDegradationForecastUpdate(status: .loading, snapshot: .empty),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryDegradationForecastWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(
            BatteryDegradationForecastUpdate(
                status: .loaded,
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated()
            )
        )
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopResetsStartedSoTelemetryReArms() {
        let spy = BDFSpyForecastTelemetry()
        let (model, _) = makeModel(
            BatteryDegradationForecastUpdate(
                status: .loaded,
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated()
            ),
            telemetry: spy
        )
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(BatteryDegradationForecastUpdate(status: .loading, snapshot: .empty))
        model.start()
        source.push(
            BatteryDegradationForecastUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: vehicle,
                snapshot: BatteryDegradationForecastWidgetForecastFixture.populated(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vehicle, vehicle)
    }

    func testIsCompactUsesColumnCount() {
        XCTAssertTrue(BatteryDegradationForecastModel.isCompact(DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(BatteryDegradationForecastModel.isCompact(DashboardWidgetSize(cols: 2, rows: 1)))
    }

    func testResolvePhaseDirectly() {
        let empty = BatteryDegradationForecastProjection.empty
        let filled = BatteryDegradationForecastBuilder
            .buildProjection(snapshot: BatteryDegradationForecastWidgetForecastFixture.populated())
        XCTAssertEqual(
            BatteryDegradationForecastModel.resolvePhase(status: .loading, projection: empty),
            .loading
        )
        XCTAssertEqual(
            BatteryDegradationForecastModel.resolvePhase(status: .loading, projection: filled),
            .content
        )
        XCTAssertEqual(
            BatteryDegradationForecastModel.resolvePhase(status: .loaded, projection: empty),
            .empty
        )
        XCTAssertEqual(
            BatteryDegradationForecastModel.resolvePhase(status: .failed("x"), projection: empty),
            .error("x")
        )
        XCTAssertEqual(
            BatteryDegradationForecastModel.resolvePhase(status: .failed("x"), projection: filled),
            .content
        )
    }
}

// MARK: - Registry parity

@MainActor final class BatteryDegradationForecastRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = BatteryDegradationForecastWidget.registration
        XCTAssertEqual(registration.id, "battery-degradation-forecast")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(BatteryDegradationForecastWidget.surfaceSlug, "BatteryDegradationForecastWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = BatteryDegradationForecastWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)),
            DashboardWidgetSize(cols: 2, rows: 8)
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class BDFSpyForecastTelemetry: BatteryDegradationForecastTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
