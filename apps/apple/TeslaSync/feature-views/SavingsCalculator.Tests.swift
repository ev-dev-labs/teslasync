//
//  SavingsCalculator.Tests.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  Unit coverage for the SavingsCalculator surface:
//    • Adapter (cached → projection) — snake-case decode, the input parse guards
//      (web `Number()||0` / `||1`), the gas-vs-electric math, and the grouped
//      currency / per-distance / annual formatting.
//    • Presentation resolver — every state (loading / empty / offline / error /
//      stale / content), keeping cached aggregates visible.
//    • Web-prop mapping — `data` (+ loading) → load state.
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the combined VoiceOver summary content.
//    • Model — preview/web-prop binding, source start/refresh/stop delegation,
//      assumption editing, and the "Reset Defaults" action.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemorySavingsCalculatorSource`.
//

import XCTest
@testable import TeslaSync

@MainActor final class SavingsCalculatorAdapterTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    // MARK: Decode

    func testDecodeParsesSnakeCaseAndIgnoresExtraFields() {
        let json = #"""
        {"energy_kwh":400.0,"cost_dollars":300.0,"display_distance":9000.0,
         "distance_unit":"mi","months_count":12,"unused_field":"x"}
        """#
        let data = SavingsCalculatorData.decode(fromJSONString: json)
        XCTAssertEqual(data?.energyKwh, 400)
        XCTAssertEqual(data?.costDollars, 300)
        XCTAssertEqual(data?.displayDistance, 9000)
        XCTAssertEqual(data?.distanceUnit, "mi")
        XCTAssertEqual(data?.monthsCount, 12)
    }

    func testDecodePartialDefaultsToZeroAndGarbageIsNil() {
        let partial = SavingsCalculatorData.decode(fromJSONString: #"{"energy_kwh":50}"#)
        XCTAssertEqual(partial?.energyKwh, 50)
        XCTAssertEqual(partial?.costDollars, 0)
        XCTAssertEqual(partial?.displayDistance, 0)
        XCTAssertEqual(partial?.distanceUnit, "mi")
        XCTAssertEqual(partial?.monthsCount, 0)
        XCTAssertNil(SavingsCalculatorData.decode(fromJSONString: "not json"))
    }

    // MARK: Input parsing (web `Number(...) || n`)

    func testParseRateMirrorsNumberOrZero() {
        XCTAssertEqual(SavingsCalculatorAssumptions.parseRate("3.5"), 3.5)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseRate(" 2 "), 2)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseRate("0"), 0)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseRate(""), 0)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseRate("abc"), 0)
    }

    func testParseMpgMirrorsNumberOrOne() {
        XCTAssertEqual(SavingsCalculatorAssumptions.parseMpg("30"), 30)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseMpg("0"), 1)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseMpg(""), 1)
        XCTAssertEqual(SavingsCalculatorAssumptions.parseMpg("garbage"), 1)
    }

    func testFieldTextDropsTrailingZeros() {
        XCTAssertEqual(SavingsCalculatorAssumptions.fieldText(30), "30")
        XCTAssertEqual(SavingsCalculatorAssumptions.fieldText(3.5), "3.5")
        XCTAssertEqual(SavingsCalculatorAssumptions.fieldText(0.13), "0.13")
    }

    // MARK: Comparison math (web `gasComparison` memo)

    func testGasComparisonReproducesWebMath() {
        let comparison = GasComparison.make(
            data: SavingsCalculatorData(
                energyKwh: 400,
                costDollars: 300,
                displayDistance: 9000,
                distanceUnit: "mi",
                monthsCount: 12
            ),
            assumptions: .defaults
        )
        XCTAssertEqual(comparison.gasCost, 1050, accuracy: 1e-9)
        XCTAssertEqual(comparison.evCost, 52, accuracy: 1e-9)
        XCTAssertEqual(comparison.actualCost, 300, accuracy: 1e-9)
        XCTAssertEqual(comparison.savings, 750, accuracy: 1e-9)
        XCTAssertEqual(comparison.monthlySavings, 83.166_666_67, accuracy: 1e-6)
        XCTAssertEqual(comparison.yearlySavings, 998, accuracy: 1e-6)
        XCTAssertEqual(comparison.costPerDistanceGas, 0.116_666_67, accuracy: 1e-6)
        XCTAssertEqual(comparison.costPerDistanceEV, 0.033_333_33, accuracy: 1e-6)
    }

    func testGasComparisonGuardsZeroDistanceMonthsAndMpg() {
        let zeroDistance = GasComparison.make(
            data: SavingsCalculatorData(energyKwh: 100, costDollars: 40, displayDistance: 0, monthsCount: 6),
            assumptions: .defaults
        )
        XCTAssertEqual(zeroDistance.gasCost, 0, accuracy: 1e-9)
        XCTAssertEqual(zeroDistance.costPerDistanceGas, 0, accuracy: 1e-9)
        XCTAssertEqual(zeroDistance.costPerDistanceEV, 0, accuracy: 1e-9)
        XCTAssertEqual(zeroDistance.savings, -40, accuracy: 1e-9)

        let zeroMonths = GasComparison.make(
            data: SavingsCalculatorData(energyKwh: 100, costDollars: 40, displayDistance: 3000, monthsCount: 0),
            assumptions: .defaults
        )
        XCTAssertEqual(zeroMonths.monthlySavings, 0, accuracy: 1e-9)
        XCTAssertEqual(zeroMonths.yearlySavings, 0, accuracy: 1e-9)

        let zeroMpg = GasComparison.make(
            data: SavingsCalculatorData(energyKwh: 100, costDollars: 40, displayDistance: 3000, monthsCount: 6),
            assumptions: SavingsCalculatorAssumptions(gasPrice: 3.5, mpg: 0, electricityRate: 0.13)
        )
        XCTAssertEqual(zeroMpg.gasCost, 0, accuracy: 1e-9)
    }

    // MARK: Projection formatting

    func testProjectionFormatsCardsLikeWeb() {
        let projection = SavingsCalculatorProjection.make(
            data: SavingsCalculatorData(
                energyKwh: 400,
                costDollars: 300,
                displayDistance: 9000,
                distanceUnit: "mi",
                monthsCount: 12
            ),
            assumptions: .defaults,
            locale: locale
        )
        XCTAssertEqual(projection.gasCostText, "$1,050.00")
        XCTAssertEqual(projection.gasPerDistanceText, "$0.117/mi")
        XCTAssertEqual(projection.evCostText, "$300.00")
        XCTAssertEqual(projection.evPerDistanceText, "$0.033/mi")
        XCTAssertEqual(projection.totalSavingsText, "$750.00")
        XCTAssertEqual(projection.monthlySavingsText, "$83.17")
        XCTAssertEqual(projection.yearlySavingsText, "~$998")
        XCTAssertEqual(projection.distanceUnit, "mi")
    }

    func testProjectionEvCardSurfacesActualCostNotEvCost() {
        // Web card 2 ("EV Cost (actual)") renders `actualCost`, not `evCost`.
        let data = SavingsCalculatorData(
            energyKwh: 1000,
            costDollars: 120,
            displayDistance: 6000,
            distanceUnit: "mi",
            monthsCount: 6
        )
        let comparison = GasComparison.make(data: data, assumptions: .defaults)
        let projection = SavingsCalculatorProjection.make(data: data, assumptions: .defaults, locale: locale)
        XCTAssertEqual(comparison.actualCost, 120, accuracy: 1e-9)
        XCTAssertEqual(comparison.evCost, 130, accuracy: 1e-9)
        XCTAssertEqual(projection.evCostText, "$120.00")
    }

    func testCurrencyAndGroupingHelpers() {
        XCTAssertEqual(SavingsCalculatorProjection.currency(12345.6, decimals: 2, locale: locale), "$12,345.60")
        XCTAssertEqual(SavingsCalculatorProjection.grouped(.nan, decimals: 2, locale: locale), "0.00")
        XCTAssertEqual(SavingsCalculatorProjection.perDistance(0.5, unit: "km", locale: locale), "$0.500/km")
    }

    // MARK: Accessibility

    func testSummaryReadsTheKeyAmounts() {
        let projection = SavingsCalculatorProjection.make(
            data: SavingsCalculatorData(
                energyKwh: 400,
                costDollars: 300,
                displayDistance: 9000,
                distanceUnit: "mi",
                monthsCount: 12
            ),
            assumptions: .defaults,
            locale: locale
        )
        let summary = SavingsCalculatorAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains(projection.totalSavingsText))
        XCTAssertTrue(summary.contains(projection.gasCostText))
        XCTAssertTrue(summary.contains(projection.evCostText))
        XCTAssertTrue(summary.contains(projection.monthlySavingsText))
        XCTAssertTrue(summary.contains(projection.yearlySavingsText))
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class SavingsCalculatorPresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let data = SavingsCalculatorData(
        energyKwh: 400,
        costDollars: 300,
        displayDistance: 9000,
        distanceUnit: "mi",
        monthsCount: 12
    )

    private func resolve(
        _ state: SavingsCalculatorLoadState<SavingsCalculatorData>
    ) -> SavingsCalculatorPresentation {
        SavingsCalculatorPresentation.resolve(state: state, assumptions: .defaults, locale: locale)
    }

    private func expected(_ value: SavingsCalculatorData) -> SavingsCalculatorProjection {
        SavingsCalculatorProjection.make(data: value, assumptions: .defaults, locale: locale)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(
            resolve(.loading(cached: data, stale: true)),
            .content(expected(data), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedAndEmpty() {
        XCTAssertEqual(
            resolve(.loaded(data, stale: false)),
            .content(expected(data), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(
            resolve(.loaded(data, stale: true)),
            .content(expected(data), freshness: .stale, refreshing: false)
        )
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(
            resolve(.failed(.offline, cached: data, stale: true)),
            .content(expected(data), freshness: .offline, refreshing: false)
        )
    }

    func testErrorRetryabilityAndCache() {
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.decode(message: "x"), cached: nil, stale: false)),
            .error(retryable: false)
        )
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: data, stale: false)),
            .content(expected(data), freshness: .live, refreshing: false)
        )
    }

    // MARK: Web-prop mapping (data + loading → load state)

    func testWebPropMapping() {
        XCTAssertEqual(
            SavingsCalculatorModel.loadState(data: data, loading: false),
            .loaded(data, stale: false)
        )
        XCTAssertEqual(
            SavingsCalculatorModel.loadState(data: data, loading: true),
            .loading(cached: data, stale: false)
        )
        XCTAssertEqual(
            resolve(SavingsCalculatorModel.loadState(data: data, loading: false)),
            .content(expected(data), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(
            resolve(SavingsCalculatorModel.loadState(data: data, loading: true)),
            .content(expected(data), freshness: .live, refreshing: true)
        )
    }
}

// MARK: - Telemetry + model

@MainActor final class SavingsCalculatorModelTests: XCTestCase {
    private let data = SavingsCalculatorData(
        energyKwh: 400,
        costDollars: 300,
        displayDistance: 9000,
        distanceUnit: "mi",
        monthsCount: 12
    )

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(SavingsCalculator.surfaceSlug, "SavingsCalculator")
        XCTAssertEqual(
            SavingsCalculator.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "SavingsCalculator")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(SavingsCalculator.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "SavingsCalculator")]
        )
    }

    @MainActor
    func testPreviewAndWebPropModels() {
        let preview = SavingsCalculatorModel(previewState: .loaded(data, stale: false))
        XCTAssertEqual(preview.state, .loaded(data, stale: false))

        let webProp = SavingsCalculatorModel(data: data)
        XCTAssertEqual(webProp.state, .loaded(data, stale: false))
        XCTAssertEqual(webProp.assumptions, .defaults)

        let loading = SavingsCalculatorModel(data: data, loading: true)
        XCTAssertEqual(loading.state, .loading(cached: data, stale: false))
    }

    @MainActor
    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let source = InMemorySavingsCalculatorSource(initial: .loaded(data, stale: false))
        let model = SavingsCalculatorModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(data, stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        source.push(.empty(stale: false))
        XCTAssertEqual(model.state, .empty(stale: false))
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    @MainActor
    func testAssumptionsParseFromEditedFieldText() {
        let model = SavingsCalculatorModel(previewState: .loaded(data, stale: false))
        model.gasPriceText = "4.25"
        model.mpgText = "0"
        model.electricityRateText = ""
        XCTAssertEqual(
            model.assumptions,
            SavingsCalculatorAssumptions(gasPrice: 4.25, mpg: 1, electricityRate: 0)
        )
    }

    @MainActor
    func testResetDefaultsRestoresAssumptions() {
        let custom = SavingsCalculatorAssumptions(gasPrice: 5.1, mpg: 42, electricityRate: 0.22)
        let model = SavingsCalculatorModel(previewState: .loaded(data, stale: false), assumptions: custom)
        XCTAssertEqual(model.gasPriceText, "5.1")
        model.gasPriceText = "9"
        XCTAssertEqual(model.assumptions.gasPrice, 9)
        model.resetDefaults()
        XCTAssertEqual(model.gasPriceText, "3.5")
        XCTAssertEqual(model.mpgText, "30")
        XCTAssertEqual(model.electricityRateText, "0.13")
        XCTAssertEqual(model.assumptions, .defaults)
    }
}
