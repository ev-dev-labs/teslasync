//
//  VehicleStatePanel.Tests.swift
//  TeslaSync — P4 feature view · 0287 · VehicleStatePanel (Apple)
//
//  Unit coverage for the VehicleStatePanel surface:
//    • Adapter / Format — the SI m/s → km/h·mph conversion, the number formatter (locale
//      grouping, half-up, non-finite guard), the count/label em-dash sentinels, the
//      turn-signal active branch, and the per-row projection (cached → projection).
//    • State holder — `VehicleStateProjector` across loading / empty / error / data, plus
//      the `VehicleStateModel` wiring, the P1/S11 `view.opened` telemetry, and the stale
//      auto-refresh transition.
//    • Accessibility / i18n — the row label composition + the value resolution facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryVehicleStateSource`, and the locale is injected
//  for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func metricUnits(precision: Int? = nil) -> VehicleStateUnits {
    VehicleStateUnits(speed: .kilometersPerHour, precision: precision, locale: "en_US")
}

private func imperialUnits(precision: Int? = nil) -> VehicleStateUnits {
    VehicleStateUnits(speed: .milesPerHour, precision: precision, locale: "en_US")
}

@MainActor
final class VehicleStatePanelTests: XCTestCase {
    // MARK: - Speed conversion (ports of convertSpeedFromSI)

    func testSpeedUnitConversionMatchesWeb() {
        // 22.352 m/s = 50 mph exactly = 80.4672 km/h.
        XCTAssertEqual(VehicleStateSpeedUnit.milesPerHour.fromMetersPerSecond(22.352), 50, accuracy: 0.0001)
        XCTAssertEqual(VehicleStateSpeedUnit.kilometersPerHour.fromMetersPerSecond(22.352), 80.4672, accuracy: 0.0001)
        XCTAssertEqual(VehicleStateSpeedUnit.kilometersPerHour.fromMetersPerSecond(0), 0, accuracy: 0.0001)
    }

    func testSpeedUnitSymbolAndInit() {
        XCTAssertEqual(VehicleStateSpeedUnit.kilometersPerHour.symbol, "km/h")
        XCTAssertEqual(VehicleStateSpeedUnit.milesPerHour.symbol, "mph")
        XCTAssertEqual(VehicleStateSpeedUnit(symbol: "mph"), .milesPerHour)
        XCTAssertEqual(VehicleStateSpeedUnit(symbol: "km/h"), .kilometersPerHour)
        XCTAssertEqual(VehicleStateSpeedUnit(symbol: "kn"), .kilometersPerHour) // default
    }

    // MARK: - Number / speed formatting (ports of numberFormat.ts + formatSpeed)

