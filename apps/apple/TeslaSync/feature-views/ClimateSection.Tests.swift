//
//  ClimateSection.Tests.swift
//  TeslaSync — P4 feature view · 0291 · ClimateSection (Apple)
//
//  Unit coverage for the ClimateSection surface:
//    • Adapter — the SI °C temperature formatter (port of unitConversion.ts
//      `formatTemperature` / `convertTempFromSI`), the legacy-alias coalescing, the
//      defrost-active predicate, the eight-card projection (value + accent), and the
//      value-text resolver.
//    • State holder — `ClimateSectionProjector` phase resolution across loading / error /
//      empty / data, the `ClimateSectionModel` wiring, the stale auto-refresh, and the
//      P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile-summary content.
//    • Render — a per-state ImageRenderer smoke pass (data / loading / empty / error /
//      stale / offline) proving every state lays out.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryClimateSectionSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Temperature formatting (port of formatTemperature / convertTempFromSI)

final class ClimateSectionTemperatureFormatTests: XCTestCase {
    private let metric = ClimateSectionUnits(temperature: .celsius, locale: "en_US")
    private let imperial = ClimateSectionUnits(temperature: .fahrenheit, locale: "en_US")

    func testCelsiusIdentityAtDefaultPrecisionOne() {
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: 21.5, units: metric), "21.5°C")
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: 8, units: metric), "8.0°C")
    }

    func testFahrenheitConversion() {
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: 8, units: imperial), "46.4°F")
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: 22, units: imperial), "71.6°F")
    }

    func testNegativeCelsius() {
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: -5, units: metric), "-5.0°C")
    }

    func testGroupingSeparatorApplied() {
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: 1234.5, units: metric), "1,234.5°C")
    }

    func testPrecisionOverride() {
        let zero = ClimateSectionUnits(temperature: .celsius, precision: 0, locale: "en_US")
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: 21.4, units: zero), "21°C")
    }

    func testNilAndNonFiniteRenderEmptySentinel() {
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: nil, units: metric), "—")
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: .infinity, units: metric), "—")
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: .nan, units: metric), "—")
    }

    func testCustomEmptyDisplay() {
        let units = ClimateSectionUnits(temperature: .celsius, locale: "en_US", emptyDisplay: "N/A")
        XCTAssertEqual(ClimateSectionFormat.temperature(celsius: nil, units: units), "N/A")
    }
}

final class ClimateSectionTemperatureUnitTests: XCTestCase {
    func testFromCelsius() {
        XCTAssertEqual(ClimateSectionTemperatureUnit.celsius.fromCelsius(20), 20, accuracy: 0.0001)
        XCTAssertEqual(ClimateSectionTemperatureUnit.fahrenheit.fromCelsius(20), 68, accuracy: 0.0001)
    }

