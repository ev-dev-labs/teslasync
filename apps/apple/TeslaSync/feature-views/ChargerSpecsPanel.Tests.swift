//
//  ChargerSpecsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0098 · ChargerSpecsPanel (Apple)
//
//  Unit coverage for the ChargerSpecsPanel surface:
//    • Adapter (cached → projection) — `convertEnergyFromSI(_, 'kWh')` / `convertPowerFromSI(_,
//      'kW')` (÷1000), the chart-`safe` guard, `ChargerSpecsFormat.number`, the session / energy /
//      power row strings, the metric selection (Brand average-power vs energy), the four-column
//      catalog + ordering, and the `hasData` gate (Voltage / Cable / Brand — Phase excluded),
//      all parity with the web row expression `{v.count} sessions · {showAvgPower && v.avgPower !=
//      null ? `${fmtInt(v.avgPower)} kW avg` : fmtWithUnit(v.energy, 'kWh')}`.
//    • State holder — `ChargerSpecsPanelModel` phase resolution across loading / empty / error /
//      content, the prefs-aware projection, the refresh delegation, the stale auto-refresh (once
//      per episode), the connection/fetching tracking, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver row summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryChargerSpecsSource`. String assertions check the web English
//  fallbacks (the per-surface table folds into the master catalog at integration time, so it
//  resolves to the `value:` fallback in the un-integrated bundle).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion / safe / formatting (web parity)

@MainActor
final class ChargerSpecsAdapterTests: XCTestCase {
    func testEnergyConvertsWattHoursToKilowattHours() {
        XCTAssertEqual(convertChargerEnergyToKwh(142_000), 142, accuracy: 0.0001)
        XCTAssertEqual(convertChargerEnergyToKwh(42567), 42.567, accuracy: 0.0001)
        XCTAssertEqual(convertChargerEnergyToKwh(0), 0, accuracy: 0.0001)
    }

    func testPowerConvertsWattsToKilowatts() {
        XCTAssertEqual(convertChargerPowerToKilowatts(11300), 11.3, accuracy: 0.0001)
        XCTAssertEqual(convertChargerPowerToKilowatts(78000), 78, accuracy: 0.0001)
    }

    func testNumberFormattingMatchesWebFmtNumber() {
        XCTAssertEqual(ChargerSpecsFormat.number(42.567, decimals: 2, localeIdentifier: "en_US"), "42.57")
        XCTAssertEqual(ChargerSpecsFormat.number(142, decimals: 2, localeIdentifier: "en_US"), "142.00")
        XCTAssertEqual(ChargerSpecsFormat.number(7.2, decimals: 0, localeIdentifier: "en_US"), "7")
        // Half-away-from-zero rounding parity with Intl.NumberFormat halfExpand.
        XCTAssertEqual(ChargerSpecsFormat.number(11.5, decimals: 0, localeIdentifier: "en_US"), "12")
    }

    func testNumberFormattingCollapsesNonFinite() {
        XCTAssertEqual(ChargerSpecsFormat.number(.nan, decimals: 2, localeIdentifier: "en_US"), "0.00")
        XCTAssertEqual(ChargerSpecsFormat.number(.infinity, decimals: 0, localeIdentifier: "en_US"), "0")
    }
}

// MARK: - Adapter: row strings + metric selection (web row expression)

@MainActor
final class ChargerSpecsProjectorStringTests: XCTestCase {
    private let prefs = ChargerSpecsUnitPrefs(localeIdentifier: "en_US", energyPrecision: 2)

    func testSessionsTextUsesRawCount() {
        XCTAssertEqual(ChargerSpecsProjector.sessionsText(count: 8), "8 sessions")
        XCTAssertEqual(ChargerSpecsProjector.sessionsText(count: 1234), "1234 sessions")
    }

    func testEnergyTextMatchesFmtWithUnit() {
        XCTAssertEqual(ChargerSpecsProjector.energyText(wattHours: 42567, prefs: prefs), "42.57 kWh")
        XCTAssertEqual(ChargerSpecsProjector.energyText(wattHours: 142_000, prefs: prefs), "142.00 kWh")
    }

    func testPowerTextMatchesFmtIntKilowatts() {
        XCTAssertEqual(ChargerSpecsProjector.powerText(watts: 11300, prefs: prefs), "11 kW avg")
        XCTAssertEqual(ChargerSpecsProjector.powerText(watts: 78000, prefs: prefs), "78 kW avg")
    }

    func testEnergyPrecisionHonorsPreference() {
        let onePlace = ChargerSpecsUnitPrefs(localeIdentifier: "en_US", energyPrecision: 1)
        XCTAssertEqual(ChargerSpecsProjector.energyText(wattHours: 42567, prefs: onePlace), "42.6 kWh")
    }

