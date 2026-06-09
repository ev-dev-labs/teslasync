//
//  ChargeSessionChartWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  Unit coverage for the ChargeSessionChartWidget surface:
//    • Adapter (cached → projection) — `ChargeSessionBuilder` parity with the web
//      component's classifyChargerType / chartData / stats memos +
//      `convertEnergyFromSI` + `formatDateShort`.
//    • Formatting — `ChargeSessionFormat` parity with web `fmt`/`fmtNumber`.
//    • State holder — `ChargeSessionChartModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `charge-session-chart` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-bar value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryChargeSessionChartSource`.
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

// MARK: - Adapter: charger classification

@MainActor final class ChargeSessionClassifyTests: XCTestCase {
    func testSuperchargerBuckets() {
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "Tesla Supercharger"), .supercharger)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "Supercharger"), .supercharger)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "supercharger"), .supercharger)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "Tesla"), .supercharger)
    }

    func testDcBuckets() {
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "J1772"), .dc)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "CCS"), .dc)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "CHAdeMO"), .dc)
    }

    func testHomeBuckets() {
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: nil), .home)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: ""), .home)
        XCTAssertEqual(ChargeSessionBuilder.classify(chargerType: "<invalid>"), .home)
    }
}

// MARK: - Adapter: energy conversion + short date

@MainActor final class ChargeSessionConvertTests: XCTestCase {
    func testEnergyConverterDividesByThousand() {
        let converter = StandardChargeSessionEnergyConverter()
        XCTAssertEqual(converter.kilowattHours(fromWattHours: 47300), 47.3, accuracy: 0.0001)
        XCTAssertEqual(converter.kilowattHours(fromWattHours: 0), 0, accuracy: 0.0001)
    }

    func testEnergyConverterNonFiniteCollapsesToZero() {
        let converter = StandardChargeSessionEnergyConverter()
        XCTAssertEqual(converter.kilowattHours(fromWattHours: .nan), 0, accuracy: 0.0001)
        XCTAssertEqual(converter.kilowattHours(fromWattHours: .infinity), 0, accuracy: 0.0001)
    }

    func testShortDateMatchesWebFormat() {
        let text = ChargeSessionFormat.shortDate(
            makeDate(2026, 4, 4),
            localeIdentifier: "en_US",
            timeZoneIdentifier: "UTC"
        )
        XCTAssertEqual(text, "Apr 4")
    }
}

// MARK: - Adapter: cached DTO → projection

@MainActor final class ChargeSessionBuilderTests: XCTestCase {
    func testBuildProjectionReversesAndLabels() {
        let rows = [
            ChargeSessionDTO(id: 1, startedAt: nil, totalEnergyAddedWh: 10000, chargerType: "Supercharger"),
            ChargeSessionDTO(id: 2, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 20000, chargerType: "J1772")
        ]
        let projection = ChargeSessionBuilder.buildProjection(
            rows: rows,
            localeIdentifier: "en_US",
            timeZoneIdentifier: "UTC"
        )
        // Web `.reverse()` → the oldest (last fetched) session is leftmost.
        XCTAssertEqual(projection.bars.count, 2)
        XCTAssertEqual(projection.bars.first?.label, "Apr 4")
        XCTAssertEqual(projection.bars.first?.kind, .dc)
        XCTAssertEqual(projection.bars.first?.energy ?? 0, 20.0, accuracy: 0.0001)
        // The nil-`started_at` session keeps its pre-reverse ordinal label (web `#i+1`).
        XCTAssertEqual(projection.bars.last?.label, "#1")
        XCTAssertEqual(projection.bars.last?.kind, .supercharger)
    }

    func testBuildProjectionDerivesTotals() {
        let rows = [
            ChargeSessionDTO(id: 1, startedAt: makeDate(2026, 4, 3), totalEnergyAddedWh: 40000, chargerType: "home"),
            ChargeSessionDTO(id: 2, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 20000, chargerType: "home")
        ]
        let projection = ChargeSessionBuilder.buildProjection(rows: rows)
        XCTAssertEqual(projection.totalEnergy, 60.0, accuracy: 0.0001)
        XCTAssertEqual(projection.avgEnergy, 30.0, accuracy: 0.0001)
        XCTAssertEqual(projection.sessionCount, 2)
        XCTAssertEqual(projection.energyUnit, "kWh")
        XCTAssertTrue(projection.hasData)
    }

    func testPlotKeysAreUnique() {
        let rows = (0 ..< 6).map { index in
            ChargeSessionDTO(id: index, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 1000)
        }
        let projection = ChargeSessionBuilder.buildProjection(rows: rows)
        let keys = projection.bars.map(\.plotKey)
        XCTAssertEqual(Set(keys).count, keys.count)
    }

    func testHasDataTrueEvenWhenAllEnergyZero() {
        // Web `hasData = chartData.length > 0` — a session with 0 kWh still counts.
        let projection = ChargeSessionBuilder.buildProjection(
            rows: [ChargeSessionDTO(id: 1, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 0)]
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.totalEnergy, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.sessionCount, 1)
    }

