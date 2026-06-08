//
//  FleetStatsBar.Tests.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  Unit coverage for the FleetStatsBar surface:
//    • Adapter — the SI→display unit conversions (lib/unitConversion + the widget's
//      efficiency math), the `fmtNumber` locale formatting, the responsive column
//      math, the five-card projection (labels / values / accents / captions /
//      reversed sparklines), the empty detection, and the phase resolution.
//    • State holder — `FleetStatsBarModel` wiring, the P1/S11 `view.opened` telemetry,
//      the stale auto-refresh (once + re-arm), the offline cached-hold, and retry.
//    • Accessibility — the per-card and bar-level VoiceOver content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryFleetStatsSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleInput(unit: DistanceUnitPref = .km, alerts: Int = 2) -> FleetStatsInput {
    FleetStatsInput(
        vehicleCount: 4,
        onlineCount: 3,
        unreadAlerts: alerts,
        analytics: FleetAnalyticsSnapshot(
            totalDistanceSI: 1_234_000,
            totalEnergyKwh: 312.5,
            avgEfficiencyWhKm: 158
        ),
        recentDriveDistancesM: [10, 20, 30],
        recentChargeEnergiesWh: [5, 6],
        unit: unit
    )
}

// MARK: - Unit conversion (port of lib/unitConversion + widget efficiency)

@MainActor final class FleetUnitsTests: XCTestCase {
    func testDistanceFromSI() {
        XCTAssertEqual(FleetUnits.distanceFromSI(1000, .km), 1, accuracy: 1e-9)
        XCTAssertEqual(FleetUnits.distanceFromSI(1609.344, .mi), 1, accuracy: 1e-9)
        XCTAssertEqual(FleetUnits.distanceFromSI(0.3048, .ft), 1, accuracy: 1e-9)
        XCTAssertEqual(FleetUnits.distanceFromSI(1_234_000, .km), 1234, accuracy: 1e-6)
    }

    func testEfficiencyFromWhKm() {
        // km keeps Wh/km; mi scales by 1.609344 (Wh/mi).
        XCTAssertEqual(FleetUnits.efficiencyFromWhKm(100, .km), 100, accuracy: 1e-9)
        XCTAssertEqual(FleetUnits.efficiencyFromWhKm(100, .mi), 160.9344, accuracy: 1e-6)
    }

    func testUnitLabels() {
        XCTAssertEqual(DistanceUnitPref.km.label, "km")
        XCTAssertEqual(DistanceUnitPref.mi.label, "mi")
        XCTAssertEqual(FleetUnits.efficiencyLabel(.km), "Wh/km")
        XCTAssertEqual(FleetUnits.efficiencyLabel(.mi), "Wh/mi")
        XCTAssertEqual(FleetUnits.energyLabel, "kWh")
    }
}

// MARK: - Number formatting (port of lib/numberFormat fmtNumber)

@MainActor final class FleetStatsFormatTests: XCTestCase {
    func testGroupingAndFractionDigits() {
        XCTAssertEqual(FleetStatsFormat.number(1_234_567, decimals: 0, locale: enUS), "1,234,567")
        XCTAssertEqual(FleetStatsFormat.number(312.5, decimals: 1, locale: enUS), "312.5")
        XCTAssertEqual(FleetStatsFormat.number(99, decimals: 0, locale: enUS), "99")
    }

    func testRoundsHalfUp() {
        XCTAssertEqual(FleetStatsFormat.number(2.5, decimals: 0, locale: enUS), "3")
        XCTAssertEqual(FleetStatsFormat.number(1.5, decimals: 0, locale: enUS), "2")
        XCTAssertEqual(FleetStatsFormat.number(0.5, decimals: 0, locale: enUS), "1")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(FleetStatsFormat.number(.nan, decimals: 0, locale: enUS), "0")
        XCTAssertEqual(FleetStatsFormat.number(.infinity, decimals: 1, locale: enUS), "0.0")
    }

    func testWithUnitComposesNumberAndSymbol() {
        XCTAssertEqual(FleetStatsFormat.withUnit(1234, decimals: 0, unit: "km", locale: enUS), "1,234 km")
        XCTAssertEqual(FleetStatsFormat.withUnit(312.5, decimals: 1, unit: "kWh", locale: enUS), "312.5 kWh")
    }
}