    func testSymbolAndInitFromSymbol() {
        XCTAssertEqual(ClimateSectionTemperatureUnit.celsius.symbol, "°C")
        XCTAssertEqual(ClimateSectionTemperatureUnit.fahrenheit.symbol, "°F")
        XCTAssertEqual(ClimateSectionTemperatureUnit(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(ClimateSectionTemperatureUnit(symbol: "°C"), .celsius)
        XCTAssertEqual(ClimateSectionTemperatureUnit(symbol: "?"), .celsius)
    }
}

// MARK: - Reading: legacy-alias coalescing + defrost predicate

final class ClimateSectionReadingTests: XCTestCase {
    func testLegacyAliasPreferredOverCanonical() {
        let reading = ClimateSectionReading(
            insideTempC: 21, outsideTempC: 9, driverSetpointC: 22,
            fanStatus: 2, isClimateOn: true,
            insideTemp: 20, outsideTemp: 8, driverTempSetting: 23,
            hvacFanStatus: 5, isAcOn: false
        )
        XCTAssertEqual(reading.resolvedInsideTemp, 20)
        XCTAssertEqual(reading.resolvedOutsideTemp, 8)
        XCTAssertEqual(reading.resolvedDriverSetpoint, 23)
        XCTAssertEqual(reading.resolvedFanStatus, 5)
        XCTAssertFalse(reading.resolvedClimateOn)
    }

    func testCanonicalUsedWhenAliasAbsent() {
        let reading = ClimateSectionReading(insideTempC: 21, fanStatus: 2, isClimateOn: true)
        XCTAssertEqual(reading.resolvedInsideTemp, 21)
        XCTAssertEqual(reading.resolvedFanStatus, 2)
        XCTAssertTrue(reading.resolvedClimateOn)
    }

    func testClimateOnDefaultsFalseWhenBothNil() {
        XCTAssertFalse(ClimateSectionReading().resolvedClimateOn)
    }

    func testDefrostIsActive() {
        XCTAssertTrue(ClimateSectionReading(defrostMode: "Front").defrostIsActive)
        XCTAssertFalse(ClimateSectionReading(defrostMode: "Off").defrostIsActive)
        XCTAssertFalse(ClimateSectionReading(defrostMode: nil).defrostIsActive)
    }
}

// MARK: - Projection: the eight cards (value + accent)

final class ClimateSectionProjectionTests: XCTestCase {
    private let metric = ClimateSectionUnits(temperature: .celsius, locale: "en_US")

    private func cards(_ reading: ClimateSectionReading) -> [ClimateSectionMetricKind: ClimateSectionCard] {
        let projection = ClimateSectionProjection.make(reading: reading, units: metric)
        return Dictionary(uniqueKeysWithValues: projection.cards.map { ($0.kind, $0) })
    }

    func testCardOrderMatchesWebComposition() {
        let projection = ClimateSectionProjection.make(reading: ClimateSectionReading(), units: metric)
        XCTAssertEqual(projection.cards.map(\.kind), [
            .insideTemp, .outsideTemp, .driverSetpoint, .fanSpeed,
            .seatHeaterLeft, .seatHeaterRight, .defrost, .climateOn
        ])
    }

    func testTemperatureTilesAndAccents() {
        let reading = ClimateSectionReading(insideTempC: 21.5, outsideTempC: 8, driverSetpointC: 22)
        let byKind = cards(reading)
        XCTAssertEqual(byKind[.insideTemp]?.value, .measurement("21.5°C"))
        XCTAssertEqual(byKind[.insideTemp]?.accent, .success)
        XCTAssertEqual(byKind[.outsideTemp]?.value, .measurement("8.0°C"))
        XCTAssertEqual(byKind[.outsideTemp]?.accent, .info)
        XCTAssertEqual(byKind[.driverSetpoint]?.value, .measurement("22.0°C"))
        XCTAssertEqual(byKind[.driverSetpoint]?.accent, .power)
    }

    func testFanSpeedPrefersLegacyAliasElseDash() {
        XCTAssertEqual(cards(ClimateSectionReading(fanStatus: 4))[.fanSpeed]?.value, .measurement("4"))
        let legacy = cards(ClimateSectionReading(fanStatus: 4, hvacFanStatus: 6))
        XCTAssertEqual(legacy[.fanSpeed]?.value, .measurement("6"))
        XCTAssertEqual(cards(ClimateSectionReading())[.fanSpeed]?.value, .missing)
    }

    func testSeatHeaterLevels() {
        let byKind = cards(ClimateSectionReading(seatHeaterLeft: 3, seatHeaterRight: 0))
        XCTAssertEqual(byKind[.seatHeaterLeft]?.value, .seatLevel(3))
        XCTAssertEqual(byKind[.seatHeaterRight]?.value, .seatLevel(0))
        XCTAssertEqual(byKind[.seatHeaterLeft]?.accent, .success)
        XCTAssertEqual(cards(ClimateSectionReading())[.seatHeaterLeft]?.value, .missing)
    }

    func testDefrostActiveShowsModeElseOff() {
        let active = cards(ClimateSectionReading(defrostMode: "Front"))[.defrost]
        XCTAssertEqual(active?.value, .measurement("Front"))
        XCTAssertEqual(active?.accent, .success)
        let off = cards(ClimateSectionReading(defrostMode: "Off"))[.defrost]
        XCTAssertEqual(off?.value, .onOff(false))
        XCTAssertEqual(off?.accent, .info)
    }

    func testClimateOnFlagAndAccent() {
        let on = cards(ClimateSectionReading(isClimateOn: true))[.climateOn]
        XCTAssertEqual(on?.value, .onOff(true))
        XCTAssertEqual(on?.accent, .success)
        let off = cards(ClimateSectionReading(isClimateOn: false))[.climateOn]
        XCTAssertEqual(off?.value, .onOff(false))
        XCTAssertEqual(off?.accent, .info)
    }
}

// MARK: - Value text resolver

final class ClimateSectionValueTextTests: XCTestCase {
    private func resolve(_ value: ClimateSectionValue) -> String {
        ClimateSectionValueText.resolve(value, level: "Level", on: "On", off: "Off", dash: "—")
    }

    func testResolvesEveryVariant() {
        XCTAssertEqual(resolve(.measurement("21.5°C")), "21.5°C")
        XCTAssertEqual(resolve(.missing), "—")
        XCTAssertEqual(resolve(.seatLevel(3)), "Level 3")
        XCTAssertEqual(resolve(.onOff(true)), "On")
        XCTAssertEqual(resolve(.onOff(false)), "Off")
    }
}

// MARK: - Projector: phase resolution

final class ClimateSectionProjectorTests: XCTestCase {
    func testErrorTakesPrecedenceOverData() {
        let input = ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20), errorMessage: "boom")
        XCTAssertEqual(ClimateSectionProjector.resolve(input).phase, .error("boom"))
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20), isLoading: true)
        XCTAssertEqual(ClimateSectionProjector.resolve(input).phase, .loading)
    }

    func testEmptyWhenNoReading() {
        XCTAssertEqual(ClimateSectionProjector.resolve(ClimateSectionInput()).phase, .empty)
    }

    func testDataWhenReadingPresent() {
        let input = ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20))
        let resolved = ClimateSectionProjector.resolve(input)
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.cards.count, 8)
    }

    func testEmptyErrorMessageIsNotError() {
        // An empty error string must fall through (not surface as `.error`); with no
        // reading the branch resolves to `.empty`.
        let resolved = ClimateSectionProjector.resolve(ClimateSectionInput(reading: nil, errorMessage: ""))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testPresentButEmptyReadingResolvesToData() {
        // Web `climateData ? grid : EmptyState`: a present (even all-nil) snapshot
        // renders the grid (every tile shows the em-dash), not the empty state.
        let resolved = ClimateSectionProjector.resolve(ClimateSectionInput(reading: ClimateSectionReading()))
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.cards.count, 8)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class ClimateSectionModelTests: XCTestCase {
    private func makeModel(
        _ input: ClimateSectionInput,
        telemetry: ClimateSectionTelemetry = OSLogClimateSectionTelemetry()
    ) -> (ClimateSectionModel, InMemoryClimateSectionSource) {
        let source = InMemoryClimateSectionSource(initial: input)
        let model = ClimateSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = ClimateSectionSpyTelemetry()
        let input = ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20))
        let (model, source) = makeModel(input, telemetry: spy)
        model.start()
        model.start()
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(spy.surfaces, [ClimateSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ClimateSectionInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjectionAndConnection() {
        let (model, source) = makeModel(ClimateSectionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 21), connection: .offline))
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20)))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ClimateSectionInput(reading: ClimateSectionReading(insideTempC: 20), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "no re-refresh while already stale")
    }
}

