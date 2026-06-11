//
//  MotorSection.Tests.swift
//  TeslaSync — P4 feature view · 0293 · MotorSection (Apple)
//
//  Unit coverage for the MotorSection surface:
//    • Adapter — the `fmtNumber` / `fmtInt` ports (precision, grouping, unit suffix, em-dash)
//      and the SI °C `formatTemperature` port (`convertTempFromSI`, precision 1), the
//      `vbat_rear ?? vbat_front` coalescing, the peak-temperature `max(… , …)` + finite
//      gate, and the eight-card projection (value + accent + order).
//    • State holder — `MotorSectionProjector` phase resolution across loading / error /
//      empty / data, the `MotorSectionModel` wiring, the stale auto-refresh, and the
//      P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile-summary content.
//    • Render — a per-state ImageRenderer smoke pass (data / loading / empty / error /
//      stale / offline) proving every state lays out.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryMotorSectionSource`.
//

import SwiftUI
import XCTest

// MARK: - Number / integer formatting (fmtNumber / fmtInt parity)

final class MotorSectionNumberFormatTests: XCTestCase {
    private let units = MotorSectionUnits(temperature: .celsius, locale: "en_US")

    func testMeasurementDefaultPrecisionTwoWithUnit() {
        XCTAssertEqual(MotorSectionFormat.measurement(388.5, unit: "V", units: units), "388.50 V")
        XCTAssertEqual(MotorSectionFormat.measurement(142.5, unit: "A", units: units), "142.50 A")
        XCTAssertEqual(MotorSectionFormat.measurement(210, unit: "Nm", units: units), "210.00 Nm")
    }

    func testMeasurementGroupingSeparator() {
        XCTAssertEqual(MotorSectionFormat.measurement(1234.5, unit: "V", units: units), "1,234.50 V")
    }

    func testMeasurementNilRendersEmptySentinel() {
        XCTAssertEqual(MotorSectionFormat.measurement(nil, unit: "V", units: units), "—")
        let custom = MotorSectionUnits(temperature: .celsius, locale: "en_US", emptyDisplay: "n/a")
        XCTAssertEqual(MotorSectionFormat.measurement(nil, unit: "A", units: custom), "n/a")
    }

    func testMeasurementNonFiniteClampsToZeroLikeSafeNumber() {
        // Web `fmtNumber` runs `safeNumber` first → a non-finite present value renders 0.
        XCTAssertEqual(MotorSectionFormat.measurement(.infinity, unit: "V", units: units), "0.00 V")
        XCTAssertEqual(MotorSectionFormat.measurement(.nan, unit: "V", units: units), "0.00 V")
    }

    func testIntegerPrecisionZeroNoUnit() {
        XCTAssertEqual(MotorSectionFormat.integer(4200, units: units), "4,200")
        XCTAssertEqual(MotorSectionFormat.integer(6850, units: units), "6,850")
        XCTAssertEqual(MotorSectionFormat.integer(0, units: units), "0")
    }

    func testIntegerRoundsHalfAwayFromZero() {
        XCTAssertEqual(MotorSectionFormat.integer(12500.6, units: units), "12,501")
    }

    func testIntegerNilRendersEmptySentinel() {
        XCTAssertEqual(MotorSectionFormat.integer(nil, units: units), "—")
    }

    func testPrecisionOverrideAppliesToNumberTiles() {
        let zero = MotorSectionUnits(temperature: .celsius, decimalPrecision: 0, locale: "en_US")
        XCTAssertEqual(MotorSectionFormat.measurement(388.4, unit: "V", units: zero), "388 V")
        let three = MotorSectionUnits(temperature: .celsius, decimalPrecision: 3, locale: "en_US")
        XCTAssertEqual(MotorSectionFormat.measurement(388.4, unit: "V", units: three), "388.400 V")
    }
}

// MARK: - Temperature formatting (formatTemperature / convertTempFromSI parity)

