//
//  FleetStatsBarWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0050 · FleetStatsBarWidget (Apple)
//
//  Unit coverage for the FleetStatsBarWidget surface:
//    • Adapter (cached → projection) — `FleetStatsBarProjector` value parity with the web
//      widget's numeric pipeline (convertDistanceFromSI on total_distance_km, fmtNumber,
//      raw count rendering, online-percent).
//    • State holder — `FleetStatsBarModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `fleet-stats-bar` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryFleetStatsBarSource`. Every pinned string below was captured
//  by executing the adapter on this host (see the surface's gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class FleetStatsBarAdapterTests: XCTestCase {
    private let sample = FleetStatsBarDTO(
        vehicleCount: 4,
        onlineCount: 3,
        totalDistanceKm: 12345.6,
        totalEnergyKwh: 2345.67,
        hasVehicles: true,
        hasAnalytics: true
    )

    /// Pins the exact display strings the web widget produces for the km preference. The counts
    /// render raw (React `{number}` → no grouping); the distance feeds `total_distance_km`
    /// straight into `convertDistanceFromSI(value, 'km') = value / 1000`; energy + distance use
    /// `fmtNumber(v, 1)`.
    func testProjectionKilometers() {
        let projection = FleetStatsBarProjector.project(
            stats: sample,
            units: FleetStatsBarUnitPrefs(distance: .kilometers)
        )

        XCTAssertEqual(projection.items.count, 4)

        XCTAssertEqual(projection.items[0].value, "4")
        XCTAssertNil(projection.items[0].unit)
        XCTAssertEqual(projection.items[1].value, "3")
        XCTAssertNil(projection.items[1].unit)
        XCTAssertEqual(projection.items[2].value, "12.3")
        XCTAssertEqual(projection.items[2].unit, "km")
        XCTAssertEqual(projection.items[3].value, "2,345.7")
        XCTAssertEqual(projection.items[3].unit, "kWh")

        XCTAssertEqual(projection.onlineCount, 3)
        XCTAssertEqual(projection.onlinePercent, "75%")
    }

    /// Pins the mile branch: `convertDistanceFromSI(value, 'mi') = value / 1609.344`.
    func testProjectionMiles() {
        let projection = FleetStatsBarProjector.project(
            stats: sample,
            units: FleetStatsBarUnitPrefs(distance: .miles)
        )
        XCTAssertEqual(projection.items[2].value, "7.7")
        XCTAssertEqual(projection.items[2].unit, "mi")
    }

    /// Pins the foot branch: `convertDistanceFromSI(value, 'ft') = value / 0.3048`.
    func testProjectionFeet() {
        let projection = FleetStatsBarProjector.project(
            stats: sample,
            units: FleetStatsBarUnitPrefs(distance: .feet)
        )
        XCTAssertEqual(projection.items[2].value, "40,503.9")
        XCTAssertEqual(projection.items[2].unit, "ft")
    }

    /// The online percent is suppressed (nil) when there are no vehicles to divide by, matching
    /// the web `vehicleCount > 0 ? … : undefined` guard. The grid still projects four tiles.
    func testEmptyStatsProjectToZeroesAndNilPercent() {
        let projection = FleetStatsBarProjector.project(
            stats: FleetStatsBarDTO(),
            units: FleetStatsBarUnitPrefs()
        )
        XCTAssertEqual(projection.items[0].value, "0")
        XCTAssertEqual(projection.items[1].value, "0")
        XCTAssertEqual(projection.items[2].value, "0.0")
        XCTAssertEqual(projection.items[3].value, "0.0")
        XCTAssertNil(projection.onlinePercent)
        XCTAssertEqual(projection.onlineCount, 0)
    }

    /// Counts render exactly as React renders a numeric `StatCard` value: `String(n)` with no
    /// locale grouping separators (distinct from the grouped `fmtNumber` used for distance/energy).
    func testCountsRenderWithoutGroupingSeparators() {
        XCTAssertEqual(FleetStatsBarFormat.count(1234), "1234")
        XCTAssertEqual(FleetStatsBarFormat.count(0), "0")
        let projection = FleetStatsBarProjector.project(
            stats: FleetStatsBarDTO(vehicleCount: 1234, onlineCount: 1000, hasVehicles: true),
            units: FleetStatsBarUnitPrefs()
        )
        XCTAssertEqual(projection.items[0].value, "1234")
        XCTAssertEqual(projection.items[1].value, "1000")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(FleetStatsBarFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(FleetStatsBarFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(FleetStatsBarFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(FleetStatsBarFormat.number(-5, decimals: 0), "-5")
        XCTAssertEqual(FleetStatsBarFormat.number(1000, decimals: 1), "1,000.0")
    }

    func testPercentFormatting() {
        XCTAssertEqual(FleetStatsBarFormat.percent(75), "75%")
        XCTAssertEqual(FleetStatsBarFormat.percent((1.0 / 3.0) * 100), "33%")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertFleetStatsBarDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(FleetStatsBarFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertFleetStatsBarDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertFleetStatsBarDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertFleetStatsBarDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }

    func testHasDataMirrorsWebGate() {
        XCTAssertFalse(FleetStatsBarDTO().hasData)
        XCTAssertTrue(FleetStatsBarDTO(hasVehicles: true).hasData)
        XCTAssertTrue(FleetStatsBarDTO(hasAnalytics: true).hasData)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class FleetStatsBarPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(FleetStatsBarModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class FleetStatsBarModelTests: XCTestCase {
    private func makeModel(
        _ update: FleetStatsBarUpdate,
        telemetry: FleetStatsBarTelemetry = OSLogFleetStatsBarTelemetry()
    ) -> (FleetStatsBarModel, InMemoryFleetStatsBarSource) {
        let source = InMemoryFleetStatsBarSource(initial: update)
        let model = FleetStatsBarModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(FleetStatsBarUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(FleetStatsBarUpdate(status: .loaded, stats: FleetStatsBarDTO()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(FleetStatsBarUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let stats = FleetStatsBarDTO(vehicleCount: 5, hasVehicles: true)
        let (model, _) = makeModel(FleetStatsBarUpdate(status: .failed("net"), stats: stats))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.items.count, 4)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyFleetStatsBarTelemetry()
        let (model, source) = makeModel(FleetStatsBarUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FleetStatsBarWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(FleetStatsBarUpdate(status: .loaded, stats: FleetStatsBarDTO()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = FleetStatsBarDTO(vehicleCount: 1, hasVehicles: true)
        let (model, source) = makeModel(FleetStatsBarUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(FleetStatsBarUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(FleetStatsBarUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(FleetStatsBarUpdate(status: .loading, stats: nil))
        model.start()
        source.push(
            FleetStatsBarUpdate(
                status: .loaded,
                connection: .offline,
                stats: FleetStatsBarDTO(
                    vehicleCount: 2,
                    onlineCount: 1,
                    totalDistanceKm: 1000,
                    hasVehicles: true,
                    hasAnalytics: true
                ),
                units: FleetStatsBarUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection?.items.count, 4)
    }
}

// MARK: - Registry parity

@MainActor final class FleetStatsBarRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = FleetStatsBarWidget.registration
        XCTAssertEqual(registration.id, "fleet-stats-bar")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 4, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 3, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(FleetStatsBarWidget.surfaceSlug, "FleetStatsBarWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = FleetStatsBarWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 3, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 4, rows: 10)),
            DashboardWidgetSize(cols: 4, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class FleetStatsBarAccessibilityTests: XCTestCase {
    private let projection = FleetStatsBarProjector.project(
        stats: FleetStatsBarDTO(
            vehicleCount: 4,
            onlineCount: 3,
            totalDistanceKm: 12345.6,
            totalEnergyKwh: 2345.67,
            hasVehicles: true,
            hasAnalytics: true
        ),
        units: FleetStatsBarUnitPrefs(distance: .kilometers)
    )

    func testSummaryIncludesEveryTileAndOnlineShare() {
        let summary = FleetStatsBarAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Fleet Stats"))
        XCTAssertTrue(summary.contains("Vehicles 4"))
        XCTAssertTrue(summary.contains("Online Now 3"))
        XCTAssertTrue(summary.contains("Distance (30d) 12.3 km"))
        XCTAssertTrue(summary.contains("Energy (30d) 2,345.7 kWh"))
        XCTAssertTrue(summary.contains("3 online"))
        XCTAssertTrue(summary.contains("75%"))
    }

    func testSummaryOmitsPercentWhenNoVehicles() {
        let projection = FleetStatsBarProjector.project(
            stats: FleetStatsBarDTO(hasAnalytics: true),
            units: FleetStatsBarUnitPrefs()
        )
        let summary = FleetStatsBarAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("0 online"))
        XCTAssertFalse(summary.contains("%"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFleetStatsBarTelemetry: FleetStatsBarTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
