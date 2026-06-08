//
//  DrivingSection.Tests.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  Unit coverage for the DrivingSection surface:
//    • Adapter (cached → projection) — `DrivingSectionProjector` value parity with the web source's
//      numeric pipeline (fmtNumber/fmtInt, pctChange, formatDate, the h/m driving-time split, the
//      efficiency-change trend arrow + tone, the `—` no-prior fallback, the km / Wh·km / min units).
//    • State holder — `DrivingSectionModel` phase resolution (web parent loading → error → body
//      precedence), the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Accessibility — the chart + section VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryDrivingSectionSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum DrivingSectionFixture {
    static let utc = TimeZone(identifier: "UTC")!

    static let week: [DrivingDailyDistance] = [
        DrivingDailyDistance(day: "Mon", distanceKm: 32.4),
        DrivingDailyDistance(day: "Tue", distanceKm: 18.1),
        DrivingDailyDistance(day: "Wed", distanceKm: 47.6),
        DrivingDailyDistance(day: "Thu", distanceKm: 12.0),
        DrivingDailyDistance(day: "Fri", distanceKm: 58.9),
        DrivingDailyDistance(day: "Sat", distanceKm: 73.2),
        DrivingDailyDistance(day: "Sun", distanceKm: 5.5)
    ]

    static let topDrive = DrivingTopDrive(
        startDate: "2026-04-04T14:30:00Z",
        distanceKm: 73.2,
        durationMin: 64,
        efficiencyWhKm: 168.4
    )

    /// Worsening efficiency (200 vs 160 → +25%), 268 driving minutes, 9 drives, a top drive, full week.
    static let worsening = DrivingDigestDTO(
        avgEfficiency: 200,
        prevAvgEfficiency: 160,
        totalDurationMin: 268,
        totalDrives: 9,
        topDrive: topDrive,
        dailyDistance: week
    )

    static func project(_ data: DrivingDigestDTO?) -> DrivingSectionProjection {
        DrivingSectionProjector.project(data: data, copy: .fallback, localeIdentifier: "en_US", timeZone: utc)
    }

    static func stat(_ projection: DrivingSectionProjection, _ kind: DrivingStatKind) -> DrivingSectionStat {
        projection.stats.first { $0.kind == kind }!
    }

    static func row(_ card: DrivingTopDriveCard, _ label: String) -> DrivingTopDriveRow {
        card.rows.first { $0.label == label }!
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web source)

@MainActor final class DrivingSectionAdapterTests: XCTestCase {
    func testStatsProjectionMatchesWeb() {
        let projection = DrivingSectionFixture.project(DrivingSectionFixture.worsening)
        XCTAssertEqual(projection.stats.map(\.kind), [.avgEfficiency, .totalDrivingTime, .efficiencyChange, .drives])

        // Avg efficiency: `${fmtNumber(200, 1)} Wh/km`.
        XCTAssertEqual(DrivingSectionFixture.stat(projection, .avgEfficiency).value, "200.0 Wh/km")

        // Total driving time: floor(268/60)=4 h, 268 % 60 = 28 m → "4h 28m".
        XCTAssertEqual(DrivingSectionFixture.stat(projection, .totalDrivingTime).value, "4h 28m")

        // Efficiency change: prev 160 > 0 → (200-160)/160*100 = 25.0%; worse (↑) → red/negative.
        let change = DrivingSectionFixture.stat(projection, .efficiencyChange)
        XCTAssertEqual(change.value, "25.0%")
        XCTAssertEqual(change.trend, .up)
        XCTAssertEqual(change.trendTone, .negative)

        // Drives: fmtInt(9) = "9".
        XCTAssertEqual(DrivingSectionFixture.stat(projection, .drives).value, "9")
    }

    func testImprovingEfficiencyShowsEmeraldDownArrow() {
        var data = DrivingSectionFixture.worsening
        data.avgEfficiency = 160
        data.prevAvgEfficiency = 200
        let change = DrivingSectionFixture.stat(DrivingSectionFixture.project(data), .efficiencyChange)
        // (160-200)/200*100 = -20.0% (lower is better → improving): emerald, down arrow.
        XCTAssertTrue(change.value.hasSuffix("%"))
        XCTAssertTrue(change.value.contains("20.0"))
        XCTAssertEqual(change.trend, .down)
        XCTAssertEqual(change.trendTone, .positive)
    }