    func testMetricSelectsAveragePowerOnlyForBrandWithPower() {
        let withPower = ChargerSpecEntryInput(
            name: "Supercharger",
            count: 8,
            energyWattHours: 268_100,
            averagePowerWatts: 11300
        )
        // Brand column shows the average-power metric when a reading exists.
        XCTAssertEqual(ChargerSpecsProjector.metricText(for: withPower, kind: .brand, prefs: prefs), "11 kW avg")
        // Brand column with no power reading falls back to energy (web `: fmtWithUnit`).
        let noPower = ChargerSpecEntryInput(name: "AC/Home", count: 8, energyWattHours: 268_100)
        XCTAssertEqual(ChargerSpecsProjector.metricText(for: noPower, kind: .brand, prefs: prefs), "268.10 kWh")
        // Non-Brand columns always show energy even when a power reading is present.
        let cable = ChargerSpecEntryInput(name: "CCS", count: 8, energyWattHours: 120_000, averagePowerWatts: 99000)
        XCTAssertEqual(ChargerSpecsProjector.metricText(for: cable, kind: .cable, prefs: prefs), "120.00 kWh")
    }

    func testRowComposesDetailAndAccessibility() {
        let entry = ChargerSpecEntryInput(
            name: "Supercharger",
            count: 8,
            energyWattHours: 268_100,
            averagePowerWatts: 11300
        )
        let row = ChargerSpecsProjector.row(for: entry, kind: .brand, prefs: prefs)
        XCTAssertEqual(row.name, "Supercharger")
        XCTAssertEqual(row.detail, "8 sessions · 11 kW avg")
        XCTAssertEqual(row.accessibilityLabel, "Supercharger, 8 sessions · 11 kW avg")
        XCTAssertEqual(row.id, "Supercharger")
    }
}

// MARK: - Adapter: projection + column catalog (web grid)

@MainActor
final class ChargerSpecsProjectionTests: XCTestCase {
    private let prefs = ChargerSpecsUnitPrefs(localeIdentifier: "en_US", energyPrecision: 2)

    private func sampleSpecs() -> ChargerSpecsInput {
        ChargerSpecsInput(
            cable: [ChargerSpecEntryInput(name: "CCS", count: 14, energyWattHours: 312_400)],
            brand: [
                ChargerSpecEntryInput(
                    name: "Supercharger",
                    count: 11,
                    energyWattHours: 268_100,
                    averagePowerWatts: 92000
                ),
                ChargerSpecEntryInput(name: "AC/Home", count: 23, energyWattHours: 151_900, averagePowerWatts: 7000)
            ]
        )
    }

    func testColumnCatalogOrderAndIdentity() {
        let projection = ChargerSpecsProjector.project(specs: sampleSpecs(), prefs: prefs)
        XCTAssertEqual(projection.columns.count, 4)
        XCTAssertEqual(projection.columns.map(\.kind), [.voltage, .phase, .cable, .brand])
        XCTAssertEqual(projection.columns.map(\.id), ["voltage", "phase", "cable", "brand"])
    }

    func testColumnRowsPreserveInputOrder() {
        let projection = ChargerSpecsProjector.project(specs: sampleSpecs(), prefs: prefs)
        let brand = projection.columns.first { $0.kind == .brand }
        XCTAssertEqual(brand?.rows.map(\.name), ["Supercharger", "AC/Home"])
        XCTAssertEqual(brand?.rows.first?.detail, "11 sessions · 92 kW avg")
        let cable = projection.columns.first { $0.kind == .cable }
        XCTAssertEqual(cable?.rows.first?.detail, "14 sessions · 312.40 kWh")
        XCTAssertFalse(brand?.isEmpty ?? true)
    }

    func testEmptyColumnsReportEmpty() {
        let projection = ChargerSpecsProjector.project(specs: sampleSpecs(), prefs: prefs)
        let voltage = projection.columns.first { $0.kind == .voltage }
        let phase = projection.columns.first { $0.kind == .phase }
        XCTAssertTrue(voltage?.isEmpty ?? false)
        XCTAssertTrue(phase?.isEmpty ?? false)
    }

    func testHasDataWhenCableOrBrandOrVoltagePresent() {
        XCTAssertTrue(ChargerSpecsProjector.project(specs: sampleSpecs(), prefs: prefs).hasData)
        let voltageOnly = ChargerSpecsInput(voltage: [ChargerSpecEntryInput(
            name: "400 V",
            count: 3,
            energyWattHours: 40000
        )])
        XCTAssertTrue(ChargerSpecsProjector.project(specs: voltageOnly, prefs: prefs).hasData)
        let brandOnly = ChargerSpecsInput(brand: [ChargerSpecEntryInput(name: "SC", count: 3, energyWattHours: 40000)])
        XCTAssertTrue(ChargerSpecsProjector.project(specs: brandOnly, prefs: prefs).hasData)
    }

    func testHasDataExcludesPhaseColumn() {
        // Web `hasData` deliberately checks voltage/cable/brand — a Phase-only breakdown is empty.
        let phaseOnly = ChargerSpecsInput(phase: [ChargerSpecEntryInput(
            name: "3-phase",
            count: 5,
            energyWattHours: 80000
        )])
        let projection = ChargerSpecsProjector.project(specs: phaseOnly, prefs: prefs)
        XCTAssertFalse(projection.hasData)
        // …but the Phase column still renders its rows when present.
        XCTAssertEqual(projection.columns.first { $0.kind == .phase }?.rows.count, 1)
    }

