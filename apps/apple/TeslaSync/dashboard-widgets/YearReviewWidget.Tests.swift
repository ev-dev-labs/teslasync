//
//  YearReviewWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0118 · YearReviewWidget (Apple)
//
//  Unit coverage for the YearReviewWidget surface:
//    • Adapter (cached → projection) — `YearReviewProjector` value parity with the web widget's
//      numeric pipeline (km → mi → display unit, speed conversion, fmtNumber / fmtInt, busiest month).
//    • State holder — `YearReviewModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `year-review` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content per layout.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `YearReviewWidgetInMemoryYearReviewSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class YearReviewAdapterTests: XCTestCase {
    private let sample = YearReviewDTO(
        totalDrives: 487,
        totalDistanceKm: 18540,
        totalEnergyKwh: 3120.6,
        co2OffsetKg: 1840.2,
        totalDrivingMinutes: 21960,
        longestDriveKm: 642.8,
        fastestSpeedKmh: 168,
        monthlyStats: [
            YearReviewMonthlyStat(month: 1, drives: 28),
            YearReviewMonthlyStat(month: 6, drives: 52),
            YearReviewMonthlyStat(month: 7, drives: 61),
            YearReviewMonthlyStat(month: 8, drives: 55)
        ]
    )

    /// Pins the exact display strings the web widget produces for the km preference. The distance
    /// pipeline reproduces the source verbatim: total_distance_km * KM_TO_MI, then
    /// convertDistanceFromSI(value, 'km') = value / 1000.
    func testProjectionKilometers() {
        let units = YearReviewUnitPrefs(distance: .kilometers, speed: .kilometersPerHour)
        let projection = YearReviewProjector.project(stats: sample, units: units, year: 2026)

        XCTAssertEqual(projection.coreStats.count, 6)
        XCTAssertEqual(projection.wideStats.count, 2)
        XCTAssertEqual(projection.year, 2026)

        XCTAssertEqual(projection.coreStats[0].value, "12")
        XCTAssertEqual(projection.coreStats[0].unit, "km")
        XCTAssertEqual(projection.coreStats[1].value, "487")
        XCTAssertNil(projection.coreStats[1].unit)
        XCTAssertEqual(projection.coreStats[2].value, "3,120.6")
        XCTAssertEqual(projection.coreStats[2].unit, "kWh")
        XCTAssertEqual(projection.coreStats[3].value, "1,840")
        XCTAssertEqual(projection.coreStats[3].unit, "kg")
        XCTAssertEqual(projection.coreStats[4].value, "Jul")
        XCTAssertNil(projection.coreStats[4].unit)
        XCTAssertEqual(projection.coreStats[5].value, "0.4")
        XCTAssertEqual(projection.coreStats[5].unit, "km")

        XCTAssertEqual(projection.wideStats[0].value, "366")
        XCTAssertEqual(projection.wideStats[0].unit, "h")
        XCTAssertEqual(projection.wideStats[1].value, "376")
        XCTAssertEqual(projection.wideStats[1].unit, "km/h")

        XCTAssertEqual(projection.compactValue, "12")
        XCTAssertEqual(projection.distanceSymbol, "km")
    }

    /// Pins the mile/mph branch: convertDistanceFromSI(value, 'mi') = value / 1609.344;
    /// convertSpeedFromSI(value, 'mph') = value * 3600 / 1609.344.
    func testProjectionMiles() {
        let units = YearReviewUnitPrefs(distance: .miles, speed: .milesPerHour)
        let projection = YearReviewProjector.project(stats: sample, units: units, year: 2026)

        XCTAssertEqual(projection.coreStats[0].value, "7")
        XCTAssertEqual(projection.coreStats[0].unit, "mi")
        XCTAssertEqual(projection.coreStats[5].value, "0.2")
        XCTAssertEqual(projection.coreStats[5].unit, "mi")
        XCTAssertEqual(projection.wideStats[1].value, "234")
        XCTAssertEqual(projection.wideStats[1].unit, "mph")
        XCTAssertEqual(projection.compactValue, "7")
        XCTAssertEqual(projection.distanceSymbol, "mi")
    }

    func testBusiestMonthPicksMaxDrives() {
        let units = YearReviewUnitPrefs(distance: .kilometers)
        let projection = YearReviewProjector.project(stats: sample, units: units, year: 2026)
        XCTAssertEqual(projection.coreStats[4].value, "Jul")
    }

    /// The web `reduce` keeps the FIRST month on a tie (strict `>`).
    func testBusiestMonthTieKeepsFirst() {
        let tie = YearReviewDTO(monthlyStats: [
            YearReviewMonthlyStat(month: 3, drives: 40),
            YearReviewMonthlyStat(month: 9, drives: 40)
        ])
        let projection = YearReviewProjector.project(
            stats: tie,
            units: YearReviewUnitPrefs(distance: .kilometers),
            year: 2026
        )
        XCTAssertEqual(projection.coreStats[4].value, "Mar")
    }

    func testBusiestMonthEmptyIsPlaceholder() { // parity:allow ui
        let projection = YearReviewProjector.project(
            stats: YearReviewDTO(),
            units: YearReviewUnitPrefs(distance: .kilometers),
            year: 2026
        )
        XCTAssertEqual(projection.coreStats[4].value, "—")
    }

    func testEmptyStatsProjectToZeroes() {
        let units = YearReviewUnitPrefs(distance: .kilometers, speed: .kilometersPerHour)
        let projection = YearReviewProjector.project(stats: YearReviewDTO(), units: units, year: 2026)
        XCTAssertEqual(projection.coreStats[0].value, "0")
        XCTAssertEqual(projection.coreStats[1].value, "0")
        XCTAssertEqual(projection.coreStats[2].value, "0.0")
        XCTAssertEqual(projection.coreStats[3].value, "0")
        XCTAssertEqual(projection.coreStats[5].value, "0.0")
        XCTAssertEqual(projection.wideStats[0].value, "0")
        XCTAssertEqual(projection.wideStats[1].value, "0")
        XCTAssertEqual(projection.compactValue, "0")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(YearReviewFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(YearReviewFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(YearReviewFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(YearReviewFormat.number(-5, decimals: 0), "-5")
        XCTAssertEqual(YearReviewFormat.integer(42), "42")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertYearReviewDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(convertYearReviewSpeedFromSI(.infinity, to: .milesPerHour), 0)
        XCTAssertEqual(YearReviewFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertYearReviewDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertYearReviewDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertYearReviewDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }

    func testSpeedConversionFactors() {
        // 1 m/s = 3.6 km/h
        XCTAssertEqual(convertYearReviewSpeedFromSI(1, to: .kilometersPerHour), 3.6, accuracy: 1e-9)
        // 1 m/s = 2.236936… mph
        XCTAssertEqual(convertYearReviewSpeedFromSI(1, to: .milesPerHour), 3600.0 / 1609.344, accuracy: 1e-9)
    }

    func testNilLongestDriveTreatedAsZero() {
        let dto = YearReviewDTO(longestDriveKm: nil)
        let projection = YearReviewProjector.project(
            stats: dto,
            units: YearReviewUnitPrefs(distance: .kilometers),
            year: 2026
        )
        XCTAssertEqual(projection.coreStats[5].value, "0.0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class YearReviewPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(YearReviewModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class YearReviewModelTests: XCTestCase {
    private func makeModel(
        _ update: YearReviewUpdate,
        telemetry: YearReviewTelemetry = OSLogYearReviewTelemetry()
    ) -> (YearReviewModel, YearReviewWidgetInMemoryYearReviewSource) {
        let source = YearReviewWidgetInMemoryYearReviewSource(initial: update)
        let model = YearReviewModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(YearReviewUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(YearReviewUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(YearReviewUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let stats = YearReviewDTO(totalDrives: 5, totalDistanceKm: 100)
        let (model, _) = makeModel(YearReviewUpdate(status: .failed("net"), stats: stats))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.projection?.coreStats.count, 6)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyYearReviewTelemetry()
        let (model, source) = makeModel(YearReviewUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [YearReviewWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(YearReviewUpdate(status: .loaded, stats: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = YearReviewDTO(totalDrives: 1)
        let (model, source) = makeModel(YearReviewUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(YearReviewUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(YearReviewUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionProjectionYearAndUnitsTrackUpdates() {
        let (model, source) = makeModel(YearReviewUpdate(status: .loading, stats: nil))
        model.start()
        source.push(
            YearReviewUpdate(
                status: .loaded,
                connection: .offline,
                stats: YearReviewDTO(totalDrives: 7, totalDistanceKm: 1000),
                units: YearReviewUnitPrefs(distance: .miles, speed: .milesPerHour),
                year: 2031,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.year, 2031)
        XCTAssertEqual(model.projection?.year, 2031)
        XCTAssertFalse(model.projection?.coreStats.isEmpty ?? true)
    }
}

// MARK: - Registry parity

@MainActor final class YearReviewRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = YearReviewWidget.registration
        XCTAssertEqual(registration.id, "year-review")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(YearReviewWidget.surfaceSlug, "YearReviewWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = YearReviewWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class YearReviewAccessibilityTests: XCTestCase {
    private let projection = YearReviewProjector.project(
        stats: YearReviewDTO(
            totalDrives: 487,
            totalDistanceKm: 18540,
            totalEnergyKwh: 3120.6,
            co2OffsetKg: 1840.2,
            totalDrivingMinutes: 21960,
            longestDriveKm: 642.8,
            fastestSpeedKmh: 168,
            monthlyStats: [YearReviewMonthlyStat(month: 7, drives: 61)]
        ),
        units: YearReviewUnitPrefs(distance: .kilometers, speed: .kilometersPerHour),
        year: 2026
    )

    func testWideSummaryIncludesEveryStat() {
        let summary = YearReviewAccessibility.summary(for: projection, isWide: true)
        XCTAssertTrue(summary.contains("Year in Review 2026"))
        XCTAssertTrue(summary.contains("Total Miles 12 km"))
        XCTAssertTrue(summary.contains("Total Drives 487"))
        XCTAssertTrue(summary.contains("Energy Used 3,120.6 kWh"))
        XCTAssertTrue(summary.contains("CO₂ Saved 1,840 kg"))
        XCTAssertTrue(summary.contains("Best Month Jul"))
        XCTAssertTrue(summary.contains("Longest Drive 0.4 km"))
        XCTAssertTrue(summary.contains("Driving Time 366 h"))
        XCTAssertTrue(summary.contains("Top Speed 376 km/h"))
    }

    func testStandardSummaryOmitsWideStats() {
        let summary = YearReviewAccessibility.summary(for: projection, isWide: false)
        XCTAssertTrue(summary.contains("Total Miles 12 km"))
        XCTAssertTrue(summary.contains("Best Month Jul"))
        XCTAssertFalse(summary.contains("Driving Time"))
        XCTAssertFalse(summary.contains("Top Speed"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyYearReviewTelemetry: YearReviewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
