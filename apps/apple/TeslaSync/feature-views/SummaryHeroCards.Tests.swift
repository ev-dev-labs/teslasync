//
//  SummaryHeroCards.Tests.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  Unit coverage for the SummaryHeroCards surface:
//    • Adapter — `SummaryHeroFormatting` (web `fmtNumber`/`fmtInt`/`formatCurrency`
//      parity), `TrendCalculator` (web `pctChange`/`trendFor`, incl. the flat band
//      and `invertPositive` polarity), and `SummaryHeroProjection` (the ordered
//      web JSX card grid + the optional Fun Fact card).
//    • State holder — `SummaryHeroCardsModel` phase machine (loading → loaded /
//      empty / failed), cached-keep-on-failure, offline/stale freshness, plus the
//      P1/S11 `view.opened` telemetry wiring.
//    • Accessibility — the composed VoiceOver label builders + i18n interpolation.
//
//  These run in the TeslaSync(/-macOS) XCTest scope. They have no network and no
//  real store: the model is driven by `InMemorySummaryHeroSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum SummaryHeroFixture {
    static let sample = DigestSummary(
        totalDistance: 312.4,
        prevDistance: 280.1,
        totalDrives: 18,
        prevDriveCount: 15,
        energyUsed: 64.2,
        prevEnergy: 70.5,
        chargingCost: 12.80,
        prevChargingCost: 15.10,
        co2Saved: 22.6,
        prevCo2: 19.8,
        funFact: FunFact(from: "San Francisco", to: "Los Angeles", times: "0.8")
    )

    static let sampleNoFunFact = DigestSummary(
        totalDistance: 4.2,
        prevDistance: 0,
        totalDrives: 1,
        prevDriveCount: 0,
        energyUsed: 0.9,
        prevEnergy: 0,
        chargingCost: 0,
        prevChargingCost: 0,
        co2Saved: 0.3,
        prevCo2: 0,
        funFact: nil
    )
}

// MARK: - Adapter: formatting (web `numberFormat` parity)

final class SummaryHeroFormattingTests: XCTestCase {
    private let formatting = SummaryHeroFormatting.standard

    func testNumberAddsGroupingAndFixedFractionDigits() {
        XCTAssertEqual(formatting.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(formatting.number(312.4, decimals: 1), "312.4")
        XCTAssertEqual(formatting.number(0, decimals: 1), "0.0")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(formatting.number(2.45, decimals: 1), "2.5")
        XCTAssertEqual(formatting.number(8.93617, decimals: 1), "8.9")
    }

    func testIntRoundsAndGroups() {
        XCTAssertEqual(formatting.int(12345.6), "12,346")
        XCTAssertEqual(formatting.int(18), "18")
    }

    func testCurrencyPrependsSymbolAtPrecision() {
        XCTAssertEqual(formatting.currency(12.80, decimals: 2), "$12.80")
        XCTAssertEqual(formatting.currency(0, decimals: 2), "$0.00")
        XCTAssertEqual(formatting.currency(1500.5), "$1,500.50")
    }

    func testNonFiniteInputFormatsAsZero() {
        XCTAssertEqual(formatting.number(.nan, decimals: 1), "0.0")
        XCTAssertEqual(formatting.number(.infinity, decimals: 2), "0.00")
    }

    func testCustomLocaleAndSymbol() {
        let euro = SummaryHeroFormatting(currencySymbol: "€", precision: 2, localeIdentifier: "en_US")
        XCTAssertEqual(euro.currency(9.5), "€9.50")
    }
}

// MARK: - Adapter: trend (web `helpers.trendFor`)

final class TrendCalculatorTests: XCTestCase {
    func testPctChangeHandlesZeroPrevious() {
        XCTAssertEqual(TrendCalculator.pctChange(current: 5, previous: 0), 100)
        XCTAssertEqual(TrendCalculator.pctChange(current: 0, previous: 0), 0)
        XCTAssertEqual(TrendCalculator.pctChange(current: -3, previous: 0), 0)
    }

    func testPctChangeUsesAbsolutePrevious() {
        XCTAssertEqual(TrendCalculator.pctChange(current: 50, previous: 40), 25, accuracy: 0.0001)
        XCTAssertEqual(TrendCalculator.pctChange(current: 30, previous: -60), 150, accuracy: 0.0001)
    }

    func testFlatBandBelowOneHundredth() {
        let trend = TrendCalculator.trend(current: 100.005, previous: 100)
        XCTAssertEqual(trend.direction, .flat)
        XCTAssertEqual(trend.value, "0%")
        XCTAssertTrue(trend.positive)
    }

    func testRisingTrendSignedAndPositive() {
        let trend = TrendCalculator.trend(current: 110, previous: 100)
        XCTAssertEqual(trend.direction, .up)
        XCTAssertEqual(trend.value, "+10.0%")
        XCTAssertTrue(trend.positive)
    }