    func testEfficiencyChangeNoPriorShowsEmDash() {
        var rising = DrivingSectionFixture.worsening
        rising.avgEfficiency = 150
        rising.prevAvgEfficiency = 0
        let risingStat = DrivingSectionFixture.stat(DrivingSectionFixture.project(rising), .efficiencyChange)
        // prev 0 → percent undefined ("—"); 150 > 0 (worse) → red, up arrow.
        XCTAssertEqual(risingStat.value, "—")
        XCTAssertEqual(risingStat.trend, .up)
        XCTAssertEqual(risingStat.trendTone, .negative)

        var flat = DrivingSectionFixture.worsening
        flat.avgEfficiency = 0
        flat.prevAvgEfficiency = 0
        let flatStat = DrivingSectionFixture.stat(DrivingSectionFixture.project(flat), .efficiencyChange)
        // 0 <= 0 (not worse) → emerald, down arrow; still "—" (no prior).
        XCTAssertEqual(flatStat.value, "—")
        XCTAssertEqual(flatStat.trend, .down)
        XCTAssertEqual(flatStat.trendTone, .positive)
    }

    func testTopDriveCardMatchesWeb() throws {
        let card = DrivingSectionFixture.project(DrivingSectionFixture.worsening).topDrive
        let unwrapped = try XCTUnwrap(card)
        XCTAssertEqual(unwrapped.badge, "Top Drive")
        XCTAssertEqual(DrivingSectionFixture.row(unwrapped, "Date").value, "Apr 4, 2026")
        XCTAssertEqual(DrivingSectionFixture.row(unwrapped, "Distance").value, "73.2 km")
        XCTAssertEqual(DrivingSectionFixture.row(unwrapped, "Duration").value, "64 min")
        XCTAssertEqual(DrivingSectionFixture.row(unwrapped, "Efficiency").value, "168.4 Wh/km")
    }

    func testDailyDistanceBarsProjection() {
        let projection = DrivingSectionFixture.project(DrivingSectionFixture.worsening)
        XCTAssertTrue(projection.hasDailyDistance)
        XCTAssertEqual(projection.bars.count, 7)
        XCTAssertEqual(projection.bars.first?.day, "Mon")
        XCTAssertEqual(projection.bars.first?.distanceKm, 32.4)
        XCTAssertEqual(projection.bars.first?.valueText, "32.4 km")
        XCTAssertEqual(projection.totalDistanceKm, 247.7, accuracy: 0.0001)
    }

    func testEmptyDailyDistanceAndNilTopDriveRenderInnerEmpties() {
        let data = DrivingDigestDTO(
            avgEfficiency: 0,
            prevAvgEfficiency: 0,
            totalDurationMin: 0,
            totalDrives: 0,
            topDrive: nil,
            dailyDistance: []
        )
        let projection = DrivingSectionFixture.project(data)
        XCTAssertFalse(projection.hasDailyDistance)
        XCTAssertTrue(projection.bars.isEmpty)
        XCTAssertNil(projection.topDrive)
        // Stats still render (the four tiles always exist when data resolved).
        XCTAssertEqual(projection.stats.count, 4)
    }

