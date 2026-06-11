//
//  ChargingTab.Tests.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  Unit coverage for the ChargingTab surface:
//    • Adapter (cached → projection) — `ChargingTabNumeric` safe / axisLabel / hourLabel,
//      `ChargingTabProjection.make` (summary cards incl. the optional-stat em-dash mapping, the
//      donut slice ordering + palette index, the start-battery bars, the hourly points), the
//      hourly dual-axis scale (plotted / trueEnergy / domain / ticks), and per-status phase
//      resolution.
//    • State holder — `ChargingTabModel` phase resolution across loading / content / error,
//      cached-stays-content on failure, resolved-empty-stays-content (cards never hidden),
//      refresh delegation, stale auto-refresh, connection tracking, and the P1/S11 `view.opened`
//      telemetry.
//    • Formatting — `DefaultChargingTabFormatting` number / int / currency (grouping, fixed
//      decimals, half-up, symbol) and the `safe` guard.
//    • Accessibility — the VoiceOver value summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryChargingTabSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared sample payload

private func sampleInput() -> ChargingTabAnalyticsInput {
    ChargingTabAnalyticsInput(
        totalSessions: 412,
        totalEnergyKwh: 8423.6,
        totalCost: 1187.42,
        powerStats: ChargingTabStatInput(avg: 32.4),
        durationStats: ChargingTabStatInput(avg: 47),
        efficiencyStats: ChargingTabStatInput(avg: 91.8),
        chargerTypes: [
            ChargingTabChargerTypeInput(type: "Supercharger", count: 184),
            ChargingTabChargerTypeInput(type: "Home (AC)", count: 142),
            ChargingTabChargerTypeInput(type: "Destination", count: 61)
        ],
        startBatteryDist: [
            ChargingTabBatteryBinInput(range: "0-10", count: 12),
            ChargingTabBatteryBinInput(range: "10-20", count: 48)
        ],
        hourlyPattern: [
            ChargingTabHourlyPointInput(hour: 20, charges: 3, energy: 18.6),
            ChargingTabHourlyPointInput(hour: 21, charges: 5, energy: 31),
            ChargingTabHourlyPointInput(hour: 22, charges: 8, energy: 49.6)
        ]
    )
}

// MARK: - Adapter: numeric helpers

