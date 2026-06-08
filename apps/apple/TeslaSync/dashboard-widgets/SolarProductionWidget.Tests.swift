//
//  SolarProductionWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  Unit coverage for the SolarProductionWidget surface:
//    • Adapter (cached → projection) — `SolarProductionBuilder` parity with the
//      web `chartData` / `todayKwh` / `totalKwh` / `avgKwh` memos + the
//      `shortDate` / `todayKey` helpers and the `hasData` empty gate.
//    • State holder — `SolarProductionModel` phase resolution across loading /
//      no-site / empty / error / content, plus the P1/S11 `view.opened`
//      telemetry + source wiring + freshness tracking.
//    • Registry — canonical `solar-production` metadata + size clamping.
//    • Formatting — locale-safe kWh number/integer formatting.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySolarProductionSource`.
//

import XCTest

// MARK: - Adapter: cached DTO → projection (parity with the web memos)

@MainActor final class SolarProductionBuilderTests: XCTestCase {
    private let today = "2026-06-07"

    func testShortDateStripsLeadingZerosAndMatchesWebMD() {
        XCTAssertEqual(SolarProductionBuilder.shortDate("2026-06-01T00:00:00Z"), "6/1")
        XCTAssertEqual(SolarProductionBuilder.shortDate("2026-12-25"), "12/25")
        XCTAssertEqual(SolarProductionBuilder.shortDate("2026-01-09T12:34:56Z"), "1/9")
    }

    func testShortDateFallsBackOnUnparseableInput() {
        XCTAssertEqual(SolarProductionBuilder.shortDate("not-a-date"), "not-a-date")
        XCTAssertEqual(SolarProductionBuilder.shortDate("2026-13-40"), "2026-13-40")
        XCTAssertEqual(SolarProductionBuilder.shortDate(""), "")
    }

    func testDayKeyIsUTCAndStable() {
        // 1780531200 = 2026-06-04T00:00:00Z exactly.
        let instant = Date(timeIntervalSince1970: 1_780_531_200)
        XCTAssertEqual(SolarProductionBuilder.dayKey(instant), "2026-06-04")
    }

    func testSinceKeyIsThirtyDaysBeforeToday() {
        let instant = Date(timeIntervalSince1970: 1_780_531_200) // 2026-06-04Z
        XCTAssertEqual(SolarProductionBuilder.sinceKey(from: instant), "2026-05-05")
    }

