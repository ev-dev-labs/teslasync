//
//  CostForecastWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  Unit coverage for the CostForecastWidget surface:
//    • Adapter (cached → projection) — `CostForecastWidgetBuilder` parity with the web
//      component's `buildChartData` (concat + slice(-6)) and the
//      `nextCost` / `lastCost` / `trendUp` / avg-$/kWh derivations.
//    • Formatting — `CostForecastWidgetFormat` + `CostForecastWidgetCurrencyFormatter` parity
//      with web `fmtNumber` / `formatCurrency`.
//    • State holder — `CostForecastWidgetModel` phase resolution across loading / empty
//      / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `cost-forecast` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-bar value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryCostForecastWidgetSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection

@MainActor final class CostForecastWidgetBuilderTests: XCTestCase {
    private func historical() -> [CostForecastWidgetHistoricalMonth] {
        [
            CostForecastWidgetHistoricalMonth(id: 1, month: "Dec", cost: 58.40, costPerKwh: 0.142),
            CostForecastWidgetHistoricalMonth(id: 2, month: "Jan", cost: 64.10, costPerKwh: 0.151),
            CostForecastWidgetHistoricalMonth(id: 3, month: "Feb", cost: 49.75, costPerKwh: 0.138),
            CostForecastWidgetHistoricalMonth(id: 4, month: "Mar", cost: 52.30, costPerKwh: 0.144)
        ]
    }

    private func forecast() -> [CostForecastWidgetForecastMonth] {
        [
            CostForecastWidgetForecastMonth(id: 5, month: "Apr", cost: 61.90),
            CostForecastWidgetForecastMonth(id: 6, month: "May", cost: 67.20)
        ]
    }

    func testConcatenatesHistoricalThenForecast() {
        let projection = CostForecastWidgetBuilder.buildProjection(historical: historical(), forecast: forecast())
        XCTAssertEqual(projection.bars.count, 6)
        XCTAssertEqual(projection.bars.first?.month, "Dec")
        XCTAssertEqual(projection.bars.first?.isForecast, false)
        XCTAssertEqual(projection.bars.last?.month, "May")
        XCTAssertEqual(projection.bars.last?.isForecast, true)
        // The historical→forecast boundary lands after the four actual months.
        XCTAssertEqual(projection.bars.count(where: { !$0.isForecast }), 4)
        XCTAssertEqual(projection.bars.count(where: \.isForecast), 2)
    }

    func testDerivesNextLastTrendAndAvg() {
        let projection = CostForecastWidgetBuilder.buildProjection(historical: historical(), forecast: forecast())
        XCTAssertEqual(projection.nextCost, 61.90, accuracy: 0.0001) // forecast[0]
        XCTAssertEqual(projection.lastCost, 52.30, accuracy: 0.0001) // historical.last (Mar)
        XCTAssertTrue(projection.trendUp) // 61.90 >= 52.30
        XCTAssertEqual(projection.trendDelta, 9.60, accuracy: 0.0001)
        XCTAssertEqual(projection.avgCostPerKwh ?? -1, 0.144, accuracy: 0.0001) // Mar cost_per_kwh
        XCTAssertTrue(projection.hasData)
    }

    func testTrendDownWhenForecastBelowLastHistorical() {
        let lower = [CostForecastWidgetForecastMonth(id: 9, month: "Apr", cost: 40.0)]
        let projection = CostForecastWidgetBuilder.buildProjection(historical: historical(), forecast: lower)
        XCTAssertFalse(projection.trendUp) // 40 < 52.30
        XCTAssertEqual(projection.trendDelta, 12.30, accuracy: 0.0001) // |40 - 52.30|
    }

    func testSliceKeepsLastSixMonths() {
        let hist = (0 ..< 5).map { CostForecastWidgetHistoricalMonth(id: $0, month: "H\($0)", cost: Double($0)) }
        let fore = (0 ..< 3).map {
            CostForecastWidgetForecastMonth(id: 100 + $0, month: "F\($0)", cost: Double(100 + $0))
        }
        let projection = CostForecastWidgetBuilder.buildProjection(historical: hist, forecast: fore)
        // 8 months → slice(-6) drops the two oldest historical months.
        XCTAssertEqual(projection.bars.count, 6)
        XCTAssertEqual(projection.bars.first?.month, "H2")
        XCTAssertEqual(projection.bars.last?.month, "F2")
        XCTAssertEqual(projection.bars.last?.isForecast, true)
    }