    func testFallingTrendIsNegative() {
        let trend = TrendCalculator.trend(current: 90, previous: 100)
        XCTAssertEqual(trend.direction, .down)
        XCTAssertEqual(trend.value, "-10.0%")
        XCTAssertFalse(trend.positive)
    }

    func testInvertPositiveFlipsPolarityNotDirection() {
        // Lower-is-better metric falling: numeric direction down, but a *good* change.
        let trend = TrendCalculator.trend(current: 90, previous: 100, invertPositive: true)
        XCTAssertEqual(trend.direction, .down)
        XCTAssertEqual(trend.value, "-10.0%")
        XCTAssertTrue(trend.positive)
    }
}

// MARK: - Adapter: projection (web JSX → ordered grid)

final class SummaryHeroProjectionTests: XCTestCase {
    func testProjectionOrderMatchesWebJSX() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sample)
        XCTAssertEqual(
            items.map(\.id),
            [
                SummaryHeroKeys.totalDistance,
                SummaryHeroKeys.totalDrives,
                SummaryHeroKeys.energyUsed,
                SummaryHeroKeys.chargingCost,
                SummaryHeroKeys.co2Saved,
                SummaryHeroKeys.funFact
            ]
        )
    }

    func testFunFactCardOmittedWhenAbsent() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sampleNoFunFact)
        XCTAssertEqual(items.count, 5)
        XCTAssertFalse(items.contains { $0.id == SummaryHeroKeys.funFact })
    }

    func testCardValuesMatchWebFormatting() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sample)
        XCTAssertEqual(items[0].value, "312.4 km")
        XCTAssertEqual(items[1].value, "18")
        XCTAssertEqual(items[2].value, "64.2 kWh")
        XCTAssertEqual(items[3].value, "$12.80")
        XCTAssertEqual(items[4].value, "22.6 kg")
        XCTAssertEqual(items[5].value, "0.8×")
    }

    func testCardAccentsMatchWebColors() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sample)
        XCTAssertEqual(items.map(\.accent), [.cyan, .green, .purple, .amber, .green, .cyan])
    }

    func testCardIconsAndLabelKeys() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sample)
        XCTAssertEqual(items[0].systemImage, "car.fill")
        XCTAssertEqual(items[0].labelKey, SummaryHeroKeys.totalDistance)
        XCTAssertEqual(items[5].systemImage, "mappin.and.ellipse")
        XCTAssertEqual(items[5].labelKey, SummaryHeroKeys.funFact)
    }

    func testEnergyAndCostUseInvertedPolarity() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sample)
        let energy = items.first { $0.id == SummaryHeroKeys.energyUsed }
        XCTAssertEqual(energy?.trend?.direction, .down)
        XCTAssertEqual(energy?.trend?.positive, true)
        let cost = items.first { $0.id == SummaryHeroKeys.chargingCost }
        XCTAssertEqual(cost?.trend?.positive, true)
    }

    func testFunFactCardCarriesSubtitleAndNoTrend() {
        let items = SummaryHeroProjection.items(from: SummaryHeroFixture.sample)
        let funFact = items.first { $0.id == SummaryHeroKeys.funFact }
        XCTAssertNil(funFact?.trend)
        XCTAssertEqual(funFact?.subtitle, "≈ 0.8× San Francisco → Los Angeles")
    }

    func testAccentGlowMap() {
        XCTAssertTrue(SummaryHeroAccent.cyan.hasGlow)
        XCTAssertTrue(SummaryHeroAccent.green.hasGlow)
        XCTAssertTrue(SummaryHeroAccent.purple.hasGlow)
        XCTAssertFalse(SummaryHeroAccent.amber.hasGlow)
        XCTAssertFalse(SummaryHeroAccent.red.hasGlow)
    }
}

// MARK: - State holder: phase, freshness, offline, telemetry

@MainActor
final class SummaryHeroCardsModelTests: XCTestCase {
    private func makeModel(
        source: InMemorySummaryHeroSource,
        telemetry: SummaryHeroTelemetry = OSLogSummaryHeroTelemetry()
    ) -> SummaryHeroCardsModel {
        SummaryHeroCardsModel(source: source, telemetry: telemetry)
    }

