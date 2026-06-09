//
//  LiveMotorStatus.Tests.swift
//  TeslaSync — P4 feature view · 0157 · LiveMotorStatus (Apple)
//
//  Unit coverage for the drivetrain-health LiveMotorStatus surface:
//    • Adapter — the number / int / unit / temperature formatters (ports of numberFormat.ts
//      `fmtNumber` / `fmtInt`), the four status cards + nine inline metrics (order / ids / labels /
//      values / icons / accents incl. nil → em-dash), and the HV-isolation value guard + 4-band
//      colour ladder.
//    • State holder — `LiveMotorStatusModel.resolvePhase` across loading / empty / loaded / failed,
//      the model wiring, the P1/S11 `view.opened` telemetry, and the stale auto-refresh transition.
//    • Accessibility — the VoiceOver tile-label + combined-summary content.
//    • View — an `ImageRenderer` render smoke for every state (content / partial / empty / loading /
//      error / stale / offline).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryLiveMotorSource`, and the locale is injected for determinism.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleUnits(_ temperature: LiveMotorTemperatureUnit = .celsius) -> LiveMotorUnitPrefs {
    LiveMotorUnitPrefs(temperature: temperature, localeIdentifier: "en_US", precision: 2)
}

private func sampleReading() -> LiveMotorReading {
    LiveMotorReading(
        shiftState: "D",
        source: "telemetry",
        powerKW: 142.6,
        regenKW: 12.4,
        rpmFront: 5230,
        rpmRear: 5280,
        torqueFrontNm: 210.5,
        torqueRearNm: 198,
        motorTempCFront: 49,
        motorTempCRear: 52,
        inverterTempC: 41,
        batteryTempC: 28,
        isolationResistanceKOhm: 650
    )
}

// MARK: - Number / unit formatting (port of numberFormat.ts fmtNumber / fmtInt)

final class LiveMotorFormatTests: XCTestCase {
    func testNumberGroupsAndFixesPrecision() {
        XCTAssertEqual(LiveMotorFormat.number(1234.5, decimals: 2, locale: enUS), "1,234.50")
        XCTAssertEqual(LiveMotorFormat.number(142.6, decimals: 2, locale: enUS), "142.60")
        XCTAssertEqual(LiveMotorFormat.number(0, decimals: 2, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(LiveMotorFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(LiveMotorFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(LiveMotorFormat.number(-.infinity, decimals: 2, locale: enUS), "0.00")
    }

    func testIntIsGroupedZeroPrecision() {
        XCTAssertEqual(LiveMotorFormat.int(5230, locale: enUS), "5,230")
        XCTAssertEqual(LiveMotorFormat.withUnit(142.6, "kW", decimals: 2, locale: enUS), "142.60 kW")
    }

    func testTemperatureCelsiusIdentityAndFahrenheitConvert() {
        XCTAssertEqual(LiveMotorFormat.temperature(celsius: 49, unit: .celsius, decimals: 2, locale: enUS), "49.00 °C")
        // 49°C → 120.2°F (c * 9 / 5 + 32).
        XCTAssertEqual(
            LiveMotorFormat.temperature(celsius: 49, unit: .fahrenheit, decimals: 2, locale: enUS),
            "120.20 °F"
        )
    }

    func testTemperatureNeverDoublesDegreeSymbol() {
        let value = LiveMotorFormat.temperature(celsius: 52, unit: .celsius, decimals: 2, locale: enUS)
        XCTAssertEqual(value, "52.00 °C")
        XCTAssertFalse(value.contains("°°"))
    }
}

// MARK: - Projector: status cards (web Grid 2/sm:4)

final class LiveMotorProjectorCardTests: XCTestCase {
    func testCardOrderIdsLabelsAndAccents() {
        let cards = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).cards
        XCTAssertEqual(cards.map(\.id), ["shiftState", "power", "regen", "source"])
        XCTAssertEqual(cards.map(\.label), ["Shift State", "Power", "Regen", "Source"])
        XCTAssertEqual(cards.map(\.accent), [.cyan, .power, .success, .primary])
    }

    func testCardValuesFormatWebPipeline() {
        let cards = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).cards
        XCTAssertEqual(cards.map(\.value), ["D", "142.60 kW", "12.40 kW", "telemetry"])
    }

    func testNilFieldsRenderEmDash() {
        let cards = LiveMotorProjector.project(reading: LiveMotorReading(), units: sampleUnits()).cards
        XCTAssertEqual(cards.map(\.value), ["—", "—", "—", "—"])
    }

    func testRegenZeroIsFormattedNotEmDash() {
        // Web: regen_kw != null ? `${fmtNumber} kW` : '—' — a real 0 stays "0.00 kW".
        let reading = LiveMotorReading(regenKW: 0)
        let regen = LiveMotorProjector.project(reading: reading, units: sampleUnits()).cards[2]
        XCTAssertEqual(regen.value, "0.00 kW")
    }
}

// MARK: - Projector: inline metrics (web grid 2/sm:3/lg:4 of InlineMetric)

final class LiveMotorProjectorMetricTests: XCTestCase {
    func testMetricOrderAndIds() {
        let metrics = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).metrics
        XCTAssertEqual(metrics.map(\.id), [
            "rpmFront", "rpmRear", "torqueFront", "torqueRear",
            "motorTempFront", "motorTempRear", "inverterTemp", "batteryTemp", "isolation"
        ])
    }

    func testMetricIconsAndAccents() {
        let metrics = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).metrics
        XCTAssertEqual(metrics.map(\.systemImage), [
            "waveform.path.ecg", "waveform.path.ecg", "bolt.fill", "bolt.fill",
            "thermometer.medium", "thermometer.medium", "thermometer.medium", "thermometer.medium", "shield.fill"
        ])
        XCTAssertEqual(metrics.map(\.accent), [
            .cyan, .power, .cyan, .power, .temperature, .temperature, .warning, .success, .success
        ])
    }