    func testNumberUsesGroupingFixedDigitsAndHalfUp() {
        XCTAssertEqual(VehicleStateFormat.number(1500, decimals: 0, locale: enUS), "1,500")
        XCTAssertEqual(VehicleStateFormat.number(80.4672, decimals: 0, locale: enUS), "80")
        XCTAssertEqual(VehicleStateFormat.number(80.5, decimals: 0, locale: enUS), "81") // half away from zero
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(VehicleStateFormat.number(.infinity, decimals: 0, locale: enUS), "0")
        XCTAssertEqual(VehicleStateFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
    }

    func testFormatSpeedDefaultsToZeroDecimalsWithUnitAndSpace() {
        XCTAssertEqual(VehicleStateFormat.speed(metersPerSecond: 22.352, units: metricUnits()), "80 km/h")
        XCTAssertEqual(VehicleStateFormat.speed(metersPerSecond: 22.352, units: imperialUnits()), "50 mph")
    }

    func testFormatSpeedHonoursPrecisionOverride() {
        XCTAssertEqual(VehicleStateFormat.speed(metersPerSecond: 22.352, units: metricUnits(precision: 1)), "80.5 km/h")
    }

    func testFormatSpeedNilIsEmptySentinel() {
        XCTAssertEqual(VehicleStateFormat.speed(metersPerSecond: nil, units: metricUnits()), "—")
        XCTAssertEqual(VehicleStateFormat.speed(metersPerSecond: .infinity, units: metricUnits()), "—")
        let custom = VehicleStateUnits(speed: .kilometersPerHour, locale: "en_US", emptyDisplay: "n/a")
        XCTAssertEqual(VehicleStateFormat.speed(metersPerSecond: nil, units: custom), "n/a")
    }

    // MARK: - Em-dash sentinels (web `(x) || '—'`)

    func testCountOrDashTreatsZeroAndNilAsDash() {
        XCTAssertEqual(VehicleStateFormat.countOrDash(nil), "—")
        XCTAssertEqual(VehicleStateFormat.countOrDash(0), "—") // JS `0 || '—'`
        XCTAssertEqual(VehicleStateFormat.countOrDash(3), "3")
        XCTAssertEqual(VehicleStateFormat.countOrDash(1500), "1500") // raw digits, no grouping
    }

    func testLabelOrDashTreatsNilAndEmptyAsDash() {
        XCTAssertEqual(VehicleStateFormat.labelOrDash(nil), "—")
        XCTAssertEqual(VehicleStateFormat.labelOrDash(""), "—")
        XCTAssertEqual(VehicleStateFormat.labelOrDash("On"), "On")
    }

    // MARK: - Turn-signal active branch (web `x && x !== 'Off'`)

    func testTurnSignalActiveBranch() {
        XCTAssertFalse(VehicleStateReading(lightsTurnSignal: nil).isTurnSignalActive)
        XCTAssertFalse(VehicleStateReading(lightsTurnSignal: "").isTurnSignalActive)
        XCTAssertFalse(VehicleStateReading(lightsTurnSignal: "Off").isTurnSignalActive)
        XCTAssertTrue(VehicleStateReading(lightsTurnSignal: "Left").isTurnSignalActive)
        XCTAssertTrue(VehicleStateReading(lightsTurnSignal: "off").isTurnSignalActive) // case-sensitive
    }

    // MARK: - Projection (cached → projection)

    func testProjectionActiveReadingValuesAndTones() {
        let reading = VehicleStateReading(
            lightsHighBeams: true,
            lightsTurnSignal: "Left",
            lightsHazards: false,
            driverSeatOccupied: true,
            pairedKeyCount: 3,
            valetMode: false,
            serviceMode: false,
            speedLimitMode: true,
            currentSpeedLimitMps: 22.352,
            centerDisplay: "On",
            homelinkDeviceCount: 2
        )
        let projection = VehicleStateProjection.make(reading: reading, units: metricUnits())

        XCTAssertEqual(projection.lights[0].value, .on)
        XCTAssertEqual(projection.lights[0].tone, .accent)
        XCTAssertEqual(projection.lights[1].value, .literal("Left"))
        XCTAssertEqual(projection.lights[1].tone, .warning)
        XCTAssertEqual(projection.lights[2].value, .off)
        XCTAssertEqual(projection.lights[2].tone, .muted)

        XCTAssertEqual(projection.driverAndKeys[0].value, .occupied)
        XCTAssertEqual(projection.driverAndKeys[0].tone, .success)
        XCTAssertEqual(projection.driverAndKeys[1].value, .literal("3"))
        XCTAssertEqual(projection.driverAndKeys[1].tone, .neutral)

        XCTAssertEqual(projection.accessModes[0].value, .off) // valet off
        XCTAssertEqual(projection.accessModes[2].value, .literal("80 km/h"))
        XCTAssertEqual(projection.accessModes[2].tone, .accent)
        XCTAssertEqual(projection.accessModes[3].value, .literal("On"))
        XCTAssertEqual(projection.accessModes[4].value, .literal("2"))
    }

    func testProjectionRestrictedReadingTones() {
        let reading = VehicleStateReading(
            lightsHazards: true,
            valetMode: true,
            serviceMode: true,
            homelinkDeviceCount: 0
        )
        let projection = VehicleStateProjection.make(reading: reading, units: imperialUnits())

        XCTAssertEqual(projection.lights[2].value, .active) // hazards
        XCTAssertEqual(projection.lights[2].tone, .danger)
        XCTAssertEqual(projection.driverAndKeys[0].value, .vacant)
        XCTAssertEqual(projection.driverAndKeys[1].value, .literal("—")) // no keys
        XCTAssertEqual(projection.accessModes[0].value, .enabled) // valet
        XCTAssertEqual(projection.accessModes[0].tone, .feature)
        XCTAssertEqual(projection.accessModes[1].value, .active) // service
        XCTAssertEqual(projection.accessModes[1].tone, .warning)
        XCTAssertEqual(projection.accessModes[2].value, .off) // speed-limit mode off
        XCTAssertEqual(projection.accessModes[2].tone, .muted)
        XCTAssertEqual(projection.accessModes[4].value, .literal("—")) // 0 homelink
    }

    func testProjectionEmptyReadingRendersEveryRow() {
        let projection = VehicleStateProjection.make(reading: VehicleStateReading(), units: metricUnits())
        XCTAssertEqual(projection.allRows.count, 10)
        XCTAssertEqual(projection.lights[0].value, .off)
        XCTAssertEqual(projection.driverAndKeys[1].value, .literal("—"))
        XCTAssertEqual(projection.accessModes[3].value, .literal("—"))
    }

    // MARK: - Projector (loading / empty / error / data precedence)

    func testProjectorErrorTakesPrecedence() {
        let input = VehicleStatePanelInput(reading: VehicleStateReading(lightsHighBeams: true), errorMessage: "boom")
        guard case let .error(message) = VehicleStateProjector.resolve(input).phase else {
            return XCTFail("expected .error")
        }
        XCTAssertEqual(message, "boom")
    }

    func testProjectorLoadingWhenFetching() {
        let input = VehicleStatePanelInput(reading: VehicleStateReading(), isLoading: true)
        XCTAssertEqual(VehicleStateProjector.resolve(input).phase, .loading)
    }

    func testProjectorEmptyWhenNoReading() {
        XCTAssertEqual(VehicleStateProjector.resolve(VehicleStatePanelInput(reading: nil)).phase, .empty)
    }

    func testProjectorDataWhenReadingPresent() {
        let input = VehicleStatePanelInput(reading: VehicleStateReading(valetMode: true), units: metricUnits())
        guard case let .data(projection) = VehicleStateProjector.resolve(input).phase else {
            return XCTFail("expected .data")
        }
        XCTAssertEqual(projection.accessModes[0].value, .enabled)
    }

    // MARK: - Model wiring + telemetry (P1/S11 view.opened)

    func testModelStartEmitsViewOpenedSlugOnce() {
        let spy = SpyVehicleStateTelemetry()
        let model = VehicleStateModel(source: InMemoryVehicleStateSource(), telemetry: spy)
        model.start()
        model.start() // idempotent
        XCTAssertEqual(spy.openedSurfaces, ["VehicleStatePanel"])
        XCTAssertEqual(VehicleStatePanel.surfaceSlug, "VehicleStatePanel")
    }

    func testModelAppliesPushedSnapshot() {
        let source = InMemoryVehicleStateSource()
        let model = VehicleStateModel(source: source, telemetry: SpyVehicleStateTelemetry())
        model.start()
        source.push(VehicleStatePanelInput(reading: VehicleStateReading(serviceMode: true), units: metricUnits()))
        guard case let .data(projection) = model.phase else {
            return XCTFail("expected .data after push")
        }
        XCTAssertEqual(projection.accessModes[1].value, .active)
        XCTAssertEqual(model.connection, .live)
    }

    func testModelStartStopRefreshForwardToSource() {
        let source = InMemoryVehicleStateSource()
        let model = VehicleStateModel(source: source, telemetry: SpyVehicleStateTelemetry())
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testModelAutoRefreshesOnceOnStaleTransition() {
        let source = InMemoryVehicleStateSource()
        let model = VehicleStateModel(source: source, telemetry: SpyVehicleStateTelemetry())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(VehicleStatePanelInput(reading: VehicleStateReading(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale transition triggers one auto-refresh")
        source.push(VehicleStatePanelInput(reading: VehicleStateReading(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "staying stale does not re-refresh")
        XCTAssertEqual(model.connection, .stale)
    }

    // MARK: - Accessibility + i18n facade

    func testRowLabelComposesParts() {
        XCTAssertEqual(VehicleStateAccessibility.rowLabel(label: "High Beams", value: "On"), "High Beams, On")
    }

    func testStringsResolveLocalizedAndLiteral() {
        XCTAssertEqual(VehicleStateStrings.resolve(.on), "On")
        XCTAssertEqual(VehicleStateStrings.resolve(.off), "Off")
        XCTAssertEqual(VehicleStateStrings.resolve(.active), "Active")
        XCTAssertEqual(VehicleStateStrings.resolve(.literal("80 km/h")), "80 km/h")
    }

    func testFieldMetadataIsCompleteForEveryRow() {
        for field in VehicleStateField.allCases {
            XCTAssertFalse(field.labelKey.isEmpty)
            XCTAssertFalse(field.labelFallback.isEmpty)
            XCTAssertFalse(field.systemImage.isEmpty)
        }
        XCTAssertEqual(VehicleStateField.allCases.count, 10)
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class SpyVehicleStateTelemetry: VehicleStateTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