// MARK: - Responsive column math (web grid-cols-2 / sm:3 / md:4 / lg:5)

@MainActor final class FleetStatsLayoutTests: XCTestCase {
    func testColumnsAtBreakpoints() {
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 320), 2)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 639), 2)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 640), 3)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 767), 3)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 768), 4)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 1023), 4)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 1024), 5)
        XCTAssertEqual(FleetStatsLayout.columnCount(forWidth: 1440), 5)
    }
}

// MARK: - Projection: five cards + wiring

@MainActor final class FleetStatsProjectionTests: XCTestCase {
    func testBuildsFiveCardsInWebOrder() {
        let cards = FleetStatsProjection.cards(from: sampleInput(), locale: enUS)
        XCTAssertEqual(cards.map(\.id), ["size", "distance", "energy", "efficiency", "alerts"])

        XCTAssertEqual(cards[0].valueText, "4")
        XCTAssertEqual(cards[0].accent, .neutral)
        XCTAssertEqual(cards[0].caption, .online(3))
        XCTAssertNil(cards[0].sparkline)

        XCTAssertEqual(cards[1].valueText, "1,234 km")
        XCTAssertEqual(cards[1].accent, .distance)
        XCTAssertEqual(cards[1].sparkline, [30, 20, 10]) // web `.reverse()`

        XCTAssertEqual(cards[2].valueText, "312.5 kWh")
        XCTAssertEqual(cards[2].accent, .energy)
        XCTAssertEqual(cards[2].sparkline, [6, 5])

        XCTAssertEqual(cards[3].valueText, "158 Wh/km")
        XCTAssertEqual(cards[3].accent, .efficiency)
        XCTAssertEqual(cards[3].caption, .localized(key: "fleet.average", fallback: "fleet average"))

        XCTAssertEqual(cards[4].valueText, "2")
        XCTAssertEqual(cards[4].accent, .alert) // unread > 0
        XCTAssertEqual(cards[4].caption, .localized(key: "fleet.unread", fallback: "unread"))
    }

    func testImperialUnitConvertsDistanceAndEfficiency() {
        let cards = FleetStatsProjection.cards(from: sampleInput(unit: .mi), locale: enUS)
        XCTAssertEqual(cards[1].valueText, "767 mi") // 1,234,000 m / 1609.344
        XCTAssertEqual(cards[3].valueText, "254 Wh/mi") // 158 * 1.609344
    }

    func testAlertsAccentFlipsWhenZero() {
        let cards = FleetStatsProjection.cards(from: sampleInput(alerts: 0), locale: enUS)
        XCTAssertEqual(cards[4].valueText, "0")
        XCTAssertEqual(cards[4].accent, .calm)
    }

    func testMissingAnalyticsZeroesValues() {
        let cards = FleetStatsProjection.cards(
            from: FleetStatsInput(vehicleCount: 1, unit: .km), locale: enUS
        )
        XCTAssertEqual(cards[1].valueText, "0 km")
        XCTAssertEqual(cards[2].valueText, "0.0 kWh")
        XCTAssertEqual(cards[3].valueText, "0 Wh/km")
    }

    func testSparklineGating() {
        // ≥ 2 points draw; < 2 points (web MiniChart returns null) do not.
        let three = FleetStatsProjection.cards(from: sampleInput(), locale: enUS)
        XCTAssertTrue(three[1].showsSparkline)

        let one = FleetStatsProjection.cards(
            from: FleetStatsInput(recentDriveDistancesM: [10], recentChargeEnergiesWh: []),
            locale: enUS
        )
        XCTAssertFalse(one[1].showsSparkline)
        XCTAssertFalse(one[2].showsSparkline)
    }
}

// MARK: - Empty detection + phase resolution