    func testNilDataYieldsEmptyProjection() {
        let projection = DrivingSectionFixture.project(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertTrue(projection.bars.isEmpty)
        XCTAssertTrue(projection.stats.isEmpty)
        XCTAssertNil(projection.topDrive)
    }

    func testGroupingAndZeroDuration() {
        var data = DrivingSectionFixture.worsening
        data.totalDrives = 1234
        data.totalDurationMin = 0
        let projection = DrivingSectionFixture.project(data)
        XCTAssertEqual(DrivingSectionFixture.stat(projection, .drives).value, "1,234")
        XCTAssertEqual(DrivingSectionFixture.stat(projection, .totalDrivingTime).value, "0h 0m")
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(DrivingFormat.safeNumber(.nan), 0)
        XCTAssertEqual(DrivingFormat.number(.infinity, decimals: 1), "0.0")
        let bars = DrivingSectionProjector.project(
            data: DrivingDigestDTO(dailyDistance: [DrivingDailyDistance(day: "Mon", distanceKm: .nan)]),
            copy: .fallback,
            localeIdentifier: "en_US"
        ).bars
        XCTAssertEqual(bars.first?.distanceKm, 0)
        XCTAssertEqual(bars.first?.valueText, "0.0 km")
    }

    func testPercentChangePortedFromWeb() {
        XCTAssertEqual(DrivingFormat.percentChange(current: 200, previous: 160), 25, accuracy: 0.0001)
        // previous == 0 → current > 0 ? 100 : 0.
        XCTAssertEqual(DrivingFormat.percentChange(current: 5, previous: 0), 100, accuracy: 0.0001)
        XCTAssertEqual(DrivingFormat.percentChange(current: 0, previous: 0), 0, accuracy: 0.0001)
    }

    func testFormatDateFallbackForBadInput() {
        XCTAssertEqual(DrivingFormat.date("", emDash: "—"), "—")
        XCTAssertEqual(DrivingFormat.date("not-a-date", emDash: "—"), "—")
    }

    func testCopyInjectionLocalizes() {
        let copy = DrivingSectionCopy(
            avgEfficiencyLabel: "Eficiencia media",
            topDriveBadge: "Mejor viaje",
            distanceUnit: "km"
        )
        let projection = DrivingSectionProjector.project(
            data: DrivingSectionFixture.worsening,
            copy: copy,
            localeIdentifier: "en_US",
            timeZone: DrivingSectionFixture.utc
        )
        XCTAssertEqual(DrivingSectionFixture.stat(projection, .avgEfficiency).label, "Eficiencia media")
        XCTAssertEqual(projection.topDrive?.badge, "Mejor viaje")
    }
}

// MARK: - State holder: phase resolution

@MainActor final class DrivingSectionPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        // Web parent precedence: loading and error short-circuit BEFORE the body (error wins over cache).
        XCTAssertEqual(DrivingSectionProjector.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(DrivingSectionProjector.resolvePhase(.loading, hasData: true), .loading)
        XCTAssertEqual(DrivingSectionProjector.resolvePhase(.failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(DrivingSectionProjector.resolvePhase(.failed("x"), hasData: true), .error("x"))
        XCTAssertEqual(DrivingSectionProjector.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(DrivingSectionProjector.resolvePhase(.loaded, hasData: true), .content)
    }
}

// MARK: - State holder: model wiring + telemetry

@MainActor final class DrivingSectionModelTests: XCTestCase {
    private func makeModel(
        _ update: DrivingSectionUpdate,
        telemetry: DrivingSectionTelemetry = OSLogDrivingSectionTelemetry()
    ) -> (DrivingSectionModel, InMemoryDrivingSectionSource) {
        let source = InMemoryDrivingSectionSource(initial: update)
        let model = DrivingSectionModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            locale: Locale(identifier: "en_US"),
            timeZone: DrivingSectionFixture.utc
        )
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(DrivingSectionUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.stats.count, 4)
        XCTAssertEqual(model.projection.bars.count, 7)
    }

    func testLoadedWithNilDataShowsEmpty() {
        let (model, _) = makeModel(DrivingSectionUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection, .empty)
    }

    func testFailedShowsErrorEvenWithCachedData() {
        let (model, _) = makeModel(DrivingSectionUpdate(status: .failed("boom"), data: DrivingSectionFixture.worsening))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDrivingSectionTelemetry()
        let (model, source) = makeModel(DrivingSectionUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DrivingSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DrivingSectionUpdate(status: .loaded, data: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening))
        model.start()
        XCTAssertEqual(source.refreshCount, 0) // live → no refresh

        source.push(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1) // stale → one auto-refresh

        source.push(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1) // still stale → no repeat

        source.push(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening, connection: .live))
        source.push(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2) // re-armed after going live → refresh again
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening))
        model.start()
        source.push(DrivingSectionUpdate(status: .loaded, data: DrivingSectionFixture.worsening, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DrivingSectionUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            DrivingSectionUpdate(
                status: .loaded,
                data: DrivingSectionFixture.worsening,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.stats.count, 4)
    }
}

// MARK: - Accessibility summaries

@MainActor final class DrivingSectionAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testChartSummaryWithData() {
        let projection = DrivingSectionFixture.project(DrivingSectionFixture.worsening)
        let summary = DrivingSectionAccessibility.chartSummary(for: projection, localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Daily Distance (km):"))
        XCTAssertTrue(summary.contains("7 days"))
        XCTAssertTrue(summary.contains("247.7 km"))
    }

    func testChartSummaryEmpty() {
        let projection = DrivingSectionFixture.project(DrivingDigestDTO(dailyDistance: []))
        let summary = DrivingSectionAccessibility.chartSummary(for: projection, localize: fallback)
        XCTAssertTrue(summary.contains("No driving distance data is available for this week."))
    }

    func testSectionSummaryListsEveryStat() {
        let projection = DrivingSectionFixture.project(DrivingSectionFixture.worsening)
        let summary = DrivingSectionAccessibility.sectionSummary(for: projection, localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Driving"))
        XCTAssertTrue(summary.contains("Avg Efficiency, 200.0 Wh/km"))
        XCTAssertTrue(summary.contains("Total Driving Time, 4h 28m"))
        XCTAssertTrue(summary.contains("Drives, 9"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDrivingSectionTelemetry: DrivingSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