    func testHasDataFalseWhenEmpty() {
        let projection = ChargeSessionBuilder.buildProjection(rows: [])
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.bars.isEmpty)
        XCTAssertEqual(projection.avgEnergy, 0)
    }

    func testMissingEnergyTreatedAsZero() {
        let projection = ChargeSessionBuilder.buildProjection(
            rows: [ChargeSessionDTO(id: 1, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: nil)]
        )
        XCTAssertEqual(projection.bars.first?.energy ?? -1, 0, accuracy: 0.0001)
    }
}

// MARK: - Number formatting parity (web fmt / fmtNumber)

@MainActor final class ChargeSessionFormatTests: XCTestCase {
    func testNumberKeepsRequestedDigitsAndGroups() {
        XCTAssertEqual(ChargeSessionFormat.number(47.3, decimals: 1), "47.3")
        XCTAssertEqual(ChargeSessionFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(ChargeSessionFormat.number(60, decimals: 0), "60")
    }

    func testNumberNonFiniteCollapsesToZero() {
        // Web `fmt` runs every value through `safeNumber` (non-finite → 0).
        XCTAssertEqual(ChargeSessionFormat.number(.nan, decimals: 1), "0.0")
        XCTAssertEqual(ChargeSessionFormat.number(.infinity, decimals: 0), "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargeSessionModelTests: XCTestCase {
    private func rows(_ count: Int) -> [ChargeSessionDTO] {
        (0 ..< count).map { index in
            ChargeSessionDTO(id: index, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 10000)
        }
    }

    private func makeModel(
        _ update: ChargeSessionChartUpdate,
        telemetry: ChargeSessionTelemetry = OSLogChargeSessionTelemetry()
    ) -> (ChargeSessionChartModel, InMemoryChargeSessionChartSource) {
        let source = InMemoryChargeSessionChartSource(initial: update)
        let model = ChargeSessionChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargeSessionChartUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(ChargeSessionChartUpdate(status: .loaded, rows: rows(2)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ChargeSessionChartUpdate(status: .loaded, rows: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargeSessionChartUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let (failed, _) = makeModel(
            ChargeSessionChartUpdate(status: .failed("net"), connection: .offline, rows: rows(2))
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(ChargeSessionChartUpdate(status: .loading, rows: rows(2)))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargeSessionTelemetry()
        let (model, source) = makeModel(ChargeSessionChartUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargeSessionChartWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargeSessionChartUpdate(status: .loaded, rows: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargeSessionChartUpdate(status: .loading))
        model.start()
        source.push(
            ChargeSessionChartUpdate(
                status: .loaded,
                connection: .stale,
                rows: [
                    ChargeSessionDTO(id: 1, startedAt: makeDate(2026, 4, 3), totalEnergyAddedWh: 40000),
                    ChargeSessionDTO(id: 2, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 20000)
                ],
                updatedAt: makeDate(2026, 4, 4)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.totalEnergy, 60.0, accuracy: 0.0001)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(ChargeSessionChartModel.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertFalse(ChargeSessionChartModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(ChargeSessionChartModel.isCompact(DashboardWidgetSize(cols: 2, rows: 1)))
        XCTAssertFalse(ChargeSessionChartModel.isWide(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(ChargeSessionChartModel.isWide(DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class ChargeSessionRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargeSessionChartWidget.registration
        XCTAssertEqual(registration.id, "charge-session-chart")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargeSessionChartWidget.registration
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

@MainActor final class ChargeSessionAccessibilityTests: XCTestCase {
    func testSummaryIncludesStatsAndUnit() {
        let projection = ChargeSessionBuilder.buildProjection(
            rows: [
                ChargeSessionDTO(id: 1, startedAt: makeDate(2026, 4, 3), totalEnergyAddedWh: 40000),
                ChargeSessionDTO(id: 2, startedAt: makeDate(2026, 4, 4), totalEnergyAddedWh: 20000)
            ]
        )
        let summary = ChargeSessionAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Total"))
        XCTAssertTrue(summary.contains("60"))
        XCTAssertTrue(summary.contains("Avg"))
        XCTAssertTrue(summary.contains("30"))
        XCTAssertTrue(summary.contains("Sessions"))
        XCTAssertTrue(summary.contains("kWh"))
        XCTAssertTrue(summary.contains("2"))
    }

    func testSummaryEmptyWhenNoData() {
        let summary = ChargeSessionAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No charge sessions yet")
    }

    func testBarLabelIncludesLabelEnergyAndType() {
        let bar = ChargeSessionBar(plotKey: "0000", label: "Apr 4", energy: 47.3, kind: .supercharger)
        let label = ChargeSessionAccessibility.barLabel(bar)
        XCTAssertTrue(label.contains("Apr 4"))
        XCTAssertTrue(label.contains("47.3"))
        XCTAssertTrue(label.contains("kWh"))
        XCTAssertTrue(label.contains("Supercharger"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargeSessionTelemetry: ChargeSessionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