final class MotorSectionTemperatureFormatTests: XCTestCase {
    private let metric = MotorSectionUnits(temperature: .celsius, locale: "en_US")
    private let imperial = MotorSectionUnits(temperature: .fahrenheit, locale: "en_US")

    func testCelsiusIdentityAtDefaultPrecisionOne() {
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: 78.5, units: metric), "78.5°C")
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: 64, units: metric), "64.0°C")
    }

    func testFahrenheitConversion() {
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: 78.5, units: imperial), "173.3°F")
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: 0, units: imperial), "32.0°F")
    }

    func testGroupingSeparatorApplied() {
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: 1234.5, units: metric), "1,234.5°C")
    }

    func testPrecisionOverrideSharedWithNumberTiles() {
        let three = MotorSectionUnits(temperature: .celsius, decimalPrecision: 3, locale: "en_US")
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: 78.5, units: three), "78.500°C")
    }

    func testNilAndNonFiniteRenderEmptySentinel() {
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: nil, units: metric), "—")
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: .infinity, units: metric), "—")
        XCTAssertEqual(MotorSectionFormat.temperature(celsius: .nan, units: metric), "—")
    }
}

final class MotorSectionTemperatureUnitTests: XCTestCase {
    func testFromCelsius() {
        XCTAssertEqual(MotorSectionTemperatureUnit.celsius.fromCelsius(20), 20, accuracy: 0.0001)
        XCTAssertEqual(MotorSectionTemperatureUnit.fahrenheit.fromCelsius(20), 68, accuracy: 0.0001)
    }

