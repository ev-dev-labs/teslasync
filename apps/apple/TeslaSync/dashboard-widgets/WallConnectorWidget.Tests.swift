//
//  WallConnectorWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0112 · WallConnectorWidget (Apple)
//
//  Unit coverage for the WallConnectorWidget surface:
//    • Adapter (cached → projection) — `WallConnectorProjection` daily kWh
//      aggregation, the current-month summary (total / count / mean), the has-data
//      predicate, `WallConnectorFormat`, and the day key/label derivations.
//    • State holder — `WallConnectorModel` phase + empty-reason resolution across
//      loading / loaded / failed / no-site / no-data / cached, plus the P1/S11
//      `view.opened` telemetry + source wiring.
//    • Registry — canonical `wall-connector` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the chart + stats.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryWallConnectorSource`, and the pure
//  adapter is exercised with a fixed UTC calendar + clock so day bucketing and the
//  "same month" test are deterministic across runners.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum WCFixture {
    /// A fixed UTC Gregorian calendar so day bucketing + month filtering are stable.
    static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    /// A reference "now" inside June 2024 for the month-summary tests.
    static let now = date(2024, 6, 15, 12)

    static func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> Date {
        let components = DateComponents(year: year, month: month, day: day, hour: hour)
        return utc.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }

    static func entry(_ year: Int, _ month: Int, _ day: Int, hour: Int = 12, kwh: Double?) -> WallConnectorEntryInput {
        WallConnectorEntryInput(
            timestamp: date(year, month, day, hour),
            energyWh: kwh.map { $0 * 1000 }
        )
    }
}

// MARK: - Adapter: cached DTO → projection (parity with web chartData/summary)

