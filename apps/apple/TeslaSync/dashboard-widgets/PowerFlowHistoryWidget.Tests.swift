//
//  PowerFlowHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0073 · PowerFlowHistoryWidget (Apple)
//
//  Unit coverage for the PowerFlowHistoryWidget surface:
//    • Adapter (cached → projection) — `PowerFlowHistoryWidgetProjection` watt→kW conversion,
//      summary (mean / peak / sum), stacked-sample flatten, `PowerFlowHistoryWidgetFormat`,
//      and the `PowerFlowSeries` catalog parity with the web `<Area>` series.
//    • State holder — `PowerFlowModel` phase + empty-reason resolution across
//      loading / loaded / failed / no-site / no-data / cached, plus the P1/S11
//      `view.opened` telemetry + source wiring.
//    • Registry — canonical `power-flow-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the chart + stats.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryPowerFlowSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with web chartData/summary)

@MainActor final class PowerFlowAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the catalog tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }
    /// Deterministic locale so formatted numbers are stable across runners.
    private let enUS = Locale(identifier: "en_US")

    private func entry(
        hoursAgo: Double,
        solar: Double?,
        battery: Double?,
        grid: Double?,
        load: Double?,
        now: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> PowerFlowHistoryEntryInput {
        PowerFlowHistoryEntryInput(
            timestamp: now.addingTimeInterval(-hoursAgo * 3600),
            solarPowerW: solar,
            batteryPowerW: battery,
            gridPowerW: grid,
            loadPowerW: load
        )
    }

    func testPointsConvertWattsToKilowatts() {
        let points = PowerFlowHistoryWidgetProjection.points(from: [
            entry(hoursAgo: 1, solar: 1500, battery: -250, grid: 500, load: 1750)
        ])
        XCTAssertEqual(points.count, 1)
        XCTAssertEqual(points[0].solarKw, 1.5, accuracy: 0.0001)
        XCTAssertEqual(points[0].batteryKw, -0.25, accuracy: 0.0001)
        XCTAssertEqual(points[0].gridKw, 0.5, accuracy: 0.0001)
        XCTAssertEqual(points[0].homeKw, 1.75, accuracy: 0.0001)
    }

    func testPointsNullCoalesceToZero() {
        let points = PowerFlowHistoryWidgetProjection.points(from: [
            entry(hoursAgo: 1, solar: nil, battery: nil, grid: nil, load: nil)
        ])
        XCTAssertEqual(points[0].solarKw, 0)
        XCTAssertEqual(points[0].batteryKw, 0)
        XCTAssertEqual(points[0].gridKw, 0)
        XCTAssertEqual(points[0].homeKw, 0)
    }

    func testSummaryComputesMeanPeakSum() {
        let points = PowerFlowHistoryWidgetProjection.points(from: [
            entry(hoursAgo: 3, solar: 2000, battery: 1000, grid: -500, load: 1500),
            entry(hoursAgo: 2, solar: 4000, battery: 0, grid: 1000, load: 3000),
            entry(hoursAgo: 1, solar: 0, battery: 2000, grid: 500, load: 2000)
        ])
        let summary = PowerFlowHistoryWidgetProjection.summary(for: points)
        XCTAssertEqual(summary.avgSolarKw, 2.0, accuracy: 0.0001) // (2 + 4 + 0) / 3
        XCTAssertEqual(summary.peakHomeKw, 3.0, accuracy: 0.0001) // max(1.5, 3, 2)
        XCTAssertEqual(summary.netGridKw, 1.0, accuracy: 0.0001) // -0.5 + 1 + 0.5
    }

    func testSummaryIsZeroWhenEmpty() {
        XCTAssertEqual(PowerFlowHistoryWidgetProjection.summary(for: []), .zero)
    }

    func testHasDataDistinguishesZeroFromSignal() {
        let zero = PowerFlowHistoryWidgetProjection.points(from: [entry(
            hoursAgo: 1,
            solar: 0,
            battery: 0,
            grid: 0,
            load: 0
        )])
        XCTAssertFalse(PowerFlowHistoryWidgetProjection.hasData(zero))

        let signal = PowerFlowHistoryWidgetProjection.points(from: [entry(
            hoursAgo: 1,
            solar: 0,
            battery: 0,
            grid: 0,
            load: 120
        )])
        XCTAssertTrue(PowerFlowHistoryWidgetProjection.hasData(signal))
    }

    func testSamplesFlattenInSeriesOrder() {
        let points = PowerFlowHistoryWidgetProjection.points(from: [
            entry(hoursAgo: 2, solar: 1000, battery: 0, grid: 0, load: 0),
            entry(hoursAgo: 1, solar: 0, battery: 1000, grid: 0, load: 0)
        ])
        let samples = PowerFlowHistoryWidgetProjection.samples(for: points)
        XCTAssertEqual(samples.count, points.count * PowerFlowSeries.allCases.count)
        XCTAssertEqual(Array(samples.prefix(4)).map(\.series), [.solar, .battery, .grid, .home])
        XCTAssertEqual(samples[0].valueKw, 1.0, accuracy: 0.0001)
    }

    func testKilowattsFormatsOneDecimal() {
        XCTAssertEqual(PowerFlowHistoryWidgetFormat.kilowatts(2, locale: enUS), "2.0")
        XCTAssertEqual(PowerFlowHistoryWidgetFormat.kilowatts(12.36, locale: enUS), "12.4")
        XCTAssertEqual(PowerFlowHistoryWidgetFormat.kilowatts(1234.5, locale: enUS), "1,234.5")
    }

    func testKilowattsNonFiniteRendersDash() {
        XCTAssertEqual(PowerFlowHistoryWidgetFormat.kilowatts(.infinity, locale: enUS), "—")
        XCTAssertEqual(PowerFlowHistoryWidgetFormat.kilowatts(.nan, locale: enUS), "—")
    }

    func testShortTimeZeroPadsTwentyFourHour() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let date = calendar.date(from: DateComponents(year: 2024, month: 1, day: 1, hour: 9, minute: 5))
        XCTAssertEqual(PowerFlowHistoryWidgetFormat.shortTime(date ?? Date(), calendar: calendar), "09:05")
    }

    func testSeriesCatalogParity() {
        XCTAssertEqual(PowerFlowSeries.allCases, [.solar, .battery, .grid, .home])
        XCTAssertEqual(PowerFlowSeries.solar.i18nKey, "widget.powerFlowHistory.solar")
        XCTAssertEqual(PowerFlowSeries.battery.fallbackLabel, "Battery")
        XCTAssertEqual(PowerFlowSeries.grid.localizedName(echo), "Grid")
        XCTAssertEqual(PowerFlowSeries.home.localizedName(keyTap), "L:widget.powerFlowHistory.home")
    }
}