    func testSymbolAndInitFromSymbol() {
        XCTAssertEqual(MotorSectionTemperatureUnit.celsius.symbol, "°C")
        XCTAssertEqual(MotorSectionTemperatureUnit.fahrenheit.symbol, "°F")
        XCTAssertEqual(MotorSectionTemperatureUnit(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(MotorSectionTemperatureUnit(symbol: "°C"), .celsius)
        XCTAssertEqual(MotorSectionTemperatureUnit(symbol: "?"), .celsius)
    }
}

// MARK: - Reading: vbat coalescing + peak-temperature gate

final class MotorSectionReadingTests: XCTestCase {
    func testResolvedVbatPrefersRearOverFront() {
        XCTAssertEqual(MotorSectionReading(vbatFront: 388, vbatRear: 389).resolvedVbat, 389)
        XCTAssertEqual(MotorSectionReading(vbatFront: 388).resolvedVbat, 388)
        XCTAssertEqual(MotorSectionReading(vbatRear: 389).resolvedVbat, 389)
        XCTAssertNil(MotorSectionReading().resolvedVbat)
    }

    func testMaxMotorTempPicksHotterAndGatesNonFinite() {
        XCTAssertEqual(MotorSectionReading(motorTempCFront: 64, motorTempCRear: 78.5).maxMotorTempC, 78.5)
        XCTAssertEqual(MotorSectionReading(motorTempCFront: 90, motorTempCRear: 78.5).maxMotorTempC, 90)
        XCTAssertEqual(MotorSectionReading(motorTempCFront: 64).maxMotorTempC, 64)
        XCTAssertEqual(MotorSectionReading(motorTempCRear: 78.5).maxMotorTempC, 78.5)
        XCTAssertNil(MotorSectionReading().maxMotorTempC, "both missing → -∞ → not finite → nil")
    }
}

// MARK: - Projection: the eight cards (value + accent + order)

final class MotorSectionProjectionTests: XCTestCase {
    private let metric = MotorSectionUnits(temperature: .celsius, locale: "en_US")

    private let fullReading = MotorSectionReading(
        shiftState: "D",
        vbatFront: 388.4,
        vbatRear: 389.1,
        motorCurrentFront: 142.5,
        torqueNmFront: 210.0,
        torqueNmRear: 340.5,
        motorRpmFront: 4200,
        motorRpmRear: 6850,
        motorTempCFront: 64.0,
        motorTempCRear: 78.5
    )

    private func cards(
        _ reading: MotorSectionReading,
        _ units: MotorSectionUnits
    ) -> [MotorSectionMetricKind: MotorSectionCard] {
        let projection = MotorSectionProjection.make(reading: reading, units: units)
        return Dictionary(uniqueKeysWithValues: projection.cards.map { ($0.kind, $0) })
    }

    func testCardOrderMatchesWebComposition() {
        let projection = MotorSectionProjection.make(reading: MotorSectionReading(), units: metric)
        XCTAssertEqual(projection.cards.map(\.kind), [
            .shiftState, .packVoltage, .motorCurrentFront, .torqueFront,
            .torqueRear, .rpmFront, .rpmRear, .motorTemp
        ])
    }

    func testFullReadingValues() {
        let byKind = cards(fullReading, metric)
        XCTAssertEqual(byKind[.shiftState]?.valueText, "D")
        XCTAssertEqual(byKind[.packVoltage]?.valueText, "389.10 V", "vbat_rear preferred over front")
        XCTAssertEqual(byKind[.motorCurrentFront]?.valueText, "142.50 A")
        XCTAssertEqual(byKind[.torqueFront]?.valueText, "210.00 Nm")
        XCTAssertEqual(byKind[.torqueRear]?.valueText, "340.50 Nm")
        XCTAssertEqual(byKind[.rpmFront]?.valueText, "4,200")
        XCTAssertEqual(byKind[.rpmRear]?.valueText, "6,850")
        XCTAssertEqual(byKind[.motorTemp]?.valueText, "78.5°C", "peak of 64.0 / 78.5")
    }

    func testAccentsMatchWebColorProp() {
        let byKind = cards(fullReading, metric)
        XCTAssertEqual(byKind[.shiftState]?.accent, .info)
        XCTAssertEqual(byKind[.packVoltage]?.accent, .power)
        XCTAssertEqual(byKind[.motorCurrentFront]?.accent, .success)
        XCTAssertEqual(byKind[.torqueFront]?.accent, .info)
        XCTAssertEqual(byKind[.torqueRear]?.accent, .power)
        XCTAssertEqual(byKind[.rpmFront]?.accent, .info)
        XCTAssertEqual(byKind[.rpmRear]?.accent, .power)
        XCTAssertEqual(byKind[.motorTemp]?.accent, .success)
    }

    func testImperialPeakTemperatureConverts() {
        let imperial = MotorSectionUnits(temperature: .fahrenheit, locale: "en_US")
        XCTAssertEqual(cards(fullReading, imperial)[.motorTemp]?.valueText, "173.3°F")
    }

    func testEmptyReadingRendersEveryTileAsDash() {
        let byKind = cards(MotorSectionReading(), metric)
        XCTAssertEqual(byKind[.shiftState]?.valueText, "—")
        XCTAssertEqual(byKind[.packVoltage]?.valueText, "—")
        XCTAssertEqual(byKind[.motorCurrentFront]?.valueText, "—")
        XCTAssertEqual(byKind[.torqueFront]?.valueText, "—")
        XCTAssertEqual(byKind[.rpmFront]?.valueText, "—")
        XCTAssertEqual(byKind[.motorTemp]?.valueText, "—")
    }

    func testEmptyShiftStateStringStaysVerbatim() {
        // Web `motorData.shift_state ?? '—'`: an empty string is non-null, so it renders
        // verbatim (the dash only replaces a null).
        XCTAssertEqual(cards(MotorSectionReading(shiftState: ""), metric)[.shiftState]?.valueText, "")
    }
}

// MARK: - Projector: phase resolution

final class MotorSectionProjectorTests: XCTestCase {
    func testErrorTakesPrecedenceOverData() {
        let input = MotorSectionInput(reading: MotorSectionReading(motorRpmFront: 1), errorMessage: "boom")
        XCTAssertEqual(MotorSectionProjector.resolve(input).phase, .error("boom"))
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = MotorSectionInput(reading: MotorSectionReading(motorRpmFront: 1), isLoading: true)
        XCTAssertEqual(MotorSectionProjector.resolve(input).phase, .loading)
    }

    func testEmptyWhenNoReading() {
        XCTAssertEqual(MotorSectionProjector.resolve(MotorSectionInput()).phase, .empty)
    }

    func testDataWhenReadingPresent() {
        let resolved = MotorSectionProjector.resolve(MotorSectionInput(reading: MotorSectionReading(shiftState: "D")))
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.cards.count, 8)
    }

    func testEmptyErrorMessageIsNotError() {
        let resolved = MotorSectionProjector.resolve(MotorSectionInput(reading: nil, errorMessage: ""))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testPresentButEmptyReadingResolvesToData() {
        // Web `motorData ? grid : EmptyState`: a present (all-nil) snapshot renders the
        // grid (every tile shows the em-dash), not the empty state.
        let resolved = MotorSectionProjector.resolve(MotorSectionInput(reading: MotorSectionReading()))
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.cards.count, 8)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class MotorSectionModelTests: XCTestCase {
    private func makeModel(
        _ input: MotorSectionInput,
        telemetry: MotorSectionTelemetry = OSLogMotorSectionTelemetry()
    ) -> (MotorSectionModel, InMemoryMotorSectionSource) {
        let source = InMemoryMotorSectionSource(initial: input)
        let model = MotorSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = MotorSectionSpyTelemetry()
        let input = MotorSectionInput(reading: MotorSectionReading(shiftState: "D"))
        let (model, source) = makeModel(input, telemetry: spy)
        model.start()
        model.start()
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(spy.surfaces, [MotorSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MotorSectionInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjectionAndConnection() {
        let (model, source) = makeModel(MotorSectionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(MotorSectionInput(reading: MotorSectionReading(shiftState: "R"), connection: .offline))
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let reading = MotorSectionReading(shiftState: "D")
        let (model, source) = makeModel(MotorSectionInput(reading: reading))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(MotorSectionInput(reading: reading, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(MotorSectionInput(reading: reading, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "no re-refresh while already stale")
    }

    func testStopResetsStartedGuard() {
        let spy = MotorSectionSpyTelemetry()
        let (model, source) = makeModel(MotorSectionInput(reading: MotorSectionReading()), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces.count, 2)
    }
}

// MARK: - Accessibility summary

final class MotorSectionAccessibilityTests: XCTestCase {
    func testTileSummaryJoinsLabelAndValue() {
        XCTAssertEqual(MotorSectionAccessibility.tileSummary(label: "Front RPM", value: "4,200"), "Front RPM, 4,200")
    }

    func testTileSummaryDropsEmptyFragments() {
        let summary = MotorSectionAccessibility.tileSummary(label: "Shift State", value: "")
        XCTAssertEqual(summary, "Shift State")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Per-state render smoke (every state lays out)

@MainActor
final class MotorSectionRenderTests: XCTestCase {
    private func render(_ input: MotorSectionInput) throws {
        let source = InMemoryMotorSectionSource(initial: input)
        let model = MotorSectionModel(source: source)
        model.start()
        let view = MotorSection(model: model).frame(width: 560, height: 360)
        let renderer = ImageRenderer(content: view)
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage)
        #endif
    }

    func testEveryStateRenders() throws {
        let reading = MotorSectionReading(
            shiftState: "D",
            vbatRear: 389.1,
            motorCurrentFront: 142.5,
            torqueNmFront: 210,
            motorRpmFront: 4200,
            motorTempCRear: 78.5
        )
        try render(MotorSectionInput(isLoading: true))
        try render(MotorSectionInput(reading: reading))
        try render(MotorSectionInput(reading: nil))
        try render(MotorSectionInput(errorMessage: "503"))
        try render(MotorSectionInput(reading: reading, connection: .stale))
        try render(MotorSectionInput(reading: reading, connection: .offline))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class MotorSectionSpyTelemetry: MotorSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
