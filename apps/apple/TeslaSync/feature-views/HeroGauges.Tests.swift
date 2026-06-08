//
//  HeroGauges.Tests.swift
//  TeslaSync — P4 feature view · 0058 · HeroGauges (Apple)
//
//  Unit + UI coverage for the HeroGauges surface:
//    • Adapter (cached → projection) — `HeroGaugesFormat` number/integer/currency parity with the
//      web `fmtNumber`/`fmtInt`/`formatCurrency`, `convertHeroDistanceFromSI`, and the
//      `HeroGaugesProjector` six-gauge math (distance conversion, miles efficiency factor, the
//      KM-tied gas-savings + CO₂ heuristics, the `max(savings, 0)` clamp, accents + symbols).
//    • State holder — `HeroGaugesModel` phase resolution across loading / empty / error / content,
//      projection recompute, refresh delegation, the stale auto-refresh guard, and the P1/S11
//      `view.opened` telemetry.
//    • Accessibility — the VoiceOver gauge summary.
//    • View — every render state (loading / empty / error / stale / offline / content) materializes.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryHeroGaugesSource`); the view tests render through `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting + conversion (web parity)

final class HeroGaugesFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(HeroGaugesFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(HeroGaugesFormat.number(1234.567, decimals: 2), "1,234.57")
        XCTAssertEqual(HeroGaugesFormat.number(0, decimals: 0), "0")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(HeroGaugesFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(HeroGaugesFormat.number(2.5, decimals: 0), "3")
    }

    func testIntegerGroups() {
        XCTAssertEqual(HeroGaugesFormat.integer(1234), "1,234")
        XCTAssertEqual(HeroGaugesFormat.integer(0), "0")
    }

    func testCurrencyPrefixesSymbol() {
        XCTAssertEqual(HeroGaugesFormat.currency(1234.4, symbol: "$", decimals: 0), "$1,234")
        XCTAssertEqual(HeroGaugesFormat.currency(0, symbol: "€", decimals: 0), "€0")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(HeroGaugesFormat.safeNumber(.nan), 0)
        XCTAssertEqual(HeroGaugesFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(HeroGaugesFormat.safeNumber(42.5), 42.5)
    }

    func testDistanceConversionDivisors() {
        XCTAssertEqual(convertHeroDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertHeroDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertHeroDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertHeroDistanceFromSI(.nan, to: .kilometers), 0)
    }
}

// MARK: - Adapter: projector six-gauge math (web parity)

final class HeroGaugesProjectorTests: XCTestCase {
    private func tile(_ id: String, in projection: HeroGaugesProjection) -> HeroGaugeTileModel? {
        projection.tiles.first { $0.id == id }
    }

    private func sample(totalCost: Double = 50) -> HeroAnalyticsDTO {
        HeroAnalyticsDTO(
            totalDistanceKm: 1000,
            totalDrives: 1234,
            totalEnergyKwh: 250.5,
            totalCost: totalCost,
            avgEfficiencyWhKm: 160
        )
    }

    func testGaugeOrderAndIdentity() {
        let projection = HeroGaugesProjector.project(analytics: sample(), units: HeroUnitPrefs())
        XCTAssertEqual(
            projection.tiles.map(\.id),
            ["distance", "drives", "energy", "efficiency", "gas-savings", "co2-saved"]
        )
        XCTAssertEqual(projection.tiles.map(\.accent), [.cyan, .purple, .green, .amber, .green, .green])
        XCTAssertEqual(tile("distance", in: projection)?.systemImage, "mappin.and.ellipse")
        XCTAssertEqual(tile("co2-saved", in: projection)?.systemImage, "leaf.fill")
    }

    func testKilometersBranch() {
        let units = HeroUnitPrefs(distance: .kilometers)
        let projection = HeroGaugesProjector.project(analytics: sample(), units: units)
        // convert(1000 km * 1000 m, km) == 1000 km
        XCTAssertEqual(tile("distance", in: projection)?.value, HeroGaugesFormat.number(1000, decimals: 1))
        XCTAssertEqual(tile("distance", in: projection)?.subtitle, "km")
        XCTAssertEqual(tile("drives", in: projection)?.value, "1,234")
        XCTAssertEqual(tile("energy", in: projection)?.value, HeroGaugesFormat.number(250.5, decimals: 1))
        XCTAssertEqual(tile("energy", in: projection)?.subtitle, "kWh")
        // efficiency stays Wh/km in the kilometres branch
        XCTAssertEqual(tile("efficiency", in: projection)?.value, HeroGaugesFormat.number(160, decimals: 1))
        XCTAssertEqual(tile("efficiency", in: projection)?.subtitle, "Wh/km")
    }

    func testMilesBranchConvertsDistanceAndEfficiency() {
        let units = HeroUnitPrefs(distance: .miles)
        let projection = HeroGaugesProjector.project(analytics: sample(), units: units)
        let expectedMiles = convertHeroDistanceFromSI(1000 * 1000, to: .miles)
        XCTAssertEqual(tile("distance", in: projection)?.value, HeroGaugesFormat.number(expectedMiles, decimals: 1))
        XCTAssertEqual(tile("distance", in: projection)?.subtitle, "mi")
        // efficiency converts Wh/km → Wh/mi by KM_PER_MILE (1.609344)
        XCTAssertEqual(tile("efficiency", in: projection)?.value, HeroGaugesFormat.number(160 * 1.609344, decimals: 1))
        XCTAssertEqual(tile("efficiency", in: projection)?.subtitle, "Wh/mi")
    }

    func testGasSavingsHeuristicAndCurrency() {
        // 1000 km * 0.085 * 1.5 = 127.5 ; minus total_cost 50 = 77.5 → "$78" (half rounds up)
        let projection = HeroGaugesProjector.project(analytics: sample(totalCost: 50), units: HeroUnitPrefs())
        XCTAssertEqual(
            tile("gas-savings", in: projection)?.value,
            HeroGaugesFormat.currency(77.5, symbol: "$", decimals: 0)
        )
        XCTAssertNil(tile("gas-savings", in: projection)?.subtitle)
    }

    func testGasSavingsClampsAtZero() {
        // total_cost exceeds the gross savings → max(savings, 0) = 0
        let projection = HeroGaugesProjector.project(analytics: sample(totalCost: 10000), units: HeroUnitPrefs())
        XCTAssertEqual(
            tile("gas-savings", in: projection)?.value,
            HeroGaugesFormat.currency(0, symbol: "$", decimals: 0)
        )
    }

    func testCo2Heuristic() {
        // 1000 km * 0.12 = 120 kg
        let projection = HeroGaugesProjector.project(analytics: sample(), units: HeroUnitPrefs())
        XCTAssertEqual(tile("co2-saved", in: projection)?.value, HeroGaugesFormat.number(120, decimals: 0))
        XCTAssertEqual(tile("co2-saved", in: projection)?.subtitle, "kg")
    }

    func testCurrencySymbolFromPrefs() {
        let units = HeroUnitPrefs(distance: .kilometers, currencySymbol: "€")
        let projection = HeroGaugesProjector.project(analytics: sample(totalCost: 0), units: units)
        XCTAssertEqual(tile("gas-savings", in: projection)?.value.first.map(String.init), "€")
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class HeroGaugesModelTests: XCTestCase {
    private func makeModel(
        _ update: HeroGaugesUpdate,
        telemetry: HeroGaugesTelemetry = OSLogHeroGaugesTelemetry()
    ) -> (HeroGaugesModel, InMemoryHeroGaugesSource) {
        let source = InMemoryHeroGaugesSource(initial: update)
        let model = HeroGaugesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> HeroAnalyticsDTO {
        HeroAnalyticsDTO(totalDistanceKm: 100, totalDrives: 5, totalEnergyKwh: 30, totalCost: 4, avgEfficiencyWhKm: 150)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsGauges() {
        let (model, _) = makeModel(HeroGaugesUpdate(status: .loaded, analytics: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.tiles.count, 6)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(HeroGaugesUpdate(status: .empty, analytics: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(HeroGaugesUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(HeroGaugesUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedGaugesStayContentWhileFailing() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, analytics: sample()))
        model.start()
        source.push(HeroGaugesUpdate(status: .failed("net"), connection: .offline, analytics: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loading))
        model.start()
        source.push(
            HeroGaugesUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                analytics: sample(),
                units: HeroUnitPrefs(distance: .miles, currencySymbol: "£"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.units.currencySymbol, "£")
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, analytics: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndIdle() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, analytics: sample()))
        model.start()
        // live → no refresh
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        // stale + idle → refresh
        source.push(HeroGaugesUpdate(status: .loaded, connection: .stale, isFetching: false, analytics: sample()))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
        // stale + fetching → guarded (no extra refresh)
        source.push(HeroGaugesUpdate(status: .loaded, connection: .stale, isFetching: true, analytics: sample()))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyHeroGaugesTelemetry()
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HeroGaugesSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

final class HeroGaugesAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryGauge() {
        let analytics = HeroAnalyticsDTO(
            totalDistanceKm: 1000,
            totalDrives: 1234,
            totalEnergyKwh: 250.5,
            totalCost: 50,
            avgEfficiencyWhKm: 160
        )
        let projection = HeroGaugesProjector.project(analytics: analytics, units: HeroUnitPrefs())
        let summary = HeroGaugesAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Distance"))
        XCTAssertTrue(summary.contains("Drives 1,234"))
        XCTAssertTrue(summary.contains("Energy"))
        XCTAssertTrue(summary.contains("kWh"))
        XCTAssertTrue(summary.contains("Efficiency"))
        XCTAssertTrue(summary.contains("Gas Savings"))
        XCTAssertTrue(summary.contains("CO₂ Saved"))
        XCTAssertTrue(summary.contains("kg"))
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor
    final class HeroGaugesViewStateTests: XCTestCase {
        private func renders(_ update: HeroGaugesUpdate) -> Bool {
            let source = InMemoryHeroGaugesSource(initial: update)
            let model = HeroGaugesModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: HeroGauges(model: model).frame(width: 360, height: 260))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample() -> HeroAnalyticsDTO {
            HeroAnalyticsDTO(
                totalDistanceKm: 1000,
                totalDrives: 12,
                totalEnergyKwh: 30,
                totalCost: 4,
                avgEfficiencyWhKm: 150
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, analytics: sample())))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .empty, analytics: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, connection: .stale, analytics: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, connection: .offline, analytics: sample())))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyHeroGaugesTelemetry: HeroGaugesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
