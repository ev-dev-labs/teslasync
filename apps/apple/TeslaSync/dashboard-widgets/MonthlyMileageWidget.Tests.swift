//
//  MonthlyMileageWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  Unit coverage for the MonthlyMileageWidget surface:
//    • Adapter (cached → projection) — `MonthlyMileageBuilder` parity with the
//      web component's chartData / totals memos + `convertDistanceFromSI`.
//    • Formatting — `MonthlyMileageFormat` parity with web `fmtInt` / `fmtNumber`.
//    • State holder — `MonthlyMileageModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `monthly-mileage` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-bar value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryMonthlyMileageSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Test fixtures

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar
}

private func makeDate(_ year: Int, _ month: Int, _ day: Int = 15) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    return utcCalendar().date(from: components) ?? Date(timeIntervalSince1970: 0)
}

private func rows(_ pairs: [(String, Double)]) -> [MileageMonthRow] {
    pairs.map { MileageMonthRow(yearMonth: $0.0, driveCount: 1, totalKm: $0.1) }
}

// MARK: - Adapter: cached DTO → projection

final class MonthlyMileageBuilderTests: XCTestCase {
    func testShortMonthFormatsKnownMonths() {
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth("2026-01"), "Jan")
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth("2026-04"), "Apr")
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth("2025-12"), "Dec")
    }

    func testShortMonthHandlesMalformedInput() {
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth("2026"), "2026")
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth("2026-13"), "2026-13")
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth("2026-00"), "2026-00")
        XCTAssertEqual(MonthlyMileageBuilder.shortMonth(""), "")
    }

    func testCurrentMonthKeyFormatsYearMonth() {
        let cal = utcCalendar()
        XCTAssertEqual(MonthlyMileageBuilder.currentMonthKey(makeDate(2026, 4, 7), calendar: cal), "2026-04")
        XCTAssertEqual(MonthlyMileageBuilder.currentMonthKey(makeDate(2025, 11, 30), calendar: cal), "2025-11")
    }

    func testBuildProjectionKeepsLastTwelveMonths() {
        let fifteen = (1 ... 15).map { (String(format: "2025-%02d", $0), Double($0 * 100)) }
        let projection = MonthlyMileageBuilder.buildProjection(
            rows: rows(fifteen),
            unit: "km",
            now: makeDate(2026, 4),
            calendar: utcCalendar()
        )
        XCTAssertEqual(projection.bars.count, 12)
        // Last 12 of 15 → months 04…15 are clipped to the trailing window.
        XCTAssertEqual(projection.bars.first?.yearMonth, "2025-04")
        XCTAssertEqual(projection.bars.last?.yearMonth, "2025-15")
    }

    func testBuildProjectionConvertsKilometresToDisplayUnit() {
        let projection = MonthlyMileageBuilder.buildProjection(
            rows: rows([("2026-03", 100)]),
            unit: "mi",
            now: makeDate(2026, 4),
            calendar: utcCalendar()
        )
        // 100 km = 100_000 m → 100_000 / 1609.344 ≈ 62.137 mi.
        XCTAssertEqual(projection.bars.first?.distance ?? 0, 62.137, accuracy: 0.01)
    }

    func testBuildProjectionKilometresPassThrough() {
        let projection = MonthlyMileageBuilder.buildProjection(
            rows: rows([("2026-03", 123.5)]),
            unit: "km",
            now: makeDate(2026, 4),
            calendar: utcCalendar()
        )
        XCTAssertEqual(projection.bars.first?.distance ?? 0, 123.5, accuracy: 0.0001)
    }

    func testBuildProjectionMarksCurrentMonthAndTotals() {
        let projection = MonthlyMileageBuilder.buildProjection(
            rows: rows([("2026-02", 200), ("2026-03", 300), ("2026-04", 150)]),
            unit: "km",
            now: makeDate(2026, 4, 9),
            calendar: utcCalendar()
        )
        XCTAssertEqual(projection.bars.filter(\.isCurrent).map(\.yearMonth), ["2026-04"])
        XCTAssertEqual(projection.currentMonthDistance, 150, accuracy: 0.0001)
        XCTAssertEqual(projection.total12mDistance, 650, accuracy: 0.0001)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.distanceUnit, "km")
    }

    func testCurrentMonthDistanceZeroWhenAbsent() {
        let projection = MonthlyMileageBuilder.buildProjection(
            rows: rows([("2026-01", 200), ("2026-02", 300)]),
            unit: "km",
            now: makeDate(2026, 4),
            calendar: utcCalendar()
        )
        XCTAssertEqual(projection.currentMonthDistance, 0)
        XCTAssertFalse(projection.bars.contains(where: \.isCurrent))
    }

    func testHasDataFalseWhenEmptyOrAllZero() {
        let empty = MonthlyMileageBuilder.buildProjection(rows: [], unit: "km")
        XCTAssertFalse(empty.hasData)
        XCTAssertTrue(empty.bars.isEmpty)

        let zero = MonthlyMileageBuilder.buildProjection(
            rows: rows([("2026-03", 0), ("2026-04", 0)]),
            unit: "km",
            now: makeDate(2026, 4),
            calendar: utcCalendar()
        )
        XCTAssertFalse(zero.hasData)
        XCTAssertEqual(zero.bars.count, 2)
    }

    func testConverterFactors() {
        let converter = StandardMileageDistanceConverter()
        XCTAssertEqual(converter.display(meters: 1000, unit: "km"), 1, accuracy: 0.0001)
        XCTAssertEqual(converter.display(meters: 1609.344, unit: "mi"), 1, accuracy: 0.0001)
        XCTAssertEqual(converter.display(meters: 0.3048, unit: "ft"), 1, accuracy: 0.0001)
        // Unknown labels fall back to kilometres (SI canonical display default).
        XCTAssertEqual(converter.display(meters: 2000, unit: "parsec"), 2, accuracy: 0.0001)
    }
}