    func testEmptyHistoryYieldsEmptyProjection() {
        let projection = SolarProductionBuilder.buildProjection(history: [], todayKey: today)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.points.isEmpty)
        XCTAssertEqual(projection.totalKwh, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.avgKwh, 0, accuracy: 0.0001)
    }

    func testProjectionComputesTodayTotalAverageAndLabels() {
        let history = [
            SolarHistoryEntry(timestamp: "2026-05-01T00:00:00Z", solarEnergyWh: 12000),
            SolarHistoryEntry(timestamp: "2026-05-02T00:00:00Z", solarEnergyWh: nil), // ?? 0
            SolarHistoryEntry(timestamp: "2026-05-03T00:00:00Z", solarEnergyWh: 0),
            SolarHistoryEntry(timestamp: "\(today)T00:00:00Z", solarEnergyWh: 8000) // today
        ]
        let projection = SolarProductionBuilder.buildProjection(history: history, todayKey: today)
        XCTAssertEqual(projection.points.count, 4)
        XCTAssertEqual(projection.points[0].solarKwh, 12, accuracy: 0.0001)
        XCTAssertEqual(projection.points[1].solarKwh, 0, accuracy: 0.0001) // nil → 0
        XCTAssertEqual(projection.todayKwh, 8, accuracy: 0.0001)
        XCTAssertEqual(projection.totalKwh, 20, accuracy: 0.0001) // 12 + 0 + 0 + 8
        XCTAssertEqual(projection.avgKwh, 5, accuracy: 0.0001) // 20 / 4
        XCTAssertEqual(projection.peakKwh, 12, accuracy: 0.0001)
        XCTAssertEqual(projection.points[0].dateLabel, "5/1")
        XCTAssertEqual(projection.points[0].isoDay, "2026-05-01")
        XCTAssertTrue(projection.hasData)
    }

    func testTodayKwhIsZeroWhenNoMatchingBucket() {
        let history = [SolarHistoryEntry(timestamp: "2026-05-01T00:00:00Z", solarEnergyWh: 5000)]
        let projection = SolarProductionBuilder.buildProjection(history: history, todayKey: today)
        XCTAssertEqual(projection.todayKwh, 0, accuracy: 0.0001)
    }

    func testHasDataIsFalseWhenAllDaysAreZero() {
        let history = [
            SolarHistoryEntry(timestamp: "2026-05-01", solarEnergyWh: 0),
            SolarHistoryEntry(timestamp: "2026-05-02", solarEnergyWh: nil)
        ]
        let projection = SolarProductionBuilder.buildProjection(history: history, todayKey: today)
        XCTAssertEqual(projection.points.count, 2)
        XCTAssertFalse(projection.hasData) // rows exist but no positive solar
    }

    func testPointsPreserveOrderAndIndices() {
        let history = (0 ..< 5).map { offset in
            SolarHistoryEntry(
                timestamp: String(format: "2026-05-%02dT00:00:00Z", offset + 1),
                solarEnergyWh: Double(offset) * 1000
            )
        }
        let projection = SolarProductionBuilder.buildProjection(history: history, todayKey: today)
        XCTAssertEqual(projection.points.map(\.index), [0, 1, 2, 3, 4])
        XCTAssertEqual(projection.points.map(\.dateLabel), ["5/1", "5/2", "5/3", "5/4", "5/5"])
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SolarProductionModelTests: XCTestCase {
    private let today = "2026-06-07"

    private func history(positive: Bool = true) -> [SolarHistoryEntry] {
        [SolarHistoryEntry(timestamp: "\(today)T00:00:00Z", solarEnergyWh: positive ? 9000 : 0)]
    }

    private func makeModel(
        _ update: SolarProductionUpdate,
        telemetry: SolarProductionTelemetry = OSLogSolarProductionTelemetry()
    ) -> (SolarProductionModel, InMemorySolarProductionSource) {
        let source = InMemorySolarProductionSource(initial: update)
        let model = SolarProductionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutCachedHistoryShowsLoading() {
        let (model, _) = makeModel(SolarProductionUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedHistoryShowsContent() {
        let (model, _) = makeModel(
            SolarProductionUpdate(status: .loading, hasSites: true, history: history(), todayKey: today)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutSitesShowsNoSite() {
        let (model, _) = makeModel(SolarProductionUpdate(status: .loaded, hasSites: false))
        model.start()
        XCTAssertEqual(model.phase, .noSite)
    }

    func testLoadedWithSiteButEmptyHistoryShowsContentWithoutData() {
        let (model, _) = makeModel(
            SolarProductionUpdate(
                status: .loaded,
                hasSites: true,
                site: SolarEnergySite(energySiteID: 1),
                todayKey: today
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.projection.hasData) // body renders the "No solar data" empty state
    }

    func testLoadedWithSiteAndDataShowsContent() {
        let (model, _) = makeModel(
            SolarProductionUpdate(status: .loaded, hasSites: true, history: history(), todayKey: today)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertEqual(model.projection.todayKwh, 9, accuracy: 0.0001)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SolarProductionUpdate(status: .failed("boom"), hasSites: true))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedHistoryKeepsContent() {
        let (model, _) = makeModel(
            SolarProductionUpdate(status: .failed("net"), hasSites: true, history: history(), todayKey: today)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testFailedWithoutSitesShowsNoSite() {
        let (model, _) = makeModel(SolarProductionUpdate(status: .failed("sites down"), hasSites: false))
        model.start()
        XCTAssertEqual(model.phase, .noSite) // web no-site precedence over the error shell
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySolarProductionTelemetry()
        let (model, source) = makeModel(SolarProductionUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SolarProductionWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SolarProductionUpdate(status: .loaded, hasSites: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SolarProductionUpdate(status: .loading))
        model.start()
        source.push(
            SolarProductionUpdate(
                status: .loaded,
                freshness: .offline,
                hasSites: true,
                site: SolarEnergySite(energySiteID: 7),
                history: history(),
                todayKey: today,
                updatedAt: Date(),
                isFetching: false
            )
        )
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(SolarProductionModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(SolarProductionModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(SolarProductionModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(SolarProductionModel.isWide(for: DashboardWidgetSize(cols: 3, rows: 6)))
    }
}

// MARK: - Registry parity

@MainActor final class SolarProductionRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SolarProductionWidget.registration
        XCTAssertEqual(registration.id, "solar-production")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SolarProductionWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)),
            DashboardWidgetSize(cols: 2, rows: 6)
        )
    }
}

// MARK: - Formatting (locale-safe)

@MainActor final class SolarProductionFormatTests: XCTestCase {
    func testNumberKeepsFractionDigits() {
        XCTAssertEqual(SolarProductionFormat.number(8.0, fractionDigits: 1).filter(\.isNumber), "80")
        XCTAssertEqual(SolarProductionFormat.number(4.25, fractionDigits: 1).filter(\.isNumber), "43") // rounds to 4.3
        XCTAssertEqual(SolarProductionFormat.number(0, fractionDigits: 1).filter(\.isNumber), "00")
    }

    func testIntegerRoundsAndGroups() {
        XCTAssertEqual(SolarProductionFormat.integer(1234.6).filter(\.isNumber), "1235")
        XCTAssertEqual(SolarProductionFormat.integer(0).filter(\.isNumber), "0")
    }

    func testValueAppendsUnit() {
        let value = SolarProductionFormat.value(8.0, fractionDigits: 1)
        XCTAssertTrue(value.contains("kWh"))
        XCTAssertEqual(value.filter(\.isNumber), "80")
    }

    func testNonFiniteIsSafe() {
        XCTAssertEqual(SolarProductionFormat.number(.nan, fractionDigits: 1).filter(\.isNumber), "00")
        XCTAssertEqual(SolarProductionFormat.integer(.infinity).filter(\.isNumber), "0")
    }
}

// MARK: - Accessibility summary content

@MainActor final class SolarProductionAccessibilityTests: XCTestCase {
    func testSummaryListsEveryMetricWithUnit() {
        let history = [SolarHistoryEntry(timestamp: "2026-06-07T00:00:00Z", solarEnergyWh: 9000)]
        let projection = SolarProductionBuilder.buildProjection(history: history, todayKey: "2026-06-07")
        let summary = SolarProductionAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Today"))
        XCTAssertTrue(summary.contains("Daily Avg"))
        XCTAssertTrue(summary.contains("30-Day Total"))
        XCTAssertTrue(summary.contains("kWh"))
    }

    func testSummaryFallsBackWhenNoData() {
        XCTAssertEqual(SolarProductionAccessibility.summary(for: .empty), "No solar data")
    }

    func testStatAccessibilityTextJoinsParts() {
        let stat = SolarStat(id: "today", label: "Today", value: "8.0", unit: "kWh")
        XCTAssertEqual(stat.accessibilityText, "Today 8.0 kWh")
        let noUnit = SolarStat(id: "x", label: "Daily Avg", value: "5.0")
        XCTAssertEqual(noUnit.accessibilityText, "Daily Avg 5.0")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySolarProductionTelemetry: SolarProductionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
