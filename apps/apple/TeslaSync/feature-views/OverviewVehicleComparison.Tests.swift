//
//  OverviewVehicleComparison.Tests.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  Unit coverage for the OverviewVehicleComparison surface:
//    • Adapter (cached fleet rows → projection) — `safe`, the SI distance +
//      efficiency conversions, the number formatter, the efficiency leaderboard
//      (sort + percent), the radar normalization (incl. the inverted efficiency
//      axis), the fleet-usage slices, the energy/activity bars, the surface phase
//      + freshness resolution, and the relative-time buckets (port parity).
//    • State holder — `OverviewComparisonModel` phase / freshness / connection /
//      distance-unit tracking plus the P1/S11 `view.opened` telemetry + source
//      wiring.
//    • Accessibility — the radar metric labels, the leaderboard / radar / activity
//      row labels, and the fleet-usage summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by InMemoryOverviewComparisonSource. The pure
//  adapter + accessibility subset is additionally proven by an executed headless
//  harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Sample fleet

private enum OverviewSampleFleet {
    static let vehicles: [OverviewVehicle] = [
        OverviewVehicle(id: 1, name: "Model 3", distanceKm: 1200, energyKwh: 180, efficiencyWhKm: 150, drives: 42),
        OverviewVehicle(id: 2, name: "Model Y", distanceKm: 820, energyKwh: 150, efficiencyWhKm: 183, drives: 30),
        OverviewVehicle(id: 3, name: "Model S", distanceKm: 1540, energyKwh: 268, efficiencyWhKm: 174, drives: 55)
    ]
}

// MARK: - Adapter: guards / conversions / formatting

@MainActor
final class OverviewComparisonBuilderMathTests: XCTestCase {
    func testSafeCoalescesNonFinite() {
        XCTAssertEqual(OverviewComparisonBuilder.safe(12.5), 12.5)
        XCTAssertEqual(OverviewComparisonBuilder.safe(.nan), 0)
        XCTAssertEqual(OverviewComparisonBuilder.safe(.infinity), 0)
    }

    func testConvertDistanceFromSI() {
        XCTAssertEqual(OverviewComparisonBuilder.convertDistanceFromSI(meters: 1000, to: .km), 1, accuracy: 1e-9)
        XCTAssertEqual(
            OverviewComparisonBuilder.convertDistanceFromSI(meters: 1609.344, to: .mi),
            1,
            accuracy: 1e-9
        )
    }

    func testDisplayDistanceConvertsKilometres() {
        XCTAssertEqual(OverviewComparisonBuilder.displayDistance(km: 100, unit: .km), 100, accuracy: 1e-9)
        XCTAssertEqual(
            OverviewComparisonBuilder.displayDistance(km: 1.609344, unit: .mi),
            1,
            accuracy: 1e-9
        )
    }

    func testDisplayEfficiencyScalesForMiles() {
        XCTAssertEqual(OverviewComparisonBuilder.displayEfficiency(whPerKm: 150, unit: .km), 150, accuracy: 1e-9)
        XCTAssertEqual(
            OverviewComparisonBuilder.displayEfficiency(whPerKm: 150, unit: .mi),
            150 * 1.609344,
            accuracy: 1e-6
        )
    }

    func testFormatNumberFractionDigits() {
        XCTAssertTrue(OverviewComparisonBuilder.formatNumber(150.04, fractionDigits: 1).contains("150"))
        XCTAssertTrue(OverviewComparisonBuilder.formatNumber(150.04, fractionDigits: 1).hasSuffix("0"))
        XCTAssertFalse(OverviewComparisonBuilder.formatNumber(.nan, fractionDigits: 1).isEmpty)
    }
}

// MARK: - Adapter: leaderboard / radar / slices / bars

@MainActor
final class OverviewComparisonBuilderProjectionTests: XCTestCase {
    func testLeaderboardSortsAscendingWithRanks() {
        let entries = OverviewComparisonBuilder.leaderboard(OverviewSampleFleet.vehicles, unit: .km)
        XCTAssertEqual(entries.map(\.rank), [1, 2, 3])
        XCTAssertEqual(entries.map(\.name), ["Model 3", "Model S", "Model Y"])
        XCTAssertEqual(entries.first?.id, 1)
    }

    func testLeaderboardPercentAgainstLeastEfficient() {
        let entries = OverviewComparisonBuilder.leaderboard(OverviewSampleFleet.vehicles, unit: .km)
        XCTAssertEqual(entries.last?.pct ?? 0, 100, accuracy: 1e-9)
        XCTAssertEqual(entries.first?.pct ?? 0, 150.0 / 183.0 * 100, accuracy: 1e-6)
    }