// MARK: - State holder: phases + empty reasons + telemetry + source wiring

@MainActor final class PowerFlowModelTests: XCTestCase {
    private func makeModel(
        _ update: PowerFlowUpdate,
        telemetry: PowerFlowTelemetry = OSLogPowerFlowTelemetry()
    ) -> (PowerFlowModel, InMemoryPowerFlowSource) {
        let source = InMemoryPowerFlowSource(initial: update)
        let model = PowerFlowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let site = PowerFlowSiteInput(energySiteID: 7)

    private func dataHistory(now: Date = Date()) -> [PowerFlowHistoryEntryInput] {
        [
            PowerFlowHistoryEntryInput(
                timestamp: now.addingTimeInterval(-7200),
                solarPowerW: 3000, batteryPowerW: 500, gridPowerW: -800, loadPowerW: 2700
            ),
            PowerFlowHistoryEntryInput(
                timestamp: now.addingTimeInterval(-3600),
                solarPowerW: 1500, batteryPowerW: -400, gridPowerW: 600, loadPowerW: 1700
            )
        ]
    }

    private func zeroHistory(now: Date = Date()) -> [PowerFlowHistoryEntryInput] {
        [PowerFlowHistoryEntryInput(timestamp: now, solarPowerW: 0, batteryPowerW: 0, gridPowerW: 0, loadPowerW: 0)]
    }

    func testLoadingWithoutContentShowsLoading() {
        let (model, _) = makeModel(PowerFlowUpdate(status: .loading, site: nil, history: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSiteShowsNoSiteEmpty() {
        let (model, _) = makeModel(PowerFlowUpdate(status: .loaded, site: nil, history: []))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.emptyReason, .noSite)
    }

    func testLoadedWithSiteButNoSignalShowsNoData() {
        let (model, _) = makeModel(PowerFlowUpdate(status: .loaded, site: site, history: zeroHistory()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.emptyReason, .noData)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(PowerFlowUpdate(status: .loaded, site: site, history: dataHistory()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertGreaterThan(model.summary.avgSolarKw, 0)
    }

    func testLoadingWithCachedContentStaysContent() {
        let (model, _) = makeModel(PowerFlowUpdate(status: .loading, site: site, history: dataHistory()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
    }

    func testFailedShowsError() {
        let (model, _) = makeModel(PowerFlowUpdate(status: .failed("boom"), site: nil, history: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyPowerFlowTelemetry()
        let (model, source) = makeModel(PowerFlowUpdate(status: .loading, site: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PowerFlowHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(PowerFlowUpdate(status: .loaded, site: site, history: dataHistory()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(PowerFlowUpdate(status: .loading, site: nil, history: []))
        model.start()
        source.push(
            PowerFlowUpdate(
                status: .loaded,
                connection: .offline,
                site: site,
                history: dataHistory(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
        XCTAssertEqual(model.points.count, 2)
    }

    func testResolvePhaseAndEmptyReasonDirectly() {
        XCTAssertEqual(PowerFlowModel.resolvePhase(status: .loading, hasContent: false), .loading)
        XCTAssertEqual(PowerFlowModel.resolvePhase(status: .loading, hasContent: true), .content)
        XCTAssertEqual(PowerFlowModel.resolvePhase(status: .loaded, hasContent: false), .content)
        XCTAssertEqual(PowerFlowModel.resolvePhase(status: .failed("x"), hasContent: true), .error("x"))

        XCTAssertEqual(PowerFlowModel.resolveEmptyReason(site: nil, points: []), .noSite)
        let zero = PowerFlowHistoryWidgetProjection.points(from: [
            PowerFlowHistoryEntryInput(
                timestamp: Date(),
                solarPowerW: 0,
                batteryPowerW: 0,
                gridPowerW: 0,
                loadPowerW: 0
            )
        ])
        XCTAssertEqual(PowerFlowModel.resolveEmptyReason(site: site, points: zero), .noData)
        let signal = PowerFlowHistoryWidgetProjection.points(from: [
            PowerFlowHistoryEntryInput(
                timestamp: Date(),
                solarPowerW: 1000,
                batteryPowerW: 0,
                gridPowerW: 0,
                loadPowerW: 0
            )
        ])
        XCTAssertNil(PowerFlowModel.resolveEmptyReason(site: site, points: signal))
    }
}

// MARK: - Registry parity

@MainActor final class PowerFlowRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = PowerFlowHistoryWidget.registration
        XCTAssertEqual(registration.id, "power-flow-history")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(PowerFlowHistoryWidget.surfaceSlug, "PowerFlowHistoryWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = PowerFlowHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 2, rows: 4))
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

// MARK: - Accessibility summary content

@MainActor final class PowerFlowAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let enUS = Locale(identifier: "en_US")

    func testChartSummaryIncludesTitleAndStats() {
        let summary = PowerFlowSummary(avgSolarKw: 2, peakHomeKw: 3, netGridKw: 1)
        let spoken = PowerFlowAccessibility.chartSummary(summary: summary, localize: echo, locale: enUS)
        XCTAssertTrue(spoken.contains("Power Flow History"))
        XCTAssertTrue(spoken.contains("Avg Solar: 2.0 kW"))
        XCTAssertTrue(spoken.contains("Peak Home: 3.0 kW"))
        XCTAssertTrue(spoken.contains("Net Grid: 1.0 kW"))
    }

    func testStatLabelFormatsValueAndUnit() {
        let label = PowerFlowAccessibility.statLabel(
            labelKey: "widget.powerFlowHistory.avgSolar", fallback: "Avg Solar",
            valueKw: 4.25, localize: echo, locale: enUS
        )
        XCTAssertEqual(label, "Avg Solar: 4.3 kW")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPowerFlowTelemetry: PowerFlowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