    func testRpmGroupedInteger() {
        let metrics = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).metrics
        XCTAssertEqual(metrics[0].value, "5,230 RPM")
        XCTAssertEqual(metrics[1].value, "5,280 RPM")
    }

    func testTorqueAndTemperaturePrecision() {
        let metrics = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).metrics
        XCTAssertEqual(metrics[2].value, "210.50 Nm")
        XCTAssertEqual(metrics[4].value, "49.00 °C")
        XCTAssertEqual(metrics[6].value, "41.00 °C")
        XCTAssertEqual(metrics[7].value, "28.00 °C")
    }

    func testFahrenheitConversionAppliesToEveryTemperature() {
        let metrics = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits(.fahrenheit)).metrics
        XCTAssertEqual(metrics[4].value, "120.20 °F")
        XCTAssertEqual(metrics[5].value, "125.60 °F")
    }

    func testNilMetricsRenderEmDash() {
        let metrics = LiveMotorProjector.project(reading: LiveMotorReading(), units: sampleUnits()).metrics
        XCTAssertEqual(Set(metrics.map(\.value)), ["—"])
    }
}

// MARK: - HV isolation value guard + 4-band ladder (web Shield)

final class LiveMotorIsolationTests: XCTestCase {
    func testValueGuard() {
        XCTAssertEqual(LiveMotorIsolation.value(forKOhm: nil, decimals: 2, locale: enUS), "—")
        XCTAssertEqual(LiveMotorIsolation.value(forKOhm: 0, decimals: 2, locale: enUS), "—")
        XCTAssertEqual(LiveMotorIsolation.value(forKOhm: -5, decimals: 2, locale: enUS), "—")
        XCTAssertEqual(LiveMotorIsolation.value(forKOhm: 650, decimals: 2, locale: enUS), "650.00 kΩ")
    }

    func testColourLadder() {
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: nil), .muted)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 0), .muted)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: -5), .muted)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 80), .temperature)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 99.9), .temperature)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 100), .warning)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 499.9), .warning)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 500), .success)
        XCTAssertEqual(LiveMotorIsolation.accent(forKOhm: 650), .success)
    }
}

// MARK: - State holder: phase, wiring, telemetry, freshness