    func testHasDataFalseForEmptyInput() {
        XCTAssertFalse(ChargerSpecsProjector.project(specs: ChargerSpecsInput(), prefs: prefs).hasData)
    }

    func testColumnKindMetadataMatchesWeb() {
        XCTAssertEqual(ChargerSpecsColumnKind.allCases, [.voltage, .phase, .cable, .brand])
        XCTAssertTrue(ChargerSpecsColumnKind.brand.showsAveragePower)
        XCTAssertFalse(ChargerSpecsColumnKind.cable.showsAveragePower)
        XCTAssertFalse(ChargerSpecsColumnKind.phase.countsTowardData)
        XCTAssertTrue(ChargerSpecsColumnKind.voltage.countsTowardData)
        XCTAssertEqual(ChargerSpecsColumnKind.voltage.labelFallback, "By Voltage")
        XCTAssertEqual(ChargerSpecsColumnKind.brand.emptyFallback, "No brand data")
    }
}

// MARK: - State holder: phases + projection + refresh + telemetry

@MainActor
final class ChargerSpecsModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargerSpecsUpdate,
        telemetry: ChargerSpecsTelemetry = OSLogChargerSpecsTelemetry()
    ) -> (ChargerSpecsPanelModel, InMemoryChargerSpecsSource) {
        let source = InMemoryChargerSpecsSource(initial: update)
        let model = ChargerSpecsPanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleSpecs() -> ChargerSpecsInput {
        ChargerSpecsInput(
            cable: [ChargerSpecEntryInput(name: "CCS", count: 14, energyWattHours: 312_400)],
            brand: [ChargerSpecEntryInput(
                name: "Supercharger",
                count: 11,
                energyWattHours: 268_100,
                averagePowerWatts: 92000
            )]
        )
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(ChargerSpecsPanelModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentPhase() {
        let (model, _) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: sampleSpecs()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.hasData, true)
    }

    func testEmptyWhenSpecsHaveOnlyPhase() {
        let phaseOnly = ChargerSpecsInput(phase: [ChargerSpecEntryInput(
            name: "3-phase",
            count: 5,
            energyWattHours: 80000
        )])
        let (model, _) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: phaseOnly))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyWhenNoSpecs() {
        let (model, _) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testLoadingPhases() {
        let (loading, _) = makeModel(ChargerSpecsUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (cached, _) = makeModel(ChargerSpecsUpdate(status: .loading, specs: sampleSpecs()))
        cached.start()
        XCTAssertEqual(cached.phase, .content)
    }

    func testErrorPhaseAndCachedStaysContent() {
        let (failed, _) = makeModel(ChargerSpecsUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))

        let (cached, source) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: sampleSpecs()))
        cached.start()
        source.push(ChargerSpecsUpdate(status: .failed("net"), specs: sampleSpecs()))
        XCTAssertEqual(cached.phase, .content)
    }

    func testProjectionHonorsPrecisionPreference() {
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loading))
        model.start()
        source.push(
            ChargerSpecsUpdate(
                status: .loaded,
                specs: ChargerSpecsInput(cable: [ChargerSpecEntryInput(name: "CCS", count: 2, energyWattHours: 42567)]),
                prefs: ChargerSpecsUnitPrefs(localeIdentifier: "en_US", energyPrecision: 1)
            )
        )
        let cable = model.projection?.columns.first { $0.kind == .cable }
        XCTAssertEqual(cable?.rows.first?.detail, "2 sessions · 42.6 kWh")
        XCTAssertEqual(model.prefs.energyPrecision, 1)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: sampleSpecs()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: sampleSpecs()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ChargerSpecsUpdate(status: .loaded, connection: .stale, specs: sampleSpecs()))
        source.push(ChargerSpecsUpdate(status: .loaded, connection: .stale, specs: sampleSpecs()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ChargerSpecsUpdate(status: .loaded, connection: .live, specs: sampleSpecs()))
        source.push(ChargerSpecsUpdate(status: .loaded, connection: .stale, specs: sampleSpecs()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loaded, specs: sampleSpecs()))
        model.start()
        source.push(ChargerSpecsUpdate(status: .loaded, connection: .offline, specs: sampleSpecs()))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loading))
        model.start()
        source.push(
            ChargerSpecsUpdate(
                status: .loaded,
                connection: .offline,
                isFetching: true,
                specs: sampleSpecs(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyChargerSpecsTelemetry()
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargerSpecsPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopDelegates() {
        let (model, source) = makeModel(ChargerSpecsUpdate(status: .loading))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor
final class ChargerSpecsAccessibilityTests: XCTestCase {
    func testRowSummaryComposesNameAndDetail() {
        let summary = ChargerSpecsAccessibility.rowSummary(name: "Supercharger", detail: "8 sessions · 11 kW avg")
        XCTAssertEqual(summary, "Supercharger, 8 sessions · 11 kW avg")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargerSpecsTelemetry: ChargerSpecsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
