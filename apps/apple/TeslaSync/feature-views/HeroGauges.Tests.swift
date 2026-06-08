//
//  HeroGauges.Tests.swift
//  TeslaSync — P4 feature view · 0103 · HeroGauges (Apple)
//
//  Unit + UI coverage for the charging HeroGauges surface:
//    • Adapter (cached → projection) — `HeroGaugesFormat` number/integer/currency parity with the
//      web `fmtNumber`/`fmtInt`/`formatCurrency`, the half-away-from-zero pre-round, and the
//      `HeroGaugesProjector` gauge math (clamped value, value/max fill fraction, units, accents,
//      and the Avg $/kWh 2-then-3 decimal pipeline).
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

// MARK: - Adapter: formatting + pre-round (web parity)

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
        XCTAssertEqual(HeroGaugesFormat.currency(0.27, symbol: "$", decimals: 3), "$0.270")
        XCTAssertEqual(HeroGaugesFormat.currency(1234.4, symbol: "€", decimals: 0), "€1,234")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(HeroGaugesFormat.safeNumber(.nan), 0)
        XCTAssertEqual(HeroGaugesFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(HeroGaugesFormat.safeNumber(42.5), 42.5)
    }

    func testRoundHalfAwayFromZeroToPlaces() {
        XCTAssertEqual(HeroGaugesFormat.round(0.274, places: 2), 0.27, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.round(0.156, places: 2), 0.16, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.round(0.125, places: 2), 0.13, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.round(.nan, places: 2), 0)
    }
}

// MARK: - Adapter: projector gauge math (web parity)

final class HeroGaugesProjectorTests: XCTestCase {
    private func gauge(_ id: String, in projection: HeroGaugesProjection) -> HeroGaugeTileModel? {
        projection.gauges.first { $0.id == id }
    }

    private func sample() -> ChargingStatsDTO {
        ChargingStatsDTO(count: 42, totalEnergy: 318.6, totalCost: 87.4, avgPower: 48.2, avgCostPerKwh: 0.274)
    }

