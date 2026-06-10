//
//  ChargingTelemetrySection.Tests.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  Unit coverage for the ChargingTelemetrySection surface:
//    • Adapter (`ChargingTelemetrySectionProjection` + `ChargingTelemetrySectionFormat`)
//      — the eight tiles in source order, the SI distance/speed conversion (metric +
//      imperial), the metres-per-hour ÷3600 charge-rate step, the per-field em-dash
//      fallbacks, the battery "%" no-space rule, the precision resolution (default vs
//      user override), and the verbatim raw-W/raw-Wh parity quirks.
//    • State holder (`ChargingTelemetrySectionModel`) — phase across loading / data /
//      empty / error, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once + re-arm), and offline keeping cached tiles.
//    • Accessibility — the section summary + the per-tile VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection + formatting

@MainActor final class ChargingTelemetrySectionProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private let full = ChargingTelemetrySectionData(
        chargerPowerW: 11000,
        chargerVoltage: 232.4,
        chargerActualCurrent: 47.8,
        chargeEnergyAddedWh: 18450,
        chargingState: "Charging",
        batteryLevel: 72,
        rangeAddedMetersPerHour: 48280,
        rangeAddedMeters: 32180
    )

    private func metricPrefs(_ precision: Int? = nil) -> ChargingTelemetrySectionUnitPrefs {
        ChargingTelemetrySectionUnitPrefs(
            distance: .km,
            speed: .kmh,
            localeIdentifier: "en_US_POSIX",
            decimalPrecision: precision
        )
    }

    private func imperialPrefs(_ precision: Int? = nil) -> ChargingTelemetrySectionUnitPrefs {
        ChargingTelemetrySectionUnitPrefs(
            distance: .mi,
            speed: .mph,
            localeIdentifier: "en_US_POSIX",
            decimalPrecision: precision
        )
    }

    func testMetricOrderMatchesWebSource() {
        let metrics = ChargingTelemetrySectionProjection.metrics(from: full, prefs: metricPrefs())
        XCTAssertEqual(
            metrics.map(\.kind),
            [.chargerPower, .voltage, .current, .energyAdded, .chargingState, .batteryLevel, .chargeRate, .rangeAdded]
        )
    }

    func testMetricFormattingMetric() {
        let metrics = ChargingTelemetrySectionProjection.metrics(from: full, prefs: metricPrefs())
        let byKind = Dictionary(uniqueKeysWithValues: metrics.map { ($0.kind, $0.value) })
        // Verbatim parity: raw watts with a "kW" suffix; raw watt-hours with "kWh".
        XCTAssertEqual(byKind[.chargerPower], "11,000.00 kW")
        XCTAssertEqual(byKind[.voltage], "232.40 V")
        XCTAssertEqual(byKind[.current], "47.80 A")
        XCTAssertEqual(byKind[.energyAdded], "18,450.00 kWh")
        XCTAssertEqual(byKind[.chargingState], "Charging")
        // Battery level appends "%" with no separating space.
        XCTAssertEqual(byKind[.batteryLevel], "72.00%")
        // Charge rate: 48,280 m/h ÷ 3600 → m/s → km/h (precision 0).
        XCTAssertEqual(byKind[.chargeRate], "48 km/h")
        // Range added: 32,180 m → km (precision 1).
        XCTAssertEqual(byKind[.rangeAdded], "32.2 km")
    }

    func testMetricFormattingImperial() {
        let metrics = ChargingTelemetrySectionProjection.metrics(from: full, prefs: imperialPrefs())
        let byKind = Dictionary(uniqueKeysWithValues: metrics.map { ($0.kind, $0.value) })
        // Charge rate: 48,280 m/h ÷ 3600 → m/s → mph (precision 0).
        XCTAssertEqual(byKind[.chargeRate], "30 mph")
        // Range added: 32,180 m → mi (precision 1).
        XCTAssertEqual(byKind[.rangeAdded], "20.0 mi")
        // Scalar tiles are unit-system invariant (raw value + scientific suffix).
        XCTAssertEqual(byKind[.chargerPower], "11,000.00 kW")
        XCTAssertEqual(byKind[.voltage], "232.40 V")
    }

    func testMissingFieldsRenderEmDash() {
        let metrics = ChargingTelemetrySectionProjection.metrics(
            from: ChargingTelemetrySectionData(),
            prefs: metricPrefs()
        )
        XCTAssertEqual(metrics.count, 8)
        XCTAssertTrue(metrics.allSatisfy { $0.value == "—" })
    }

    func testChargingStateNilFallsBackToDash() {
        let data = ChargingTelemetrySectionData(chargingState: nil)
        let metrics = ChargingTelemetrySectionProjection.metrics(from: data, prefs: metricPrefs())
        XCTAssertEqual(metrics.first { $0.kind == .chargingState }?.value, "—")
    }

    func testUserPrecisionOverrideAppliesToEveryQuantity() {
        let metrics = ChargingTelemetrySectionProjection.metrics(from: full, prefs: metricPrefs(0))
        let byKind = Dictionary(uniqueKeysWithValues: metrics.map { ($0.kind, $0.value) })
        XCTAssertEqual(byKind[.chargerPower], "11,000 kW")
        XCTAssertEqual(byKind[.voltage], "232 V")
        XCTAssertEqual(byKind[.batteryLevel], "72%")
        XCTAssertEqual(byKind[.chargeRate], "48 km/h")
        XCTAssertEqual(byKind[.rangeAdded], "32 km")
    }

    func testUserPrecisionThreeDecimals() {
        let metrics = ChargingTelemetrySectionProjection.metrics(from: full, prefs: metricPrefs(3))
        let byKind = Dictionary(uniqueKeysWithValues: metrics.map { ($0.kind, $0.value) })
        XCTAssertEqual(byKind[.voltage], "232.400 V")
        XCTAssertEqual(byKind[.chargeRate], "48.280 km/h")
        XCTAssertEqual(byKind[.rangeAdded], "32.180 km")
    }

    func testNumberFormatParity() {
        XCTAssertEqual(ChargingTelemetrySectionFormat.number(1234.5, decimals: 2, locale: posix), "1,234.50")
        XCTAssertEqual(ChargingTelemetrySectionFormat.number(0, decimals: 0, locale: posix), "0")
        XCTAssertEqual(ChargingTelemetrySectionFormat.number(.nan, decimals: 2, locale: posix), "0.00")
        XCTAssertEqual(ChargingTelemetrySectionFormat.number(.infinity, decimals: 1, locale: posix), "0.0")
    }

    func testDistanceFormatterHandlesNilAndNonFinite() {
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.distance(nil, unit: .km, precision: nil, locale: posix),
            "—"
        )
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.distance(.nan, unit: .km, precision: nil, locale: posix),
            "—"
        )
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.distance(1000, unit: .km, precision: nil, locale: posix),
            "1.0 km"
        )
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.distance(1609.344, unit: .mi, precision: nil, locale: posix),
            "1.0 mi"
        )
    }

    func testSpeedFormatterHandlesNilAndNonFinite() {
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.speed(nil, unit: .kmh, precision: nil, locale: posix),
            "—"
        )
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.speed(.infinity, unit: .kmh, precision: nil, locale: posix),
            "—"
        )
        // 10 m/s → 36 km/h (precision 0).
        XCTAssertEqual(
            ChargingTelemetrySectionFormat.speed(10, unit: .kmh, precision: nil, locale: posix),
            "36 km/h"
        )
    }

    func testResolvePrecisionDefaultsAndOverrides() {
        XCTAssertEqual(ChargingTelemetrySectionFormat.resolvePrecision(nil, fallback: 1), 1)
        XCTAssertEqual(ChargingTelemetrySectionFormat.resolvePrecision(-3, fallback: 2), 2)
        XCTAssertEqual(ChargingTelemetrySectionFormat.resolvePrecision(4, fallback: 2), 4)
        XCTAssertEqual(ChargingTelemetrySectionFormat.resolvePrecision(0, fallback: 2), 0)
    }

    func testUnitPrefsFromMeasurementSystem() {
        let metric = ChargingTelemetrySectionUnitPrefs(.metric)
        XCTAssertEqual(metric.distance, .km)
        XCTAssertEqual(metric.speed, .kmh)
        let imperial = ChargingTelemetrySectionUnitPrefs(.imperial)
        XCTAssertEqual(imperial.distance, .mi)
        XCTAssertEqual(imperial.speed, .mph)
    }

    func testTintAssignment() {
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.chargerPower.tint, .green)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.energyAdded.tint, .green)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.batteryLevel.tint, .green)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.voltage.tint, .cyan)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.chargingState.tint, .cyan)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.chargeRate.tint, .cyan)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.current.tint, .purple)
        XCTAssertEqual(ChargingTelemetrySectionMetricKind.rangeAdded.tint, .purple)
    }

    func testResolvePhase() {
        XCTAssertEqual(
            ChargingTelemetrySectionProjection.resolvePhase(isLoading: true, errorMessage: nil, hasData: false),
            .loading
        )
        XCTAssertEqual(
            ChargingTelemetrySectionProjection.resolvePhase(isLoading: false, errorMessage: nil, hasData: true),
            .data
        )
        XCTAssertEqual(
            ChargingTelemetrySectionProjection.resolvePhase(isLoading: false, errorMessage: nil, hasData: false),
            .empty
        )
        XCTAssertEqual(
            ChargingTelemetrySectionProjection.resolvePhase(isLoading: true, errorMessage: "boom", hasData: true),
            .error("boom")
        )
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChargingTelemetrySectionSurface.slug, "ChargingTelemetrySection")
        XCTAssertEqual(ChargingTelemetrySection.surfaceSlug, "ChargingTelemetrySection")
    }
}

