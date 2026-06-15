//
//  LifetimeStatsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0055 · LifetimeStatsWidget (Apple)
//
//  Unit coverage for the LifetimeStatsWidget surface:
//    • Adapter (cached → projection) — `LifetimeStatsProjector` value parity with the web
//      widget's numeric pipeline (km → mi → display unit, fmtNumber / fmtInt / formatCurrency).
//    • State holder — `LifetimeStatsModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `lifetime-stats` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content per layout.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryLifetimeStatsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class LifetimeStatsAdapterTests: XCTestCase {
    private let sample = LifetimeStatsDTO(
        totalDrives: 1234,
        totalDistanceKm: 50000,
        totalEnergyKwh: 8765.4,
        co2OffsetKg: 4321.6,
        totalChargingCost: 1234.56,
        ownershipDays: 365
    )

    /// Pins the exact display strings the web widget produces for the km preference. The distance
    /// pipeline reproduces the source verbatim: total_distance_km * KM_TO_MI, then
    /// convertDistanceFromSI(value, 'km') = value / 1000.
    func testProjectionKilometers() {
        let units = LifetimeUnitPrefs(distance: .kilometers, currencySymbol: "$", precision: 2)
        let projection = LifetimeStatsProjector.project(stats: sample, units: units)

        XCTAssertEqual(projection.coreStats.count, 4)
        XCTAssertEqual(projection.wideStats.count, 3)

        XCTAssertEqual(projection.coreStats[0].value, "31")
        XCTAssertEqual(projection.coreStats[0].unit, "km")
        XCTAssertEqual(projection.coreStats[1].value, "1,234")
        XCTAssertNil(projection.coreStats[1].unit)
        XCTAssertEqual(projection.coreStats[2].value, "8,765.4")
        XCTAssertEqual(projection.coreStats[2].unit, "kWh")
        XCTAssertEqual(projection.coreStats[3].value, "4,322")
        XCTAssertEqual(projection.coreStats[3].unit, "kg")

        XCTAssertEqual(projection.wideStats[0].value, "$1,234.56")
        XCTAssertEqual(projection.wideStats[1].value, "365")
        XCTAssertEqual(projection.wideStats[2].value, "0.1")
        XCTAssertEqual(projection.wideStats[2].unit, "km")

        XCTAssertEqual(projection.compactValue, "31")
        XCTAssertEqual(projection.distanceSymbol, "km")
    }

    /// Pins the mile branch: convertDistanceFromSI(value, 'mi') = value / 1609.344.
    func testProjectionMiles() {
        let units = LifetimeUnitPrefs(distance: .miles, currencySymbol: "$", precision: 2)
        let projection = LifetimeStatsProjector.project(stats: sample, units: units)

        XCTAssertEqual(projection.coreStats[0].value, "19")
        XCTAssertEqual(projection.coreStats[0].unit, "mi")
        XCTAssertEqual(projection.compactValue, "19")
        XCTAssertEqual(projection.distanceSymbol, "mi")
        XCTAssertEqual(projection.wideStats[2].value, "0.1")
        XCTAssertEqual(projection.wideStats[2].unit, "mi")
    }

    func testProjectionHonorsCurrencySymbolAndPrecision() {
        let units = LifetimeUnitPrefs(distance: .kilometers, currencySymbol: "€", precision: 0)
        let projection = LifetimeStatsProjector.project(stats: sample, units: units)
        XCTAssertEqual(projection.wideStats[0].value, "€1,235")
    }

    func testEmptyStatsProjectToZeroes() {
        let units = LifetimeUnitPrefs(distance: .kilometers, currencySymbol: "$", precision: 2)
        let projection = LifetimeStatsProjector.project(stats: LifetimeStatsDTO(), units: units)
        XCTAssertEqual(projection.coreStats[0].value, "0")
        XCTAssertEqual(projection.coreStats[1].value, "0")
        XCTAssertEqual(projection.wideStats[0].value, "$0.00")
        XCTAssertEqual(projection.wideStats[2].value, "0.0")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(LifetimeStatsWidgetFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(LifetimeStatsWidgetFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(LifetimeStatsWidgetFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(LifetimeStatsWidgetFormat.number(-5, decimals: 0), "-5")
        XCTAssertEqual(LifetimeStatsWidgetFormat.integer(42), "42")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertLifetimeDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(LifetimeStatsWidgetFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertLifetimeDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertLifetimeDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertLifetimeDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class LifetimeStatsPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(LifetimeStatsModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class LifetimeStatsModelTests: XCTestCase {
    private func makeModel(
        _ update: LifetimeStatsUpdate,
        telemetry: LifetimeStatsTelemetry = OSLogLifetimeStatsTelemetry()
    ) -> (LifetimeStatsModel, InMemoryLifetimeStatsSource) {
        let source = InMemoryLifetimeStatsSource(initial: update)
        let model = LifetimeStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(LifetimeStatsUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(LifetimeStatsUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(LifetimeStatsUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let stats = LifetimeStatsDTO(totalDrives: 5, totalDistanceKm: 100)
        let (model, _) = makeModel(LifetimeStatsUpdate(status: .failed("net"), stats: stats))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.projection?.coreStats.count, 4)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLifetimeStatsTelemetry()
        let (model, source) = makeModel(LifetimeStatsUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LifetimeStatsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LifetimeStatsUpdate(status: .loaded, stats: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = LifetimeStatsDTO(totalDrives: 1)
        let (model, source) = makeModel(LifetimeStatsUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LifetimeStatsUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LifetimeStatsUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(LifetimeStatsUpdate(status: .loading, stats: nil))
        model.start()
        source.push(
            LifetimeStatsUpdate(
                status: .loaded,
                connection: .offline,
                stats: LifetimeStatsDTO(totalDrives: 7, totalDistanceKm: 1000),
                units: LifetimeUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertFalse(model.projection?.coreStats.isEmpty ?? true)
    }
}

// MARK: - Registry parity

@MainActor final class LifetimeStatsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = LifetimeStatsWidget.registration
        XCTAssertEqual(registration.id, "lifetime-stats")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(LifetimeStatsWidget.surfaceSlug, "LifetimeStatsWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = LifetimeStatsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class LifetimeStatsAccessibilityTests: XCTestCase {
    private let projection = LifetimeStatsProjector.project(
        stats: LifetimeStatsDTO(
            totalDrives: 1234,
            totalDistanceKm: 50000,
            totalEnergyKwh: 8765.4,
            co2OffsetKg: 4321.6,
            totalChargingCost: 1234.56,
            ownershipDays: 365
        ),
        units: LifetimeUnitPrefs(distance: .kilometers)
    )

    func testWideSummaryIncludesEveryStat() {
        let summary = LifetimeStatsAccessibility.summary(for: projection, isWide: true)
        XCTAssertTrue(summary.contains("Lifetime Stats"))
        XCTAssertTrue(summary.contains("Total Distance 31 km"))
        XCTAssertTrue(summary.contains("Total Drives 1,234"))
        XCTAssertTrue(summary.contains("Total Energy 8,765.4 kWh"))
        XCTAssertTrue(summary.contains("CO₂ Saved 4,322 kg"))
        XCTAssertTrue(summary.contains("Total Cost $1,234.56"))
        XCTAssertTrue(summary.contains("Ownership Days 365"))
        XCTAssertTrue(summary.contains("Avg Daily Distance 0.1 km"))
    }

    func testStandardSummaryOmitsWideStats() {
        let summary = LifetimeStatsAccessibility.summary(for: projection, isWide: false)
        XCTAssertTrue(summary.contains("Total Distance 31 km"))
        XCTAssertFalse(summary.contains("Total Cost"))
        XCTAssertFalse(summary.contains("Ownership Days"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLifetimeStatsTelemetry: LifetimeStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