    func testLeaderboardEfficiencyTextUsesUnit() {
        let km = OverviewComparisonBuilder.leaderboard(OverviewSampleFleet.vehicles, unit: .km)
        XCTAssertTrue(km.first?.efficiencyText.contains("Wh/km") ?? false)
        let mi = OverviewComparisonBuilder.leaderboard(OverviewSampleFleet.vehicles, unit: .mi)
        XCTAssertTrue(mi.first?.efficiencyText.contains("Wh/mi") ?? false)
    }

    func testLeaderboardEmptyForNoVehicles() {
        XCTAssertTrue(OverviewComparisonBuilder.leaderboard([], unit: .km).isEmpty)
    }

    func testRadarRequiresTwoVehicles() {
        XCTAssertFalse(OverviewComparisonBuilder.showsRadar([OverviewSampleFleet.vehicles[0]]))
        XCTAssertTrue(OverviewComparisonBuilder.showsRadar(OverviewSampleFleet.vehicles))
        XCTAssertTrue(OverviewComparisonBuilder.radarVehicles([OverviewSampleFleet.vehicles[0]]).isEmpty)
    }

    func testRadarNormalizationWithinUnitRange() {
        let radar = OverviewComparisonBuilder.radarVehicles(OverviewSampleFleet.vehicles)
        XCTAssertEqual(radar.count, 3)
        for vehicle in radar {
            for metric in OverviewRadarMetric.allCases {
                let value = OverviewComparisonBuilder.radarValue(vehicle, metric: metric)
                XCTAssertGreaterThanOrEqual(value, 0)
                XCTAssertLessThanOrEqual(value, 1)
            }
        }
    }

    func testRadarEfficiencyAxisIsInverted() {
        let radar = OverviewComparisonBuilder.radarVehicles(OverviewSampleFleet.vehicles)
        // Model 3 has the lowest Wh/km (most efficient) → the largest efficiency spoke.
        let mostEfficient = radar.first { $0.id == 1 }
        let leastEfficient = radar.first { $0.id == 2 }
        XCTAssertNotNil(mostEfficient)
        XCTAssertNotNil(leastEfficient)
        XCTAssertGreaterThan(mostEfficient?.efficiencyNorm ?? 0, leastEfficient?.efficiencyNorm ?? 1)
        XCTAssertEqual(leastEfficient?.efficiencyNorm ?? -1, 0, accuracy: 1e-9)
    }

    func testFleetUsageSlicesConvertAndColorWrap() {
        let slices = OverviewComparisonBuilder.fleetUsage(OverviewSampleFleet.vehicles, unit: .km)
        XCTAssertEqual(slices.map(\.value), [1200, 820, 1540])
        XCTAssertEqual(slices.map(\.colorIndex), [0, 1, 2])
        let miles = OverviewComparisonBuilder.fleetUsage(OverviewSampleFleet.vehicles, unit: .mi)
        XCTAssertEqual(miles.first?.value ?? 0, 1200 / 1.609344, accuracy: 1e-6)
    }

    func testEnergyActivityPassesThroughGuarded() {
        let bars = OverviewComparisonBuilder.energyActivity(OverviewSampleFleet.vehicles)
        XCTAssertEqual(bars.map(\.energyKwh), [180, 150, 268])
        XCTAssertEqual(bars.map(\.drives), [42, 30, 55])
    }
}

// MARK: - Adapter: phase / freshness / relative time

@MainActor
final class OverviewComparisonBuilderStateTests: XCTestCase {
    func testResolvePhase() {
        XCTAssertEqual(OverviewComparisonBuilder.resolvePhase(status: .loading, vehicleCount: 0), .loading)
        XCTAssertEqual(OverviewComparisonBuilder.resolvePhase(status: .loaded, vehicleCount: 0), .empty)
        XCTAssertEqual(OverviewComparisonBuilder.resolvePhase(status: .empty, vehicleCount: 0), .empty)
        XCTAssertEqual(OverviewComparisonBuilder.resolvePhase(status: .failed("x"), vehicleCount: 0), .error("x"))
        XCTAssertEqual(OverviewComparisonBuilder.resolvePhase(status: .loading, vehicleCount: 3), .content)
        XCTAssertEqual(OverviewComparisonBuilder.resolvePhase(status: .failed("x"), vehicleCount: 3), .content)
    }