// MARK: - State holder: ChargingTelemetrySectionModel

@MainActor final class ChargingTelemetrySectionModelTests: XCTestCase {
    private let data = ChargingTelemetrySectionData(
        chargerPowerW: 7400,
        chargingState: "Charging",
        batteryLevel: 60,
        rangeAddedMeters: 12000
    )

    private func makeModel(
        initial: ChargingTelemetrySectionInput?,
        diagnostics: ChargingTelemetrySectionDiagnostics = SpyChargingTelemetrySectionDiagnostics()
    ) -> (ChargingTelemetrySectionModel, InMemoryChargingTelemetrySectionSource) {
        let source = InMemoryChargingTelemetrySectionSource(initial: initial)
        let model = ChargingTelemetrySectionModel(source: source, diagnostics: diagnostics)
        return (model, source)
    }

    func testLoadedDataProjectsEightTiles() {
        let (model, source) = makeModel(initial: ChargingTelemetrySectionInput(data: data))
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.metrics.count, 8)
        XCTAssertEqual(source.startCount, 1)
    }

    func testNilDataResolvesEmpty() {
        let (model, _) = makeModel(initial: ChargingTelemetrySectionInput(data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.metrics.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: ChargingTelemetrySectionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: ChargingTelemetrySectionInput(errorMessage: "timeout"))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyChargingTelemetrySectionDiagnostics()
        let (model, _) = makeModel(initial: nil, diagnostics: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingTelemetrySectionSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargingTelemetrySectionInput(data: data, connection: .stale))
        source.push(ChargingTelemetrySectionInput(data: data, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargingTelemetrySectionInput(data: data, connection: .stale))
        source.push(ChargingTelemetrySectionInput(data: data, connection: .live))
        source.push(ChargingTelemetrySectionInput(data: data, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTilesWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargingTelemetrySectionInput(data: data, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.metrics.count, 8)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: ChargingTelemetrySectionInput(errorMessage: "x"))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class ChargingTelemetrySectionAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummaryIncludesTitleAndTiles() {
        let metrics = ChargingTelemetrySectionProjection.metrics(
            from: ChargingTelemetrySectionData(chargerPowerW: 7400, chargingState: "Charging"),
            prefs: ChargingTelemetrySectionUnitPrefs(localeIdentifier: "en_US_POSIX")
        )
        let summary = ChargingTelemetrySectionAccessibility.sectionSummary(metrics: metrics, localize: echo)
        XCTAssertTrue(summary.contains("Charging Telemetry"))
        XCTAssertTrue(summary.contains("Charger Power 7,400.00 kW"))
        XCTAssertTrue(summary.contains("Charging State Charging"))
    }

    func testSectionSummaryTitleOnlyWhenEmpty() {
        let summary = ChargingTelemetrySectionAccessibility.sectionSummary(metrics: [], localize: echo)
        XCTAssertEqual(summary, "Charging Telemetry")
    }

    func testMetricLabel() {
        let metric = ChargingTelemetrySectionMetric(kind: .batteryLevel, value: "72%")
        XCTAssertEqual(
            ChargingTelemetrySectionAccessibility.metricLabel(metric, localize: echo),
            "Battery Level 72%"
        )
    }
}

// MARK: - Diagnostics spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyChargingTelemetrySectionDiagnostics: ChargingTelemetrySectionDiagnostics, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