@MainActor
final class LiveMotorStatusModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveMotorUpdate,
        telemetry: LiveMotorTelemetry = OSLogLiveMotorTelemetry()
    ) -> (LiveMotorStatusModel, InMemoryLiveMotorSource) {
        let source = InMemoryLiveMotorSource(initial: update)
        let model = LiveMotorStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataUpdate: LiveMotorUpdate {
        LiveMotorUpdate(status: .loaded, reading: sampleReading())
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyLiveMotorTelemetry()
        let (model, source) = makeModel(dataUpdate, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.cards.count, 4)
        XCTAssertEqual(spy.surfaces, [LiveMotorStatusSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoading() {
        let (model, _) = makeModel(LiveMotorUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataUpdate)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.metrics.count, 9)
    }

    func testEmptyPushProjectsEmpty() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loading))
        model.start()
        source.push(LiveMotorUpdate(status: .empty))
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithCachedReadingStaysContent() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(LiveMotorUpdate(status: .failed("boom"), reading: sampleReading()))
        XCTAssertEqual(model.phase, .content)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, reading: sampleReading()))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, reading: sampleReading()))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveThenStaleReArmsAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, reading: sampleReading()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(LiveMotorUpdate(status: .loaded, connection: .live, reading: sampleReading()))
        XCTAssertEqual(model.connection, .live)
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, reading: sampleReading()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedReadingWithoutAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(LiveMotorUpdate(status: .loaded, connection: .offline, reading: sampleReading()))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshAndStopReArm() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(LiveMotorStatus.surfaceSlug, "LiveMotorStatus")
    }
}

// MARK: - Accessibility summary content

final class LiveMotorAccessibilityTests: XCTestCase {
    func testJoinFiltersEmptyAndTileJoinsLabelValue() {
        XCTAssertEqual(LiveMotorAccessibility.join(["Power", "", "142.60 kW"]), "Power, 142.60 kW")
        XCTAssertEqual(LiveMotorAccessibility.tile("HV Isolation", "650.00 kΩ"), "HV Isolation, 650.00 kΩ")
    }

    func testProjectionSummaryListsCardsAndMetrics() {
        let summary = LiveMotorProjector.project(reading: sampleReading(), units: sampleUnits()).accessibilitySummary
        XCTAssertTrue(summary.contains("Shift State D"))
        XCTAssertTrue(summary.contains("Power 142.60 kW"))
        XCTAssertTrue(summary.contains("Front Motor RPM 5,230 RPM"))
        XCTAssertTrue(summary.contains("HV Isolation 650.00 kΩ"))
    }
}

// MARK: - View render smoke (every state builds + renders)

@MainActor
final class LiveMotorStatusViewStateTests: XCTestCase {
    private func renderSmoke(_ update: LiveMotorUpdate, file: StaticString = #filePath, line: UInt = #line) {
        let source = InMemoryLiveMotorSource(initial: update)
        let model = LiveMotorStatusModel(source: source)
        model.start()
        let renderer = ImageRenderer(content: LiveMotorStatus(model: model).frame(width: 360, height: 720))
        XCTAssertNotNil(renderer.cgImage, file: file, line: line)
    }

    func testContentRenders() {
        renderSmoke(LiveMotorUpdate(status: .loaded, reading: sampleReading()))
    }

    func testPartialRenders() {
        renderSmoke(LiveMotorUpdate(
            status: .loaded,
            reading: LiveMotorReading(shiftState: "P", powerKW: 0, rpmFront: 0, isolationResistanceKOhm: 80)
        ))
    }

    func testEmptyRenders() {
        renderSmoke(LiveMotorUpdate(status: .empty))
    }

    func testLoadingRenders() {
        renderSmoke(LiveMotorUpdate(status: .loading))
    }

    func testErrorRenders() {
        renderSmoke(LiveMotorUpdate(status: .failed("Network request timed out")))
    }

    func testStaleRenders() {
        renderSmoke(LiveMotorUpdate(status: .loaded, connection: .stale, reading: sampleReading()))
    }

    func testOfflineRenders() {
        renderSmoke(LiveMotorUpdate(status: .loaded, connection: .offline, reading: sampleReading()))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveMotorTelemetry: LiveMotorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