    func testResolveFreshnessPrecedence() {
        XCTAssertEqual(OverviewComparisonBuilder.resolveFreshness(.init(connection: .offline)), .offline)
        XCTAssertEqual(OverviewComparisonBuilder.resolveFreshness(.init(isError: true)), .error)
        XCTAssertEqual(OverviewComparisonBuilder.resolveFreshness(.init(isFetching: true)), .fetching)
        XCTAssertEqual(OverviewComparisonBuilder.resolveFreshness(.init(connection: .stale)), .stale)
        XCTAssertEqual(OverviewComparisonBuilder.resolveFreshness(.init()), .fresh)
        XCTAssertEqual(
            OverviewComparisonBuilder.resolveFreshness(.init(connection: .offline, isError: true)),
            .offline
        )
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertEqual(OverviewComparisonBuilder.relativeTime(since: now, now: now), "just now")
        XCTAssertTrue(OverviewComparisonBuilder.relativeTime(since: now.addingTimeInterval(-120), now: now)
            .contains("2"))
        XCTAssertTrue(
            OverviewComparisonBuilder.relativeTime(since: now.addingTimeInterval(-7200), now: now).contains("2")
        )
        XCTAssertTrue(
            OverviewComparisonBuilder.relativeTime(since: now.addingTimeInterval(-172_800), now: now).contains("2")
        )
        XCTAssertTrue(
            OverviewComparisonBuilder.relativeTime(since: now.addingTimeInterval(-1_209_600), now: now).contains("2")
        )
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class OverviewComparisonModelTests: XCTestCase {
    private func makeModel(
        _ update: OverviewComparisonUpdate,
        telemetry: OverviewComparisonTelemetry = OSLogOverviewComparisonTelemetry()
    ) -> (OverviewComparisonModel, InMemoryOverviewComparisonSource) {
        let source = InMemoryOverviewComparisonSource(initial: update)
        let model = OverviewComparisonModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutVehiclesShowsLoading() {
        let (model, _) = makeModel(.init(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutVehiclesShowsEmpty() {
        let (model, _) = makeModel(.init(status: .loaded, vehicles: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutVehiclesShowsError() {
        let (model, _) = makeModel(.init(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testContentWhenVehiclesPresentEvenIfFailed() {
        let (model, _) = makeModel(.init(status: .failed("net"), vehicles: OverviewSampleFleet.vehicles))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vehicleCount, 3)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyOverviewComparisonTelemetry()
        let (model, source) = makeModel(.init(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [OverviewComparisonModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(.init(status: .loaded, vehicles: OverviewSampleFleet.vehicles))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionFreshnessAndUnitTrackUpdates() {
        let (model, source) = makeModel(.init(status: .loading))
        model.start()
        source.push(
            .init(
                status: .loaded,
                connection: .offline,
                vehicles: OverviewSampleFleet.vehicles,
                distanceUnit: .mi,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.distanceUnit, .mi)
    }

    func testSurfaceSlugIsCanonical() {
        XCTAssertEqual(OverviewVehicleComparison.surfaceSlug, "OverviewVehicleComparison")
        XCTAssertEqual(OverviewComparisonModel.surfaceSlug, "OverviewVehicleComparison")
    }
}

// MARK: - Accessibility label content

@MainActor
final class OverviewComparisonAccessibilityTests: XCTestCase {
    func testRadarMetricLabelsResolve() {
        XCTAssertEqual(OverviewComparisonAccessibility.radarMetricLabel(.distance), "Distance")
        XCTAssertEqual(OverviewComparisonAccessibility.radarMetricLabel(.energy), "Energy")
        XCTAssertEqual(OverviewComparisonAccessibility.radarMetricLabel(.drives), "Drives")
        XCTAssertEqual(OverviewComparisonAccessibility.radarMetricLabel(.efficiency), "Efficiency")
    }

    func testLeaderboardLabelIncludesRankNameEfficiency() {
        let entries = OverviewComparisonBuilder.leaderboard(OverviewSampleFleet.vehicles, unit: .km)
        let label = OverviewComparisonAccessibility.leaderboardLabel(entries[0])
        XCTAssertTrue(label.contains("Model 3"))
        XCTAssertTrue(label.contains("Wh/km"))
        XCTAssertTrue(label.contains("1"))
    }

    func testRadarVehicleLabelIncludesMetrics() {
        let radar = OverviewComparisonBuilder.radarVehicles(OverviewSampleFleet.vehicles)
        let label = OverviewComparisonAccessibility.radarVehicleLabel(radar[0])
        XCTAssertTrue(label.contains("Model 3"))
        XCTAssertTrue(label.contains("Distance"))
        XCTAssertTrue(label.contains("Efficiency"))
        XCTAssertTrue(label.contains("%"))
    }

    func testActivityLabelIncludesEnergyAndDrives() {
        let bars = OverviewComparisonBuilder.energyActivity(OverviewSampleFleet.vehicles)
        let label = OverviewComparisonAccessibility.activityLabel(bars[0])
        XCTAssertTrue(label.contains("Model 3"))
        XCTAssertTrue(label.contains("Energy"))
        XCTAssertTrue(label.contains("Drives"))
    }

    func testFleetUsageSummaryListsVehiclesAndUnit() {
        let slices = OverviewComparisonBuilder.fleetUsage(OverviewSampleFleet.vehicles, unit: .km)
        let summary = OverviewComparisonAccessibility.fleetUsageSummary(slices, unit: .km)
        XCTAssertTrue(summary.contains("Model 3"))
        XCTAssertTrue(summary.contains("km"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyOverviewComparisonTelemetry: OverviewComparisonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