// MARK: - Accessibility summary

final class ClimateSectionAccessibilityTests: XCTestCase {
    func testTileSummaryJoinsLabelAndValue() {
        let summary = ClimateSectionAccessibility.tileSummary(label: "Inside Temp", value: "21.5°C")
        XCTAssertEqual(summary, "Inside Temp, 21.5°C")
    }

    func testTileSummaryDropsEmptyFragments() {
        let summary = ClimateSectionAccessibility.tileSummary(label: "Defrost", value: "")
        XCTAssertEqual(summary, "Defrost")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Per-state render smoke (every state lays out)

@MainActor
final class ClimateSectionRenderTests: XCTestCase {
    private func render(_ input: ClimateSectionInput) throws {
        let source = InMemoryClimateSectionSource(initial: input)
        let model = ClimateSectionModel(source: source)
        model.start()
        let view = ClimateSection(model: model).frame(width: 560, height: 360)
        let renderer = ImageRenderer(content: view)
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage)
        #endif
    }

    func testEveryStateRenders() throws {
        let reading = ClimateSectionReading(insideTempC: 21.5, fanStatus: 3, seatHeaterLeft: 2, defrostMode: "Front")
        try render(ClimateSectionInput(isLoading: true))
        try render(ClimateSectionInput(reading: reading))
        try render(ClimateSectionInput(reading: nil))
        try render(ClimateSectionInput(errorMessage: "503"))
        try render(ClimateSectionInput(reading: reading, connection: .stale))
        try render(ClimateSectionInput(reading: reading, connection: .offline))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class ClimateSectionSpyTelemetry: ClimateSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