    func testGaugeOrderAccentsAndUnits() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: HeroUnitPrefs())
        XCTAssertEqual(projection.gauges.map(\.id), ["sessions", "energy", "total-cost", "avg-power"])
        XCTAssertEqual(projection.gauges.map(\.accent), [.cyan, .green, .amber, .purple])
        XCTAssertNil(gauge("sessions", in: projection)?.unit)
        XCTAssertEqual(gauge("energy", in: projection)?.unit, "kWh")
        XCTAssertEqual(gauge("total-cost", in: projection)?.unit, "$")
        XCTAssertEqual(gauge("avg-power", in: projection)?.unit, "kW")
    }

    func testGaugeValuesAreClampedWholeNumbers() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: HeroUnitPrefs())
        XCTAssertEqual(gauge("sessions", in: projection)?.value, "42")
        XCTAssertEqual(gauge("energy", in: projection)?.value, "319") // round(318.6)
        XCTAssertEqual(gauge("total-cost", in: projection)?.value, "87") // round(87.4)
        XCTAssertEqual(gauge("avg-power", in: projection)?.value, "48") // round(48.2)
    }

    func testGaugeFillFractionsMatchValueOverMax() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: HeroUnitPrefs())
        XCTAssertEqual(gauge("sessions", in: projection)?.fraction ?? -1, 42.0 / 50.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("energy", in: projection)?.fraction ?? -1, 319.0 / 500.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("total-cost", in: projection)?.fraction ?? -1, 87.0 / 100.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("avg-power", in: projection)?.fraction ?? -1, 48.0 / 250.0, accuracy: 1e-9)
    }

    func testSessionsFloorIsFiftyAndAvgPowerClampsAt250() {
        let small = ChargingStatsDTO(count: 3, totalEnergy: 0, totalCost: 0, avgPower: 300, avgCostPerKwh: 0)
        let projection = HeroGaugesProjector.project(stats: small, units: HeroUnitPrefs())
        // sessions: max(count, 50) floor → 3/50
        XCTAssertEqual(gauge("sessions", in: projection)?.fraction ?? -1, 3.0 / 50.0, accuracy: 1e-9)
        // avg power: fixed max 250, clamped value + full ring
        XCTAssertEqual(gauge("avg-power", in: projection)?.value, "250")
        XCTAssertEqual(gauge("avg-power", in: projection)?.fraction ?? -1, 1.0, accuracy: 1e-9)
    }

    func testAvgCostMetricUsesTwoThenThreeDecimalPipeline() {
        // 0.156 → round2 0.16 → render 3 decimals → "$0.160"
        let stats = ChargingStatsDTO(count: 1, totalEnergy: 1, totalCost: 1, avgPower: 1, avgCostPerKwh: 0.156)
        let projection = HeroGaugesProjector.project(stats: stats, units: HeroUnitPrefs())
        XCTAssertEqual(projection.cost.id, "avg-cost-per-kwh")
        XCTAssertEqual(projection.cost.value, "$0.160")
    }

    func testCurrencySymbolAppliesToCostGaugeAndMetric() {
        let units = HeroUnitPrefs(currencySymbol: "€", localeIdentifier: "en_US")
        let projection = HeroGaugesProjector.project(stats: sample(), units: units)
        XCTAssertEqual(gauge("total-cost", in: projection)?.unit, "€")
        XCTAssertEqual(projection.cost.value.first.map(String.init), "€")
    }

    func testNonFiniteInputsCollapseToZero() {
        let bad = ChargingStatsDTO(
            count: 0,
            totalEnergy: .nan,
            totalCost: .infinity,
            avgPower: .nan,
            avgCostPerKwh: .nan
        )
        let projection = HeroGaugesProjector.project(stats: bad, units: HeroUnitPrefs())
        XCTAssertEqual(gauge("energy", in: projection)?.value, "0")
        XCTAssertEqual(gauge("energy", in: projection)?.fraction ?? -1, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.cost.value, "$0.000")
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

    private func sample() -> ChargingStatsDTO {
        ChargingStatsDTO(count: 5, totalEnergy: 30, totalCost: 4, avgPower: 20, avgCostPerKwh: 0.2)
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

    func testInitialContentProjectsGaugesAndCost() {
        let (model, _) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauges.count, 4)
        XCTAssertEqual(model.projection?.cost.id, "avg-cost-per-kwh")
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(HeroGaugesUpdate(status: .empty, stats: nil))
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
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        source.push(HeroGaugesUpdate(status: .failed("net"), connection: .offline, stats: sample()))
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
                stats: sample(),
                units: HeroUnitPrefs(currencySymbol: "£"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.currencySymbol, "£")
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndIdle() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        // live → no refresh
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        // stale + idle → refresh
        source.push(HeroGaugesUpdate(status: .loaded, connection: .stale, isFetching: false, stats: sample()))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
        // stale + fetching → guarded (no extra refresh)
        source.push(HeroGaugesUpdate(status: .loaded, connection: .stale, isFetching: true, stats: sample()))
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
    func testSummaryIncludesEveryGaugeAndCost() {
        let stats = ChargingStatsDTO(
            count: 42,
            totalEnergy: 318.6,
            totalCost: 87.4,
            avgPower: 48.2,
            avgCostPerKwh: 0.27
        )
        let projection = HeroGaugesProjector.project(stats: stats, units: HeroUnitPrefs())
        let summary = HeroGaugesAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Sessions 42"))
        XCTAssertTrue(summary.contains("Energy 319 kWh"))
        XCTAssertTrue(summary.contains("Total Cost 87 $"))
        XCTAssertTrue(summary.contains("Avg Power 48 kW"))
        XCTAssertTrue(summary.contains("Avg $/kWh $0.270"))
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
            let renderer = ImageRenderer(content: HeroGauges(model: model).frame(width: 380, height: 260))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample() -> ChargingStatsDTO {
            ChargingStatsDTO(count: 42, totalEnergy: 318.6, totalCost: 87.4, avgPower: 48.2, avgCostPerKwh: 0.27)
        }

        func testContentRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, stats: sample())))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .empty, stats: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, connection: .stale, stats: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, connection: .offline, stats: sample())))
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