    func testPhaseStartsLoadingUntilSnapshotArrives() {
        let source = InMemorySummaryHeroSource(initial: nil)
        let model = makeModel(source: source)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SummaryHeroUpdate(summary: SummaryHeroFixture.sample))
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.items.count, 6)
    }

    func testLoadedSnapshotProjectsItems() {
        let source = InMemorySummaryHeroSource(
            initial: SummaryHeroUpdate(summary: SummaryHeroFixture.sample, updatedAt: Date())
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isOffline)
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.items.first?.value, "312.4 km")
    }

    func testEmptySnapshotClearsSummary() {
        let source = InMemorySummaryHeroSource(initial: SummaryHeroUpdate(summary: nil))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasCachedSummary)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testFailureWithoutCacheIsError() {
        let source = InMemorySummaryHeroSource(initial: SummaryHeroUpdate(summary: nil, failed: true))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .failed)
        XCTAssertFalse(model.hasCachedSummary)
    }

    func testFailureKeepsCachedSummaryVisible() {
        let source = InMemorySummaryHeroSource(initial: SummaryHeroUpdate(summary: SummaryHeroFixture.sample))
        let model = makeModel(source: source)
        model.start()
        source.push(SummaryHeroUpdate(summary: nil, connection: .offline, failed: true))
        XCTAssertEqual(model.phase, .failed)
        XCTAssertTrue(model.hasCachedSummary)
        XCTAssertEqual(model.items.count, 6)
    }

    func testConnectivityDrivesFreshnessFlags() {
        let source = InMemorySummaryHeroSource(initial: SummaryHeroUpdate(summary: SummaryHeroFixture.sample))
        let model = makeModel(source: source)
        model.start()
        source.push(SummaryHeroUpdate(summary: SummaryHeroFixture.sample, connection: .stale))
        XCTAssertTrue(model.isStale)
        source.push(SummaryHeroUpdate(summary: SummaryHeroFixture.sample, connection: .offline))
        XCTAssertTrue(model.isOffline)
    }

    func testRefreshForwardsToSource() {
        let source = InMemorySummaryHeroSource(initial: SummaryHeroUpdate(summary: SummaryHeroFixture.sample))
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpySummaryHeroTelemetry()
        let model = makeModel(source: InMemorySummaryHeroSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.opened, ["SummaryHeroCards"])
        XCTAssertEqual(SummaryHeroCards.surfaceSlug, "SummaryHeroCards")
    }

    func testStartStopLifecycleCountsOnSource() {
        let source = InMemorySummaryHeroSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testFreshnessHelperWindow() {
        let now = Date()
        XCTAssertFalse(SummaryHeroFreshness.isStale(updatedAt: nil, now: now))
        XCTAssertFalse(SummaryHeroFreshness.isStale(updatedAt: now, now: now))
        XCTAssertTrue(SummaryHeroFreshness.isStale(updatedAt: now.addingTimeInterval(-120), now: now))
    }
}

// MARK: - Accessibility + i18n composition

final class SummaryHeroAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func metricItem() -> HighlightItem {
        HighlightItem(
            id: "x",
            systemImage: "car.fill",
            labelKey: SummaryHeroKeys.totalDistance,
            labelFallback: "Total Distance",
            value: "312.4 km",
            trend: Trend(direction: .up, value: "+11.5%", positive: true),
            subtitle: nil,
            accent: .cyan
        )
    }

    func testCardLabelComposesLabelValueAndChange() {
        XCTAssertEqual(
            SummaryHeroAccessibility.cardLabel(metricItem(), localize: echo),
            "Total Distance, 312.4 km, change +11.5%"
        )
    }

    func testCardLabelIncludesSubtitleWhenNoTrend() {
        let item = HighlightItem(
            id: "fun",
            systemImage: "mappin.and.ellipse",
            labelKey: SummaryHeroKeys.funFact,
            labelFallback: "Fun Fact",
            value: "0.8×",
            trend: nil,
            subtitle: "≈ 0.8× San Francisco → Los Angeles",
            accent: .cyan
        )
        XCTAssertEqual(
            SummaryHeroAccessibility.cardLabel(item, localize: echo),
            "Fun Fact, 0.8×, ≈ 0.8× San Francisco → Los Angeles"
        )
    }

    func testFreshnessLabels() {
        XCTAssertEqual(SummaryHeroAccessibility.freshnessLabel(.online, localize: echo), "Live")
        XCTAssertEqual(SummaryHeroAccessibility.freshnessLabel(.stale, localize: echo), "Stale")
        XCTAssertEqual(SummaryHeroAccessibility.freshnessLabel(.offline, localize: echo), "Offline")
    }

    func testInterpolationReplacesTokensWithOptionalSpaces() {
        XCTAssertEqual(
            SummaryHeroStrings.interpolate("{{a}}-{{ b }}", values: ["a": "X", "b": "Y"]),
            "X-Y"
        )
    }

    func testFunFactDescriptionInterpolatesTemplate() {
        let funFact = FunFact(from: "A", to: "B", times: "2.0")
        XCTAssertEqual(SummaryHeroStrings.funFactDescription(funFact), "≈ 2.0× A → B")
    }

    func testStringsFacadeFallsBackForUnknownKeys() {
        XCTAssertEqual(
            SummaryHeroStrings.string("analytics.weeklyDigest.__missing__", "fallback-value"),
            "fallback-value"
        )
    }
}

// MARK: - Test doubles

/// Records the surface slugs reported to the telemetry seam.
private final class SpySummaryHeroTelemetry: SummaryHeroTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}