    func testPlotKeysAreUnique() {
        let hist = (0 ..< 4).map { CostForecastWidgetHistoricalMonth(id: $0, month: "Jan", cost: 10) }
        let fore = (0 ..< 2).map { CostForecastWidgetForecastMonth(id: 50 + $0, month: "Jan", cost: 12) }
        let projection = CostForecastWidgetBuilder.buildProjection(historical: hist, forecast: fore)
        let keys = projection.bars.map(\.plotKey)
        XCTAssertEqual(Set(keys).count, keys.count) // duplicate "Jan" labels never collapse
    }

    func testMissingMonthAndCostUseFallbacks() {
        let hist = [CostForecastWidgetHistoricalMonth(id: 1, month: nil, cost: nil, costPerKwh: nil)]
        let projection = CostForecastWidgetBuilder.buildProjection(historical: hist, forecast: [])
        XCTAssertEqual(projection.bars.first?.month, "—") // web `month ?? '—'`
        XCTAssertEqual(projection.bars.first?.cost ?? -1, 0, accuracy: 0.0001) // web `cost ?? 0`
        XCTAssertEqual(projection.avgCostPerKwh ?? -1, 0, accuracy: 0.0001) // last present, cost_per_kwh ?? 0
    }

    func testEmptyHistoricalLeavesAvgNil() {
        let projection = CostForecastWidgetBuilder.buildProjection(
            historical: [],
            forecast: [CostForecastWidgetForecastMonth(id: 1, month: "Apr", cost: 30)]
        )
        XCTAssertNil(projection.avgCostPerKwh) // no historical → web `'—'`
        XCTAssertEqual(projection.lastCost, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.nextCost, 30, accuracy: 0.0001)
        XCTAssertTrue(projection.trendUp) // 30 >= 0
        XCTAssertTrue(projection.hasData) // forecast month present
    }

    func testHasDataFalseWhenNoMonths() {
        let projection = CostForecastWidgetBuilder.buildProjection(historical: [], forecast: [])
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.bars.isEmpty)
        XCTAssertNil(projection.avgCostPerKwh)
    }
}

// MARK: - Number + currency formatting parity (web fmtNumber / formatCurrency)