// MARK: - Number formatting parity (web fmtInt / fmtNumber)

final class MonthlyMileageFormatTests: XCTestCase {
    func testIntRoundsAndGroups() {
        XCTAssertEqual(MonthlyMileageFormat.int(1234.6), "1,235")
        XCTAssertEqual(MonthlyMileageFormat.int(0), "0")
    }

    func testDecimalKeepsRequestedDigits() {
        XCTAssertEqual(MonthlyMileageFormat.decimal(62.137, digits: 1), "62.1")
        XCTAssertEqual(MonthlyMileageFormat.decimal(1234.56, digits: 1), "1,234.6")
    }

    func testNonFiniteRendersEmDash() {
        XCTAssertEqual(MonthlyMileageFormat.int(.nan), "—")
        XCTAssertEqual(MonthlyMileageFormat.decimal(.infinity, digits: 1), "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class MonthlyMileageModelTests: XCTestCase {
    private func makeModel(
        _ update: MonthlyMileageUpdate,
        telemetry: MonthlyMileageTelemetry = OSLogMonthlyMileageTelemetry()
    ) -> (MonthlyMileageModel, InMemoryMonthlyMileageSource) {
        let source = InMemoryMonthlyMileageSource(initial: update)
        let model = MonthlyMileageModel(
            source: source,
            telemetry: telemetry,
            now: { makeDate(2026, 4) },
            calendar: utcCalendar()
        )
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(MonthlyMileageUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(
            MonthlyMileageUpdate(status: .loaded, rows: rows([("2026-03", 120)]), distanceUnit: "km")
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(MonthlyMileageUpdate(status: .loaded, rows: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(MonthlyMileageUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let cached = rows([("2026-03", 80)])
        let (failed, _) = makeModel(
            MonthlyMileageUpdate(status: .failed("net"), connection: .offline, rows: cached, distanceUnit: "km")
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(MonthlyMileageUpdate(status: .loading, rows: cached, distanceUnit: "km"))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMonthlyMileageTelemetry()
        let (model, source) = makeModel(MonthlyMileageUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MonthlyMileageWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MonthlyMileageUpdate(status: .loaded, rows: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(MonthlyMileageUpdate(status: .loading))
        model.start()
        source.push(
            MonthlyMileageUpdate(
                status: .loaded,
                connection: .stale,
                rows: rows([("2026-02", 100), ("2026-03", 200)]),
                distanceUnit: "km",
                updatedAt: makeDate(2026, 4)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.total12mDistance, 300, accuracy: 0.0001)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(MonthlyMileageModel.isCompact(DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(MonthlyMileageModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(MonthlyMileageModel.isWide(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(MonthlyMileageModel.isWide(DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

final class MonthlyMileageRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MonthlyMileageWidget.registration
        XCTAssertEqual(registration.id, "monthly-mileage")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MonthlyMileageWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
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

final class MonthlyMileageAccessibilityTests: XCTestCase {
    func testSummaryIncludesStatsAndUnit() {
        let projection = MonthlyMileageBuilder.buildProjection(
            rows: rows([("2026-03", 300), ("2026-04", 150)]),
            unit: "km",
            now: makeDate(2026, 4),
            calendar: utcCalendar()
        )
        let summary = MonthlyMileageAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("This Month"))
        XCTAssertTrue(summary.contains("150"))
        XCTAssertTrue(summary.contains("12-Mo Total"))
        XCTAssertTrue(summary.contains("450"))
        XCTAssertTrue(summary.contains("km"))
    }

    func testSummaryEmptyWhenNoData() {
        let summary = MonthlyMileageAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No mileage data")
    }

    func testBarLabelMarksCurrentMonth() {
        let current = MileageBar(month: "Apr", yearMonth: "2026-04", distance: 150, isCurrent: true)
        let prior = MileageBar(month: "Mar", yearMonth: "2026-03", distance: 300, isCurrent: false)
        XCTAssertTrue(MonthlyMileageAccessibility.barLabel(current, unit: "km").contains("current month"))
        XCTAssertTrue(MonthlyMileageAccessibility.barLabel(prior, unit: "km").contains("Mar"))
        XCTAssertFalse(MonthlyMileageAccessibility.barLabel(prior, unit: "km").contains("current month"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMonthlyMileageTelemetry: MonthlyMileageTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