@MainActor final class FleetStatsPhaseTests: XCTestCase {
    func testIsEmpty() {
        XCTAssertTrue(FleetStatsProjection.isEmpty(FleetStatsInput()))
        XCTAssertFalse(FleetStatsProjection.isEmpty(FleetStatsInput(vehicleCount: 1)))
        XCTAssertFalse(FleetStatsProjection.isEmpty(FleetStatsInput(unreadAlerts: 1)))
        XCTAssertFalse(FleetStatsProjection.isEmpty(FleetStatsInput(recentDriveDistancesM: [1])))
        XCTAssertFalse(FleetStatsProjection.isEmpty(sampleInput()))
    }

    func testResolvePhase() {
        XCTAssertEqual(FleetStatsProjection.resolvePhase(.loading, isEmpty: false), .loading)
        XCTAssertEqual(FleetStatsProjection.resolvePhase(.loaded, isEmpty: true), .empty)
        XCTAssertEqual(FleetStatsProjection.resolvePhase(.loaded, isEmpty: false), .content)
        XCTAssertEqual(FleetStatsProjection.resolvePhase(.failed("boom"), isEmpty: false), .error("boom"))
    }
}

// MARK: - State holder: wiring + telemetry + freshness

@MainActor final class FleetStatsModelTests: XCTestCase {
    private func makeModel(
        _ update: FleetStatsUpdate,
        telemetry: FleetStatsTelemetry = OSLogFleetStatsTelemetry()
    ) -> (FleetStatsBarModel, InMemoryFleetStatsSource) {
        let source = InMemoryFleetStatsSource(initial: update)
        let model = FleetStatsBarModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyFleetStatsTelemetry()
        let (model, source) = makeModel(
            FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .live),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 5)
        XCTAssertEqual(spy.surfaces, [FleetStatsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenPushedContent() {
        let (model, source) = makeModel(FleetStatsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .live))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.first?.valueText, "4")
    }

    func testResolvedEmptyInputProjectsEmptyPhase() {
        let (model, _) = makeModel(FleetStatsUpdate(status: .loaded, input: FleetStatsInput()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testStaleAutoRefreshesOnceAndReArms() {
        let (model, source) = makeModel(
            FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .live)
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // A second stale snapshot must not re-trigger.
        source.push(FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // Back to live re-arms; a later stale fires exactly once more.
        source.push(FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .live))
        source.push(FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedCardsAndDoesNotRefetch() {
        let (model, source) = makeModel(
            FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .live)
        )
        model.start()
        source.push(FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.cards.count, 5)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testErrorPhaseAndRetryCallsRefresh() {
        let (model, source) = makeModel(FleetStatsUpdate(status: .failed("Request timed out")))
        model.start()
        XCTAssertEqual(model.phase, .error("Request timed out"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopReArmsStart() {
        let spy = SpyFleetStatsTelemetry()
        let (model, source) = makeModel(
            FleetStatsUpdate(status: .loaded, input: sampleInput(), connection: .live),
            telemetry: spy
        )
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces.count, 2)
    }
}

// MARK: - Accessibility content

@MainActor final class FleetStatsAccessibilityTests: XCTestCase {
    func testCardLabelWithAndWithoutDetail() {
        XCTAssertEqual(
            FleetStatsAccessibility.cardLabel(label: "Distance (30d)", value: "1,234 km", detail: nil),
            "Distance (30d), 1,234 km"
        )
        XCTAssertEqual(
            FleetStatsAccessibility.cardLabel(label: "Fleet Size", value: "4", detail: "3 online"),
            "Fleet Size, 4, 3 online"
        )
    }

    func testBarSummaryListsEveryCard() {
        let cards = FleetStatsProjection.cards(from: sampleInput(), locale: enUS)
        let summary = FleetStatsAccessibility.barSummary(cards: cards) { _, fallback in fallback }
        XCTAssertEqual(
            summary,
            "Fleet statistics: Fleet Size 4, Distance (30d) 1,234 km, "
                + "Energy (30d) 312.5 kWh, Efficiency 158 Wh/km, Alerts 2"
        )
    }

    func testBarSummaryEmptyFallback() {
        let summary = FleetStatsAccessibility.barSummary(cards: []) { _, fallback in fallback }
        XCTAssertEqual(summary, "Fleet statistics: No data available")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFleetStatsTelemetry: FleetStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