@MainActor final class WallConnectorAdapterTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testDailyBarsAggregateSortAndConvertToKilowattHours() {
        let bars = WallConnectorProjection.dailyBars(
            from: [
                WCFixture.entry(2024, 6, 3, hour: 23, kwh: 5),
                WCFixture.entry(2024, 6, 1, hour: 8, kwh: 10),
                WCFixture.entry(2024, 6, 3, hour: 1, kwh: 2.5)
            ],
            calendar: WCFixture.utc
        )
        XCTAssertEqual(bars.count, 2)
        // Sorted ascending by day: 6/1 then 6/3.
        XCTAssertEqual(bars.map(\.label), ["6/1", "6/3"])
        XCTAssertEqual(bars[0].energyKwh, 10, accuracy: 0.0001)
        XCTAssertEqual(bars[1].energyKwh, 7.5, accuracy: 0.0001) // 5 + 2.5 same day
        XCTAssertEqual(bars[0].id, "2024-06-01")
        XCTAssertEqual(bars[1].id, "2024-06-03")
    }

    func testDailyBarsNullEnergyCoalescesToZero() {
        let bars = WallConnectorProjection.dailyBars(
            from: [WCFixture.entry(2024, 6, 2, kwh: nil)],
            calendar: WCFixture.utc
        )
        XCTAssertEqual(bars.count, 1)
        XCTAssertEqual(bars[0].energyKwh, 0, accuracy: 0.0001)
    }

    func testSummaryComputesMonthTotalsCountAndMean() {
        let summary = WallConnectorProjection.summary(
            for: [
                WCFixture.entry(2024, 6, 2, kwh: 10),
                WCFixture.entry(2024, 6, 9, kwh: 20),
                WCFixture.entry(2024, 6, 14, kwh: 30),
                WCFixture.entry(2024, 5, 31, kwh: 99) // previous month — excluded
            ],
            now: WCFixture.now,
            calendar: WCFixture.utc
        )
        XCTAssertEqual(summary.monthTotalKwh, 60, accuracy: 0.0001) // 10 + 20 + 30
        XCTAssertEqual(summary.monthSessions, 3)
        XCTAssertEqual(summary.avgKwhPerSession, 20, accuracy: 0.0001) // 60 / 3
    }

    func testSummaryCountsNullEnergyRowsAsSessions() {
        // Web counts month rows (monthEntries.length) regardless of energy presence.
        let summary = WallConnectorProjection.summary(
            for: [
                WCFixture.entry(2024, 6, 2, kwh: 12),
                WCFixture.entry(2024, 6, 4, kwh: nil)
            ],
            now: WCFixture.now,
            calendar: WCFixture.utc
        )
        XCTAssertEqual(summary.monthSessions, 2)
        XCTAssertEqual(summary.monthTotalKwh, 12, accuracy: 0.0001)
        XCTAssertEqual(summary.avgKwhPerSession, 6, accuracy: 0.0001) // 12 / 2
    }

    func testSummaryIsZeroWhenNoMonthEntries() {
        let summary = WallConnectorProjection.summary(
            for: [WCFixture.entry(2024, 5, 1, kwh: 50)],
            now: WCFixture.now,
            calendar: WCFixture.utc
        )
        XCTAssertEqual(summary, .zero)
        XCTAssertEqual(summary.avgKwhPerSession, 0)
    }

    func testHasDataDistinguishesZeroFromSignal() {
        let zero = WallConnectorProjection.dailyBars(
            from: [WCFixture.entry(2024, 6, 1, kwh: 0)],
            calendar: WCFixture.utc
        )
        XCTAssertFalse(WallConnectorProjection.hasData(zero))
        XCTAssertFalse(WallConnectorProjection.hasData([]))

        let signal = WallConnectorProjection.dailyBars(
            from: [WCFixture.entry(2024, 6, 1, kwh: 4.2)],
            calendar: WCFixture.utc
        )
        XCTAssertTrue(WallConnectorProjection.hasData(signal))
    }

    func testKilowattHoursFormatsOneDecimal() {
        XCTAssertEqual(WallConnectorFormat.kilowattHours(42, locale: enUS), "42.0")
        XCTAssertEqual(WallConnectorFormat.kilowattHours(12.34, locale: enUS), "12.3")
        XCTAssertEqual(WallConnectorFormat.kilowattHours(12.36, locale: enUS), "12.4")
        XCTAssertEqual(WallConnectorFormat.kilowattHours(1234.5, locale: enUS), "1,234.5")
    }

    func testIntegerAndAxisFormatting() {
        XCTAssertEqual(WallConnectorFormat.integer(7, locale: enUS), "7")
        XCTAssertEqual(WallConnectorFormat.integer(1234, locale: enUS), "1,234")
        XCTAssertEqual(WallConnectorFormat.axisKwh(18.7, locale: enUS), "19")
    }

    func testNonFiniteRendersDash() {
        XCTAssertEqual(WallConnectorFormat.kilowattHours(.infinity, locale: enUS), "—")
        XCTAssertEqual(WallConnectorFormat.kilowattHours(.nan, locale: enUS), "—")
    }

    func testDayKeyAndLabelDerivation() {
        let day = WCFixture.date(2024, 1, 5)
        XCTAssertEqual(WallConnectorProjection.dayKey(day, calendar: WCFixture.utc), "2024-01-05")
        XCTAssertEqual(WallConnectorProjection.dayLabel(day, calendar: WCFixture.utc), "1/5")
    }
}

// MARK: - State holder: phases + empty reasons + telemetry + source wiring

@MainActor final class WallConnectorModelTests: XCTestCase {
    private let site = WallConnectorSiteInput(energySiteID: 7)

    private func makeModel(
        _ update: WallConnectorUpdate,
        telemetry: WallConnectorTelemetry = OSLogWallConnectorTelemetry()
    ) -> (WallConnectorModel, InMemoryWallConnectorSource) {
        let source = InMemoryWallConnectorSource(initial: update)
        let model = WallConnectorModel(source: source, telemetry: telemetry, calendar: WCFixture.utc)
        return (model, source)
    }

    private func dataHistory() -> [WallConnectorEntryInput] {
        [
            WCFixture.entry(2024, 6, 10, kwh: 12),
            WCFixture.entry(2024, 6, 12, kwh: 18)
        ]
    }

    private func zeroHistory() -> [WallConnectorEntryInput] {
        [WCFixture.entry(2024, 6, 11, kwh: 0)]
    }

    private func update(
        status: WallConnectorLoadStatus,
        connection: WallConnectorConnection = .live,
        site: WallConnectorSiteInput?,
        history: [WallConnectorEntryInput] = []
    ) -> WallConnectorUpdate {
        WallConnectorUpdate(
            status: status,
            connection: connection,
            site: site,
            history: history,
            now: WCFixture.now
        )
    }

