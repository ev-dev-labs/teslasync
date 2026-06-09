//
//  ChargeHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  Unit coverage for the ChargeHistoryWidget surface:
//    • Adapter (cached → projection) — `ChargeHistoryBuilder` parity with the web
//      component's chartData (map/reverse) + stats (total/avg) memos +
//      `convertEnergyFromSI`, including the `hasData = chartData.length > 1` gate.
//    • Formatting — `ChargeHistoryFormat` parity with web `fmt`/`fmtNumber`.
//    • State holder — `ChargeHistoryChartModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `charge-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-point value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryChargeHistoryChartSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: energy conversion

@MainActor final class ChargeHistoryConvertTests: XCTestCase {
    func testEnergyConverterDividesByThousand() {
        let converter = StandardChargeHistoryEnergyConverter()
        XCTAssertEqual(converter.kilowattHours(fromWattHours: 47300), 47.3, accuracy: 0.0001)
        XCTAssertEqual(converter.kilowattHours(fromWattHours: 0), 0, accuracy: 0.0001)
    }

    func testEnergyConverterNonFiniteCollapsesToZero() {
        let converter = StandardChargeHistoryEnergyConverter()
        XCTAssertEqual(converter.kilowattHours(fromWattHours: .nan), 0, accuracy: 0.0001)
        XCTAssertEqual(converter.kilowattHours(fromWattHours: .infinity), 0, accuracy: 0.0001)
    }
}

// MARK: - Adapter: cached DTO → projection

@MainActor final class ChargeHistoryBuilderTests: XCTestCase {
    func testBuildProjectionReversesAndKeepsPreReverseIndexLabels() {
        // Web: rows.map((s, i) => ({ i: String(i), energy })).reverse()
        let rows = [
            ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 10000),
            ChargeHistorySessionDTO(id: 2, totalEnergyAddedWh: 20000)
        ]
        let projection = ChargeHistoryBuilder.buildProjection(rows: rows)
        XCTAssertEqual(projection.points.count, 2)
        // The oldest (last fetched, index "1") becomes leftmost after `.reverse()`.
        XCTAssertEqual(projection.points.first?.indexLabel, "1")
        XCTAssertEqual(projection.points.first?.energy ?? 0, 20.0, accuracy: 0.0001)
        XCTAssertEqual(projection.points.last?.indexLabel, "0")
        XCTAssertEqual(projection.points.last?.energy ?? 0, 10.0, accuracy: 0.0001)
    }

    func testBuildProjectionDerivesTotalsAndAverage() {
        let rows = [
            ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 40000),
            ChargeHistorySessionDTO(id: 2, totalEnergyAddedWh: 20000)
        ]
        let projection = ChargeHistoryBuilder.buildProjection(rows: rows)
        XCTAssertEqual(projection.totalEnergy, 60.0, accuracy: 0.0001)
        XCTAssertEqual(projection.avgEnergy, 30.0, accuracy: 0.0001)
        XCTAssertEqual(projection.energyUnit, "kWh")
        XCTAssertTrue(projection.hasData)
    }

    func testHasDataRequiresMoreThanOneSession() {
        // Web `hasData = chartData.length > 1`: a single session is NOT enough.
        XCTAssertFalse(ChargeHistoryBuilder.buildProjection(rows: []).hasData)

        let single = ChargeHistoryBuilder.buildProjection(
            rows: [ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 47300)]
        )
        XCTAssertEqual(single.points.count, 1)
        XCTAssertFalse(single.hasData)

        let pair = ChargeHistoryBuilder.buildProjection(
            rows: [
                ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 10000),
                ChargeHistorySessionDTO(id: 2, totalEnergyAddedWh: 20000)
            ]
        )
        XCTAssertTrue(pair.hasData)
    }

    func testMissingEnergyTreatedAsZero() {
        // Two rows so `hasData` is true; the nil-energy one becomes 0 kWh.
        let projection = ChargeHistoryBuilder.buildProjection(
            rows: [
                ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: nil),
                ChargeHistorySessionDTO(id: 2, totalEnergyAddedWh: 5000)
            ]
        )
        // reversed → first is index "1" (5 kWh), last is index "0" (0 kWh).
        XCTAssertEqual(projection.points.last?.indexLabel, "0")
        XCTAssertEqual(projection.points.last?.energy ?? -1, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.totalEnergy, 5.0, accuracy: 0.0001)
        XCTAssertEqual(projection.avgEnergy, 2.5, accuracy: 0.0001)
    }

    func testPlotKeysAreUniqueAndOrdered() {
        let rows = (0 ..< 6).map { ChargeHistorySessionDTO(id: $0, totalEnergyAddedWh: 1000) }
        let projection = ChargeHistoryBuilder.buildProjection(rows: rows)
        let keys = projection.points.map(\.plotKey)
        XCTAssertEqual(Set(keys).count, keys.count)
        XCTAssertEqual(keys, keys.sorted())
    }
}