@MainActor final class ChargingTabNumericTests: XCTestCase {
    func testSafeGuardsNonFinite() {
        XCTAssertEqual(ChargingTabNumeric.safe(5), 5, accuracy: 1e-9)
        XCTAssertEqual(ChargingTabNumeric.safe(nil), 0, accuracy: 1e-9)
        XCTAssertEqual(ChargingTabNumeric.safe(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(ChargingTabNumeric.safe(.infinity), 0, accuracy: 1e-9)
        XCTAssertEqual(ChargingTabNumeric.safe(-.infinity), 0, accuracy: 1e-9)
    }

    func testAxisLabelAbbreviates() {
        XCTAssertEqual(ChargingTabNumeric.axisLabel(500), "500")
        XCTAssertEqual(ChargingTabNumeric.axisLabel(1500), "1.5k")
        XCTAssertEqual(ChargingTabNumeric.axisLabel(2_000_000), "2.0M")
        XCTAssertEqual(ChargingTabNumeric.axisLabel(.nan), "—")
    }

    func testHourLabel() {
        XCTAssertEqual(ChargingTabNumeric.hourLabel(0), "0:00")
        XCTAssertEqual(ChargingTabNumeric.hourLabel(22), "22:00")
    }
}

// MARK: - Adapter: projection

@MainActor final class ChargingTabProjectionTests: XCTestCase {
    func testEmptyProjectionIsZeroSummaryNoCharts() {
        let projection = ChargingTabProjection.make(from: nil)
        XCTAssertEqual(projection.summary, .zero)
        XCTAssertNil(projection.summary.avgPower)
        XCTAssertNil(projection.summary.avgDuration)
        XCTAssertNil(projection.summary.avgEfficiency)
        XCTAssertEqual(projection.summary.sessions, 0, accuracy: 1e-9)
        XCTAssertFalse(projection.hasAnyChart)
    }

    func testSummaryMetricsProjected() {
        let projection = ChargingTabProjection.make(from: sampleInput())
        XCTAssertEqual(projection.summary.sessions, 412, accuracy: 1e-9)
        XCTAssertEqual(projection.summary.energyKwh, 8423.6, accuracy: 1e-9)
        XCTAssertEqual(projection.summary.totalCost, 1187.42, accuracy: 1e-9)
        XCTAssertEqual(projection.summary.avgPower ?? .nan, 32.4, accuracy: 1e-9)
        XCTAssertEqual(projection.summary.avgDuration ?? .nan, 47, accuracy: 1e-9)
        XCTAssertEqual(projection.summary.avgEfficiency ?? .nan, 91.8, accuracy: 1e-9)
    }

    func testAbsentStatsProjectToNilEmDash() {
        let input = ChargingTabAnalyticsInput(
            totalSessions: 10,
            totalEnergyKwh: 5,
            totalCost: 2,
            powerStats: nil,
            durationStats: nil,
            efficiencyStats: nil
        )
        let projection = ChargingTabProjection.make(from: input)
        XCTAssertNil(projection.summary.avgPower)
        XCTAssertNil(projection.summary.avgDuration)
        XCTAssertNil(projection.summary.avgEfficiency)
        // Totals still render (web `fmtInt`/`fmtNumber` of present values).
        XCTAssertEqual(projection.summary.sessions, 10, accuracy: 1e-9)
    }

    func testSafeGuardAppliesToProjectedSeries() throws {
        let input = ChargingTabAnalyticsInput(
            hourlyPattern: [ChargingTabHourlyPointInput(hour: 0, charges: .nan, energy: .infinity)]
        )
        let projection = ChargingTabProjection.make(from: input)
        let point = try XCTUnwrap(projection.hourly.first)
        XCTAssertEqual(point.charges, 0, accuracy: 1e-9)
        XCTAssertEqual(point.energy, 0, accuracy: 1e-9)
    }

    func testChargerTypeSlicesPreserveOrderAndPaletteIndex() {
        let projection = ChargingTabProjection.make(from: sampleInput())
        XCTAssertEqual(projection.chargerTypes.map(\.type), ["Supercharger", "Home (AC)", "Destination"])
        XCTAssertEqual(projection.chargerTypes[0].count, 184, accuracy: 1e-9)
        XCTAssertEqual(projection.chargerTypes[0].colorIndex, 0)
        XCTAssertEqual(projection.chargerTypes[2].colorIndex, 2)
        XCTAssertEqual(projection.chargerTypes[0].id, "0-Supercharger")
        XCTAssertTrue(projection.hasChargerTypes)
    }

    func testBatteryDistBarsPreserveOrder() {
        let projection = ChargingTabProjection.make(from: sampleInput())
        XCTAssertEqual(projection.batteryDist.map(\.range), ["0-10", "10-20"])
        XCTAssertEqual(projection.batteryDist[0].count, 12, accuracy: 1e-9)
        XCTAssertEqual(projection.batteryDist[1].count, 48, accuracy: 1e-9)
        XCTAssertEqual(projection.batteryDist[0].id, "0-0-10")
        XCTAssertTrue(projection.hasBatteryDist)
    }

    func testHourlyPointsProjected() {
        let projection = ChargingTabProjection.make(from: sampleInput())
        XCTAssertEqual(projection.hourly.map(\.hour), [20, 21, 22])
        XCTAssertEqual(projection.hourly[0].charges, 3, accuracy: 1e-9)
        XCTAssertEqual(projection.hourly[2].energy, 49.6, accuracy: 1e-9)
        XCTAssertEqual(projection.hourly[0].id, 20)
        XCTAssertTrue(projection.hasHourly)
    }

    func testHourlyDualAxisScale() {
        let projection = ChargingTabProjection.make(from: sampleInput())
        let scale = projection.hourlyScale
        XCTAssertEqual(scale.leftMax, 8, accuracy: 1e-9) // max charges
        XCTAssertEqual(scale.rightMax, 49.6, accuracy: 1e-9) // max energy
        // Energy is re-projected onto the left (charges) domain and inverts cleanly.
        XCTAssertEqual(scale.plotted(energy: 49.6), 8, accuracy: 1e-9)
        XCTAssertEqual(scale.trueEnergy(fromPlotted: 8), 49.6, accuracy: 1e-9)
        XCTAssertEqual(scale.domainUpperBound, 8.4, accuracy: 1e-9)
        XCTAssertEqual(scale.trailingTickPositions, [0, 2, 4, 6, 8])
    }

    func testEmptyHourlyScaleClampsToOne() {
        let scale = ChargingTabProjection.hourlyScale(for: [])
        XCTAssertEqual(scale.leftMax, 1, accuracy: 1e-9)
        XCTAssertEqual(scale.rightMax, 1, accuracy: 1e-9)
        XCTAssertEqual(scale.plotted(energy: 1), 1, accuracy: 1e-9)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.loading, hasLoaded: false), .loading)
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.loading, hasLoaded: true), .content)
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.loaded, hasLoaded: false), .content)
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.loaded, hasLoaded: true), .content)
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.empty, hasLoaded: false), .content)
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.failed("e"), hasLoaded: false), .error("e"))
        XCTAssertEqual(ChargingTabProjection.resolvePhase(.failed("e"), hasLoaded: true), .content)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class ChargingTabModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingTabUpdate,
        telemetry: ChargingTabTelemetry = OSLogChargingTabTelemetry()
    ) -> (ChargingTabModel, InMemoryChargingTabSource) {
        let source = InMemoryChargingTabSource(initial: update)
        let model = ChargingTabModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testInitialContentPhase() {
        let (model, _) = makeModel(ChargingTabUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasAnyChart)
        XCTAssertTrue(model.hasLoaded)
    }

    func testLoadingAndErrorPhasesWithoutPayload() {
        let (loading, _) = makeModel(ChargingTabUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)
        XCTAssertFalse(loading.hasLoaded)

        let (failed, _) = makeModel(ChargingTabUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testResolvedEmptyStaysContentSoCardsRender() {
        let (model, _) = makeModel(ChargingTabUpdate(status: .loaded, analytics: ChargingTabAnalyticsInput()))
        model.start()
        // Web parity: cards always render; the resolved-but-empty payload is content (charts empty).
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.projection.hasAnyChart)
        XCTAssertEqual(model.projection.summary.sessions, 0, accuracy: 1e-9)
        XCTAssertNil(model.projection.summary.avgPower)
    }

    func testCachedChartsStayContentWhileFailing() {
        let (model, source) = makeModel(ChargingTabUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        source.push(ChargingTabUpdate(status: .failed("net"), analytics: nil))
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasAnyChart)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(ChargingTabUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(ChargingTabUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ChargingTabUpdate(status: .loaded, analytics: sampleInput(), connection: .stale))
        source.push(ChargingTabUpdate(status: .loaded, analytics: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ChargingTabUpdate(status: .loaded, analytics: sampleInput(), connection: .live))
        source.push(ChargingTabUpdate(status: .loaded, analytics: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyChargingTabTelemetry()
        let (model, source) = makeModel(ChargingTabUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingTab.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(ChargingTabUpdate(status: .loading))
        model.start()
        source.push(
            ChargingTabUpdate(
                status: .loaded,
                analytics: sampleInput(),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Formatting (web useFormatting + numberFormat.ts)

@MainActor final class ChargingTabFormattingTests: XCTestCase {
    private let formatting = DefaultChargingTabFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    func testFormatInt() {
        XCTAssertEqual(formatting.formatInt(412), "412")
        XCTAssertEqual(formatting.formatInt(1234), "1,234")
        XCTAssertEqual(formatting.formatInt(2.5), "3") // half-up
    }

    func testFormatNumber() {
        XCTAssertEqual(formatting.formatNumber(0, decimals: 1), "0.0")
        XCTAssertEqual(formatting.formatNumber(8423.6, decimals: 1), "8,423.6")
        XCTAssertEqual(formatting.formatNumber(.nan, decimals: 1), "0.0") // safe guard
    }

    func testFormatCurrency() {
        XCTAssertEqual(formatting.formatCurrency(1187.42, decimals: 2), "$1,187.42")
        XCTAssertEqual(formatting.formatCurrency(0, decimals: 2), "$0.00")
        XCTAssertEqual(formatting.formatCurrency(5), "$5.00") // default precision 2
    }

    func testCustomCurrencySymbol() {
        let euro = DefaultChargingTabFormatting(currencySymbol: "€", localeIdentifier: "en_US")
        XCTAssertEqual(euro.formatCurrency(5, decimals: 2), "€5.00")
    }
}

// MARK: - Accessibility summaries

@MainActor final class ChargingTabAccessibilityTests: XCTestCase {
    func testSummaryCardLabel() {
        XCTAssertEqual(
            ChargingTabAccessibility.summaryCardLabel(label: "Avg Power", value: "32.4", subtitle: "kW"),
            "Avg Power: 32.4 kW"
        )
        XCTAssertEqual(
            ChargingTabAccessibility.summaryCardLabel(label: "Sessions", value: "412", subtitle: nil),
            "Sessions: 412"
        )
        XCTAssertEqual(
            ChargingTabAccessibility.summaryCardLabel(label: "Total Cost", value: "$0.00", subtitle: ""),
            "Total Cost: $0.00"
        )
    }

    func testDistributionSummary() {
        let bars = [
            ChargingTabDistributionBar(id: "0", range: "0-10", count: 12),
            ChargingTabDistributionBar(id: "1", range: "10-20", count: 48)
        ]
        XCTAssertEqual(
            ChargingTabAccessibility.distributionSummary(
                bars: bars,
                rangesNoun: "ranges",
                totalNoun: "sessions",
                emptyFallback: "No data"
            ),
            "2 ranges, 60 sessions"
        )
        XCTAssertEqual(
            ChargingTabAccessibility.distributionSummary(
                bars: [],
                rangesNoun: "ranges",
                totalNoun: "sessions",
                emptyFallback: "No data"
            ),
            "No data"
        )
    }

    func testChargerTypesSummary() {
        let slices = [
            ChargingTabChargerTypeSlice(type: "Supercharger", count: 184, colorIndex: 0),
            ChargingTabChargerTypeSlice(type: "Home (AC)", count: 142, colorIndex: 1),
            ChargingTabChargerTypeSlice(type: "Destination", count: 61, colorIndex: 2)
        ]
        XCTAssertEqual(
            ChargingTabAccessibility.chargerTypesSummary(
                slices: slices,
                typesNoun: "charger types",
                totalNoun: "sessions",
                emptyFallback: "No data",
                formatInt: { String(Int($0)) }
            ),
            "3 charger types, 387 sessions"
        )
        XCTAssertEqual(
            ChargingTabAccessibility.chargerTypesSummary(
                slices: [],
                typesNoun: "charger types",
                totalNoun: "sessions",
                emptyFallback: "No data",
                formatInt: { String(Int($0)) }
            ),
            "No data"
        )
    }

    func testCountSummary() {
        XCTAssertEqual(ChargingTabAccessibility.countSummary(3, noun: "hours", emptyFallback: "No data"), "3 hours")
        XCTAssertEqual(ChargingTabAccessibility.countSummary(0, noun: "hours", emptyFallback: "No data"), "No data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingTabTelemetry: ChargingTabTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