    func testLoadingWithoutContentShowsLoading() {
        let (model, _) = makeModel(update(status: .loading, site: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSiteShowsNoSiteEmpty() {
        let (model, _) = makeModel(update(status: .loaded, site: nil))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.emptyReason, .noSite)
    }

    func testLoadedWithSiteButNoSignalShowsNoData() {
        let (model, _) = makeModel(update(status: .loaded, site: site, history: zeroHistory()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.emptyReason, .noData)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(update(status: .loaded, site: site, history: dataHistory()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
        XCTAssertEqual(model.bars.count, 2)
        XCTAssertEqual(model.summary.monthSessions, 2)
        XCTAssertEqual(model.summary.monthTotalKwh, 30, accuracy: 0.0001)
        XCTAssertEqual(model.summary.avgKwhPerSession, 15, accuracy: 0.0001)
    }

    func testLoadingWithCachedContentStaysContent() {
        let (model, _) = makeModel(update(status: .loading, site: site, history: dataHistory()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
    }

    func testFailedShowsError() {
        let (model, _) = makeModel(update(status: .failed("boom"), site: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWallConnectorTelemetry()
        let (model, source) = makeModel(update(status: .loading, site: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WallConnectorWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(update(status: .loaded, site: site, history: dataHistory()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(update(status: .loading, site: nil))
        model.start()
        source.push(
            WallConnectorUpdate(
                status: .loaded,
                connection: .offline,
                site: site,
                history: dataHistory(),
                now: WCFixture.now,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.emptyReason)
        XCTAssertEqual(model.bars.count, 2)
    }

    func testStopResetsStartedSoTelemetryCanReArm() {
        let spy = SpyWallConnectorTelemetry()
        let (model, _) = makeModel(update(status: .loaded, site: site, history: dataHistory()), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testResolvePhaseAndEmptyReasonDirectly() {
        XCTAssertEqual(WallConnectorModel.resolvePhase(status: .loading, hasContent: false), .loading)
        XCTAssertEqual(WallConnectorModel.resolvePhase(status: .loading, hasContent: true), .content)
        XCTAssertEqual(WallConnectorModel.resolvePhase(status: .loaded, hasContent: false), .content)
        XCTAssertEqual(WallConnectorModel.resolvePhase(status: .failed("x"), hasContent: true), .error("x"))

        XCTAssertEqual(WallConnectorModel.resolveEmptyReason(site: nil, bars: []), .noSite)
        let zero = WallConnectorProjection.dailyBars(
            from: [WCFixture.entry(2024, 6, 1, kwh: 0)],
            calendar: WCFixture.utc
        )
        XCTAssertEqual(WallConnectorModel.resolveEmptyReason(site: site, bars: zero), .noData)
        let signal = WallConnectorProjection.dailyBars(
            from: [WCFixture.entry(2024, 6, 1, kwh: 9)],
            calendar: WCFixture.utc
        )
        XCTAssertNil(WallConnectorModel.resolveEmptyReason(site: site, bars: signal))
    }
}

// MARK: - Registry parity

@MainActor final class WallConnectorRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = WallConnectorWidget.registration
        XCTAssertEqual(registration.id, "wall-connector")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(WallConnectorWidget.surfaceSlug, "WallConnectorWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = WallConnectorWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)),
            DashboardWidgetSize(cols: 2, rows: 8)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class WallConnectorAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let enUS = Locale(identifier: "en_US")

    func testChartSummaryIncludesTitleAndMonthStats() {
        let summary = WallConnectorSummary(monthTotalKwh: 42.5, monthSessions: 7, avgKwhPerSession: 6.07)
        let spoken = WallConnectorAccessibility.chartSummary(summary: summary, localize: echo, locale: enUS)
        XCTAssertTrue(spoken.contains("Wall Connector"))
        XCTAssertTrue(spoken.contains("This Month: 42.5 kWh"))
        XCTAssertTrue(spoken.contains("Sessions: 7"))
    }

    func testStatLabelFormatsValueWithAndWithoutUnit() {
        XCTAssertEqual(
            WallConnectorAccessibility.statLabel(label: "This Month", value: "42.5", unit: "kWh"),
            "This Month: 42.5 kWh"
        )
        XCTAssertEqual(
            WallConnectorAccessibility.statLabel(label: "Sessions", value: "7", unit: nil),
            "Sessions: 7"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWallConnectorTelemetry: WallConnectorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