// MARK: - Number formatting parity (web fmt / fmtNumber)

@MainActor final class ChargeHistoryFormatTests: XCTestCase {
    func testNumberKeepsRequestedDigitsAndGroups() {
        XCTAssertEqual(ChargeHistoryFormat.number(47.3, decimals: 1), "47.3")
        XCTAssertEqual(ChargeHistoryFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(ChargeHistoryFormat.number(60, decimals: 0), "60")
    }

    func testNumberNonFiniteCollapsesToZero() {
        XCTAssertEqual(ChargeHistoryFormat.number(.nan, decimals: 1), "0.0")
        XCTAssertEqual(ChargeHistoryFormat.number(.infinity, decimals: 0), "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargeHistoryModelTests: XCTestCase {
    private func rows(_ count: Int) -> [ChargeHistorySessionDTO] {
        (0 ..< count).map { ChargeHistorySessionDTO(id: $0, totalEnergyAddedWh: 10000) }
    }

    private func makeModel(
        _ update: ChargeHistoryChartUpdate,
        telemetry: ChargeHistoryTelemetry = OSLogChargeHistoryTelemetry()
    ) -> (ChargeHistoryChartModel, InMemoryChargeHistoryChartSource) {
        let source = InMemoryChargeHistoryChartSource(initial: update)
        let model = ChargeHistoryChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargeHistoryChartUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithTwoSessionsShowsContent() {
        let (model, _) = makeModel(ChargeHistoryChartUpdate(status: .loaded, rows: rows(2)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithSingleSessionShowsEmpty() {
        // The web `hasData > 1` gate: a single session resolves to the empty state.
        let (model, _) = makeModel(ChargeHistoryChartUpdate(status: .loaded, rows: rows(1)))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ChargeHistoryChartUpdate(status: .loaded, rows: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargeHistoryChartUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let (failed, _) = makeModel(
            ChargeHistoryChartUpdate(status: .failed("net"), connection: .offline, rows: rows(2))
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(ChargeHistoryChartUpdate(status: .loading, rows: rows(2)))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargeHistoryTelemetry()
        let (model, source) = makeModel(ChargeHistoryChartUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargeHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargeHistoryChartUpdate(status: .loaded, rows: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargeHistoryChartUpdate(status: .loading))
        model.start()
        source.push(
            ChargeHistoryChartUpdate(
                status: .loaded,
                connection: .stale,
                rows: [
                    ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 40000),
                    ChargeHistorySessionDTO(id: 2, totalEnergyAddedWh: 20000)
                ],
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.totalEnergy, 60.0, accuracy: 0.0001)
    }

    func testCompactThresholdIsColumnsOnly() {
        // Web `isCompact = size.cols <= 1` — columns only (rows are irrelevant).
        XCTAssertTrue(ChargeHistoryChartModel.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertTrue(ChargeHistoryChartModel.isCompact(DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(ChargeHistoryChartModel.isCompact(DashboardWidgetSize(cols: 2, rows: 1)))
        XCTAssertFalse(ChargeHistoryChartModel.isWide(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(ChargeHistoryChartModel.isWide(DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class ChargeHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargeHistoryWidget.registration
        XCTAssertEqual(registration.id, "charge-history")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargeHistoryWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 2)
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

@MainActor final class ChargeHistoryAccessibilityTests: XCTestCase {
    func testSummaryIncludesTotalAvgAndUnit() {
        let projection = ChargeHistoryBuilder.buildProjection(
            rows: [
                ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 40000),
                ChargeHistorySessionDTO(id: 2, totalEnergyAddedWh: 20000)
            ]
        )
        let summary = ChargeHistoryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Total"))
        XCTAssertTrue(summary.contains("60"))
        XCTAssertTrue(summary.contains("Avg"))
        XCTAssertTrue(summary.contains("30"))
        XCTAssertTrue(summary.contains("kWh"))
    }

    func testSummaryEmptyWhenTooFewSessions() {
        let summary = ChargeHistoryAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No charge sessions yet")
    }

    func testPointLabelIncludesSessionIndexEnergyAndUnit() {
        let point = ChargeHistoryPoint(plotKey: "0000", indexLabel: "3", energy: 47.3)
        let label = ChargeHistoryAccessibility.pointLabel(point, unit: "kWh")
        XCTAssertTrue(label.contains("Session"))
        XCTAssertTrue(label.contains("3"))
        XCTAssertTrue(label.contains("47.3"))
        XCTAssertTrue(label.contains("kWh"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargeHistoryTelemetry: ChargeHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
