//
//  EnergySummaryPanel.Tests.swift
//  TeslaSync — P4 feature view · 0142 · EnergySummaryPanel (Apple)
//
//  Unit coverage for the EnergySummaryPanel surface:
//    • Adapter — the number / energy-ladder / efficiency-conversion / battery-delta /
//      range formatters (port of numberFormat.ts + the web cell expressions), the
//      distance-preference mapping, and the six-up metrics builder (cached → projection).
//    • State holder — `EnergySummaryProjection` across loading / empty / error / data,
//      plus the `EnergySummaryModel` wiring, the P1/S11 `view.opened` telemetry, and
//      the stale auto-refresh transition.
//    • Accessibility — the VoiceOver metric label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryEnergySummarySource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private let sampleDrive = EnergySummaryInputData(
    energyWh: 18450,
    regenWh: 3260,
    consumptionWhKm: 168,
    startRange: 412,
    endRange: 298,
    startBatteryPct: 86,
    endBatteryPct: 61
)

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtWithUnit)

@MainActor
final class EnergySummaryFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(EnergySummaryFormat.number(18450, locale: enUS), "18,450.00")
        XCTAssertEqual(EnergySummaryFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(EnergySummaryFormat.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(EnergySummaryFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(EnergySummaryFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(EnergySummaryFormat.number(-.infinity, locale: enUS), "0.00")
    }

    func testWithUnitSpacesValueAndUnit() {
        XCTAssertEqual(EnergySummaryFormat.withUnit(168, "Wh/km", locale: enUS), "168.00 Wh/km")
        XCTAssertEqual(EnergySummaryFormat.withUnit(0, "Wh", locale: enUS), "0.00 Wh")
    }

    func testPlainHasNoGroupingAndTrimsTrailingZeros() {
        XCTAssertEqual(EnergySummaryFormat.plain(25, locale: enUS), "25")
        XCTAssertEqual(EnergySummaryFormat.plain(25.5, locale: enUS), "25.5")
        XCTAssertEqual(EnergySummaryFormat.plain(1234, locale: enUS), "1234")
        XCTAssertEqual(EnergySummaryFormat.plain(.nan, locale: enUS), "0")
    }
}

// MARK: - Energy ladder (web `value > 1000 ? kWh : Wh`)

@MainActor
final class EnergySummaryFormatEnergyTests: XCTestCase {
    func testAtOrBelowThresholdStaysWattHours() {
        XCTAssertEqual(EnergySummaryFormat.energy(1000, locale: enUS), "1,000.00 Wh")
        XCTAssertEqual(EnergySummaryFormat.energy(999.5, locale: enUS), "999.50 Wh")
        XCTAssertEqual(EnergySummaryFormat.energy(0, locale: enUS), "0.00 Wh")
    }

    func testAboveThresholdScalesToKilowattHours() {
        XCTAssertEqual(EnergySummaryFormat.energy(1000.01, locale: enUS), "1.00 kWh")
        XCTAssertEqual(EnergySummaryFormat.energy(1500, locale: enUS), "1.50 kWh")
        XCTAssertEqual(EnergySummaryFormat.energy(18450, locale: enUS), "18.45 kWh")
    }

    func testNetCellUsesEnergyMinusRegen() {
        XCTAssertEqual(
            EnergySummaryFormat.netCell(energyWh: 18450, regenWh: 3260, locale: enUS),
            "15.19 kWh"
        )
        // Net that lands at/under the ladder threshold stays in watt-hours.
        XCTAssertEqual(EnergySummaryFormat.netCell(energyWh: 900, regenWh: 100, locale: enUS), "800.00 Wh")
    }
}

// MARK: - Efficiency (web `whPerKm × factor` + Wh/km|Wh/mi, em-dash when not positive)

@MainActor
final class EnergySummaryFormatEfficiencyTests: XCTestCase {
    func testMetricKeepsWattHoursPerKilometre() {
        XCTAssertEqual(
            EnergySummaryFormat.efficiencyCell(consumptionWhKm: 168, unit: .km, locale: enUS),
            "168.00 Wh/km"
        )
    }

    func testImperialConvertsToWattHoursPerMile() {
        // 168 × 1.609344 = 270.369792 → 270.37 Wh/mi at precision 2.
        XCTAssertEqual(
            EnergySummaryFormat.efficiencyCell(consumptionWhKm: 168, unit: .mi, locale: enUS),
            "270.37 Wh/mi"
        )
    }

    func testNonPositiveConsumptionFallsBackToDash() {
        XCTAssertEqual(EnergySummaryFormat.efficiencyCell(consumptionWhKm: 0, unit: .km, locale: enUS), "—")
        XCTAssertEqual(EnergySummaryFormat.efficiencyCell(consumptionWhKm: -5, unit: .mi, locale: enUS), "—")
    }
}

// MARK: - Battery used (web `${start - end}%` + `${start ?? '?'}% → ${end ?? '?'}%`)

@MainActor
final class EnergySummaryFormatBatteryTests: XCTestCase {
    func testDeltaAndDetailWhenBothPresent() {
        XCTAssertEqual(EnergySummaryFormat.batteryUsedValue(start: 86, end: 61, locale: enUS), "25%")
        XCTAssertEqual(EnergySummaryFormat.batteryUsedDetail(start: 86, end: 61, locale: enUS), "86% → 61%")
    }

    func testFractionalDeltaUsesPlainNumber() {
        XCTAssertEqual(EnergySummaryFormat.batteryUsedValue(start: 80.5, end: 60, locale: enUS), "20.5%")
    }

    func testValueDashesWhenEitherEndpointMissing() {
        XCTAssertEqual(EnergySummaryFormat.batteryUsedValue(start: nil, end: 61, locale: enUS), "—")
        XCTAssertEqual(EnergySummaryFormat.batteryUsedValue(start: 86, end: nil, locale: enUS), "—")
        XCTAssertEqual(EnergySummaryFormat.batteryUsedValue(start: nil, end: nil, locale: enUS), "—")
    }

    func testDetailUsesQuestionMarkForMissingEndpoints() {
        XCTAssertEqual(EnergySummaryFormat.batteryUsedDetail(start: nil, end: 61, locale: enUS), "?% → 61%")
        XCTAssertEqual(EnergySummaryFormat.batteryUsedDetail(start: 86, end: nil, locale: enUS), "86% → ?%")
        XCTAssertEqual(EnergySummaryFormat.batteryUsedDetail(start: nil, end: nil, locale: enUS), "?% → ?%")
    }
}

// MARK: - Range used (web `fmtWithUnit(start - end, distanceUnit)`, em-dash when missing)

@MainActor
final class EnergySummaryFormatRangeTests: XCTestCase {
    func testMetricAndImperialUnitsAndDelta() {
        XCTAssertEqual(
            EnergySummaryFormat.rangeUsedCell(start: 412, end: 298, unit: .km, locale: enUS),
            "114.00 km"
        )
        XCTAssertEqual(
            EnergySummaryFormat.rangeUsedCell(start: 412, end: 298, unit: .mi, locale: enUS),
            "114.00 mi"
        )
    }

    func testDashesWhenEitherEndpointMissing() {
        XCTAssertEqual(EnergySummaryFormat.rangeUsedCell(start: nil, end: 298, unit: .km, locale: enUS), "—")
        XCTAssertEqual(EnergySummaryFormat.rangeUsedCell(start: 412, end: nil, unit: .km, locale: enUS), "—")
    }
}

// MARK: - Distance preference (web `useUnits().unitPrefs.distance`)

@MainActor
final class EnergySummaryDistanceUnitTests: XCTestCase {
    func testMetricMapsToKilometres() {
        let unit = EnergySummaryDistanceUnit(.metric)
        XCTAssertEqual(unit, .km)
        XCTAssertEqual(unit.distanceLabel, "km")
        XCTAssertEqual(unit.efficiencyLabel, "Wh/km")
        XCTAssertEqual(unit.efficiencyFactor, 1, accuracy: 1e-9)
    }

    func testImperialMapsToMiles() {
        let unit = EnergySummaryDistanceUnit(.imperial)
        XCTAssertEqual(unit, .mi)
        XCTAssertEqual(unit.distanceLabel, "mi")
        XCTAssertEqual(unit.efficiencyLabel, "Wh/mi")
        XCTAssertEqual(unit.efficiencyFactor, 1.609344, accuracy: 1e-9)
    }
}

// MARK: - Metrics builder (cached → projection)

@MainActor
final class EnergySummaryMetricsBuilderTests: XCTestCase {
    func testBuildsSixCellsInSourceOrderWithMetricUnits() {
        let metrics = EnergySummaryMetricsBuilder.metrics(for: sampleDrive, unit: .km, locale: enUS)
        XCTAssertEqual(metrics.map(\.id), ["consumed", "recovered", "net", "efficiency", "battery", "range"])
        XCTAssertEqual(metrics.map(\.value), [
            "18.45 kWh",
            "3.26 kWh",
            "15.19 kWh",
            "168.00 Wh/km",
            "25%",
            "114.00 km"
        ])
        XCTAssertEqual(metrics.map(\.tint), [.energy, .recovered, .net, .efficiency, .battery, .range])
    }

    func testBatteryCellCarriesDetailSubLine() throws {
        let metrics = EnergySummaryMetricsBuilder.metrics(for: sampleDrive, unit: .km, locale: enUS)
        let battery = try XCTUnwrap(metrics.first { $0.id == "battery" })
        XCTAssertEqual(battery.detail, "86% → 61%")
        // Non-battery cells carry no sub-line.
        XCTAssertNil(metrics.first { $0.id == "consumed" }?.detail)
    }

    func testImperialConvertsEfficiencyAndRangeUnits() {
        let metrics = EnergySummaryMetricsBuilder.metrics(for: sampleDrive, unit: .mi, locale: enUS)
        XCTAssertEqual(metrics.first { $0.id == "efficiency" }?.value, "270.37 Wh/mi")
        XCTAssertEqual(metrics.first { $0.id == "range" }?.value, "114.00 mi")
    }

    func testEmDashFallbacksForMissingInputs() {
        let sparse = EnergySummaryInputData(
            energyWh: 0,
            regenWh: 0,
            consumptionWhKm: 0,
            startRange: nil,
            endRange: nil,
            startBatteryPct: nil,
            endBatteryPct: nil
        )
        let metrics = EnergySummaryMetricsBuilder.metrics(for: sparse, unit: .km, locale: enUS)
        XCTAssertEqual(metrics.first { $0.id == "efficiency" }?.value, "—")
        XCTAssertEqual(metrics.first { $0.id == "battery" }?.value, "—")
        XCTAssertEqual(metrics.first { $0.id == "range" }?.value, "—")
        // Energy cells still render (web shows "0.00 Wh" rather than a dash).
        XCTAssertEqual(metrics.first { $0.id == "consumed" }?.value, "0.00 Wh")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor
final class EnergySummaryProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = EnergySummaryProjection.resolve(
            EnergySummaryInput(data: sampleDrive, errorMessage: "boom"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.metrics.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = EnergySummaryProjection.resolve(EnergySummaryInput(isLoading: true), locale: enUS)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.metrics.isEmpty)
    }

    func testEmptyWhenResolvedWithNoSnapshot() {
        let resolved = EnergySummaryProjection.resolve(EnergySummaryInput(data: nil), locale: enUS)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.metrics.isEmpty)
    }

    func testDataResolvesSixMetricsAndPropagatesUnit() {
        let metric = EnergySummaryProjection.resolve(
            EnergySummaryInput(data: sampleDrive, measurementSystem: .metric),
            locale: enUS
        )
        XCTAssertEqual(metric.phase, .data)
        XCTAssertEqual(metric.metrics.count, 6)
        XCTAssertEqual(metric.distanceUnit, .km)

        let imperial = EnergySummaryProjection.resolve(
            EnergySummaryInput(data: sampleDrive, measurementSystem: .imperial),
            locale: enUS
        )
        XCTAssertEqual(imperial.distanceUnit, .mi)
        XCTAssertEqual(imperial.metrics.first { $0.id == "range" }?.value, "114.00 mi")
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class EnergySummaryModelTests: XCTestCase {
    private func makeModel(
        _ input: EnergySummaryInput,
        telemetry: EnergySummaryTelemetry = OSLogEnergySummaryTelemetry()
    ) -> (EnergySummaryModel, InMemoryEnergySummarySource) {
        let source = InMemoryEnergySummarySource(initial: input)
        let model = EnergySummaryModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private var dataInput: EnergySummaryInput {
        EnergySummaryInput(data: sampleDrive)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyEnergySummaryTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.metrics.count, 6)
        XCTAssertEqual(spy.surfaces, [EnergySummaryPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(EnergySummaryInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.metrics.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(EnergySummaryInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.metrics.count, 6)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(EnergySummaryInput(data: sampleDrive, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(EnergySummaryInput(data: sampleDrive, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(EnergySummaryInput(data: sampleDrive, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(EnergySummaryPanel.surfaceSlug, "EnergySummaryPanel")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class EnergySummaryAccessibilityTests: XCTestCase {
    func testMetricLabelJoinsLabelAndValue() {
        XCTAssertEqual(
            EnergySummaryAccessibility.metricLabel(label: "Energy Consumed", value: "18.45 kWh"),
            "Energy Consumed: 18.45 kWh"
        )
    }

    func testMetricLabelAppendsDetailWhenPresent() {
        XCTAssertEqual(
            EnergySummaryAccessibility.metricLabel(label: "Battery Used", value: "25%", detail: "86% → 61%"),
            "Battery Used: 25%, 86% → 61%"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEnergySummaryTelemetry: EnergySummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