@MainActor final class CostForecastWidgetFormatTests: XCTestCase {
    func testNumberKeepsRequestedDigitsAndGroups() {
        XCTAssertEqual(CostForecastWidgetFormat.number(64.1, decimals: 0), "64")
        XCTAssertEqual(CostForecastWidgetFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(CostForecastWidgetFormat.number(0.151, decimals: 2), "0.15")
    }

    func testNumberNonFiniteCollapsesToZero() {
        XCTAssertEqual(CostForecastWidgetFormat.number(.nan, decimals: 2), "0.00")
        XCTAssertEqual(CostForecastWidgetFormat.number(.infinity, decimals: 0), "0")
    }

    func testCurrencyPrependsSymbolAndHonorsDecimals() {
        let usd = CostForecastWidgetCurrencyFormatter(symbol: "$", precision: 2)
        XCTAssertEqual(usd.string(61.9, decimals: 0), "$62")
        XCTAssertEqual(usd.string(0.144, decimals: 2), "$0.14")
        XCTAssertEqual(usd.string(1234.5, decimals: 0), "$1,235")
    }

    func testCurrencyDefaultsToConfiguredPrecision() {
        let twoDigits = CostForecastWidgetCurrencyFormatter(symbol: "€", precision: 2)
        XCTAssertEqual(twoDigits.string(9.5), "€9.50") // decimals == nil → precision
    }

    func testBlankSymbolUsesDollarFallback() {
        let blank = CostForecastWidgetCurrencyFormatter(symbol: "   ", precision: 0)
        XCTAssertEqual(blank.string(10, decimals: 0), "$10")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class CostForecastWidgetModelTests: XCTestCase {
    private func months(_ count: Int) -> [CostForecastWidgetHistoricalMonth] {
        (0 ..< count).map {
            CostForecastWidgetHistoricalMonth(id: $0, month: "M\($0)", cost: Double(10 + $0), costPerKwh: 0.14)
        }
    }

    private func makeModel(
        _ update: CostForecastWidgetUpdate,
        telemetry: CostForecastWidgetTelemetry = OSLogCostForecastWidgetTelemetry()
    ) -> (CostForecastWidgetModel, InMemoryCostForecastWidgetSource) {
        let source = InMemoryCostForecastWidgetSource(initial: update)
        let model = CostForecastWidgetModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(CostForecastWidgetUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(CostForecastWidgetUpdate(status: .loaded, historical: months(3)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(CostForecastWidgetUpdate(status: .loaded, historical: [], forecast: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(CostForecastWidgetUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let (failed, _) = makeModel(
            CostForecastWidgetUpdate(status: .failed("net"), connection: .offline, historical: months(3))
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(CostForecastWidgetUpdate(status: .loading, historical: months(3)))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyCostForecastWidgetTelemetry()
        let (model, source) = makeModel(CostForecastWidgetUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CostForecastWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CostForecastWidgetUpdate(status: .loaded, historical: months(2)))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionProjectionAndCurrencyTrackUpdates() {
        let (model, source) = makeModel(CostForecastWidgetUpdate(status: .loading))
        model.start()
        source.push(
            CostForecastWidgetUpdate(
                status: .loaded,
                connection: .stale,
                historical: [CostForecastWidgetHistoricalMonth(id: 1, month: "Mar", cost: 52.30, costPerKwh: 0.144)],
                forecast: [CostForecastWidgetForecastMonth(id: 2, month: "Apr", cost: 61.90)],
                currencySymbol: "£",
                decimalPrecision: 2,
                updatedAt: Date(timeIntervalSince1970: 1000)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.nextCost, 61.90, accuracy: 0.0001)
        XCTAssertEqual(model.currency.symbol, "£")
        XCTAssertEqual(model.currency.string(61.9, decimals: 0), "£62")
    }

    func testCompactAndWideThresholds() {
        // Web `isCompact = size.cols <= 1` (column-only, regardless of rows).
        XCTAssertTrue(CostForecastWidgetModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertTrue(CostForecastWidgetModel.isCompact(DashboardWidgetSize(cols: 1, rows: 8)))
        XCTAssertFalse(CostForecastWidgetModel.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(CostForecastWidgetModel.isWide(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(CostForecastWidgetModel.isWide(DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class CostForecastWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = CostForecastWidget.registration
        XCTAssertEqual(registration.id, "cost-forecast")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = CostForecastWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility content

@MainActor final class CostForecastWidgetAccessibilityTests: XCTestCase {
    private let currency = CostForecastWidgetCurrencyFormatter(symbol: "$", precision: 2)

    private func projection() -> CostForecastWidgetProjection {
        CostForecastWidgetBuilder.buildProjection(
            historical: [CostForecastWidgetHistoricalMonth(id: 1, month: "Mar", cost: 52.30, costPerKwh: 0.144)],
            forecast: [CostForecastWidgetForecastMonth(id: 2, month: "Apr", cost: 61.90)]
        )
    }

    func testSummaryIncludesStatsAndUnit() {
        let summary = CostForecastWidgetAccessibility.summary(for: projection(), currency: currency)
        XCTAssertTrue(summary.contains("Next Month"))
        XCTAssertTrue(summary.contains("$62")) // next-month cost, 0 decimals
        XCTAssertTrue(summary.contains("Avg $/kWh"))
        XCTAssertTrue(summary.contains("$0.14")) // avg $/kWh, 2 decimals
        XCTAssertTrue(summary.contains("Trend"))
        XCTAssertTrue(summary.contains("up")) // 61.90 >= 52.30
    }

    func testSummaryEmptyWhenNoData() {
        let summary = CostForecastWidgetAccessibility.summary(for: .empty, currency: currency)
        XCTAssertEqual(summary, "No forecast data")
    }

    func testTrendPhraseDirectionAndDelta() {
        let phrase = CostForecastWidgetAccessibility.trendPhrase(for: projection(), currency: currency)
        XCTAssertTrue(phrase.contains("up"))
        XCTAssertTrue(phrase.contains("$10")) // |61.90 - 52.30| = 9.60 → "$10" at 0 decimals
    }

    func testBarLabelIncludesMonthCostAndKind() {
        let actual = CostForecastWidgetBar(plotKey: "0000", month: "Mar", cost: 52.30, isForecast: false)
        let forecast = CostForecastWidgetBar(plotKey: "0001", month: "Apr", cost: 61.90, isForecast: true)
        let actualLabel = CostForecastWidgetAccessibility.barLabel(actual, currency: currency)
        let forecastLabel = CostForecastWidgetAccessibility.barLabel(forecast, currency: currency)
        XCTAssertTrue(actualLabel.contains("Mar"))
        XCTAssertTrue(actualLabel.contains("$52"))
        XCTAssertTrue(actualLabel.contains("Actual"))
        XCTAssertTrue(forecastLabel.contains("Apr"))
        XCTAssertTrue(forecastLabel.contains("Forecast"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostForecastWidgetTelemetry: CostForecastWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
