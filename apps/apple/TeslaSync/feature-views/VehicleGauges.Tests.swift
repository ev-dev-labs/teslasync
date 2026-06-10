//
//  VehicleGauges.Tests.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  Adapter + projection coverage for the VehicleGauges surface:
//    • ModelKey — the web `parseModelKey` token matching across all five silhouettes.
//    • TintRules — the web `batteryColor` thresholds + the boolean tint branches.
//    • Format — the SI conversions (parity-pinned factors), the gauge value decimals rule,
//      and the `formatDistance` label + empty sentinel.
//    • ContentProjection — the four gauges, the two-or-three bars (the charge-rate conditional),
//      and the four chips, in web source order, across metric + imperial units.
//    • PhaseProjection — the web render plus the P4 leaf contract across loading / empty /
//      error / data, including cached-content precedence.
//    • Accessibility — the composed VoiceOver strings.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func metricUnits() -> VehicleGaugesUnits {
    VehicleGaugesUnits(distance: .kilometers, speed: .kilometersPerHour, localeIdentifier: "en_US")
}

private func imperialUnits() -> VehicleGaugesUnits {
    VehicleGaugesUnits(distance: .miles, speed: .milesPerHour, localeIdentifier: "en_US")
}

private func chargingState() -> VehicleGaugesState {
    VehicleGaugesState(
        batteryLevel: 47,
        ratedRange: 280_000,
        speed: 0,
        chargerPower: 48,
        chargeRate: 64000,
        isCharging: true,
        isLocked: true,
        isClimateOn: false,
        sentryMode: false,
        softwareVersion: "2026.6.1"
    )
}

// MARK: - Model key (web `parseModelKey`)

final class VehicleGaugesModelKeyTests: XCTestCase {
    func testParsesEverySilhouette() {
        XCTAssertEqual(VehicleGaugesModelKey.parse("Cybertruck"), .cybertruck)
        XCTAssertEqual(VehicleGaugesModelKey.parse("Model X"), .modelX)
        XCTAssertEqual(VehicleGaugesModelKey.parse("Model Y Long Range"), .modelY)
        XCTAssertEqual(VehicleGaugesModelKey.parse("Model S Plaid"), .modelS)
        XCTAssertEqual(VehicleGaugesModelKey.parse("Model 3"), .model3)
    }

    func testShortTokensAndDefaults() {
        XCTAssertEqual(VehicleGaugesModelKey.parse("CT"), .cybertruck)
        XCTAssertEqual(VehicleGaugesModelKey.parse("MX"), .modelX)
        XCTAssertEqual(VehicleGaugesModelKey.parse(nil), .model3)
        XCTAssertEqual(VehicleGaugesModelKey.parse(""), .model3)
        XCTAssertEqual(VehicleGaugesModelKey.parse("Roadster"), .model3)
    }
}

// MARK: - Tint rules (web batteryColor / boolColor)

final class VehicleGaugesTintRulesTests: XCTestCase {
    func testBatteryThresholds() {
        XCTAssertEqual(VehicleGaugesTintRules.battery(level: 61), .success)
        XCTAssertEqual(VehicleGaugesTintRules.battery(level: 60), .warning)
        XCTAssertEqual(VehicleGaugesTintRules.battery(level: 26), .warning)
        XCTAssertEqual(VehicleGaugesTintRules.battery(level: 25), .danger)
        XCTAssertEqual(VehicleGaugesTintRules.battery(level: 0), .danger)
    }

    func testBooleanTints() {
        XCTAssertEqual(VehicleGaugesTintRules.lock(isLocked: true), .success)
        XCTAssertEqual(VehicleGaugesTintRules.lock(isLocked: false), .danger)
        XCTAssertEqual(VehicleGaugesTintRules.sentry(enabled: true), .danger)
        XCTAssertEqual(VehicleGaugesTintRules.sentry(enabled: false), .inactive)
        XCTAssertEqual(VehicleGaugesTintRules.climate(enabled: true), .accent)
        XCTAssertEqual(VehicleGaugesTintRules.climate(enabled: false), .inactive)
        XCTAssertEqual(VehicleGaugesTintRules.speed(moving: true), .power)
        XCTAssertEqual(VehicleGaugesTintRules.speed(moving: false), .inactive)
        XCTAssertEqual(VehicleGaugesTintRules.power(isCharging: true), .success)
        XCTAssertEqual(VehicleGaugesTintRules.power(isCharging: false), .inactive)
    }
}

// MARK: - Format (parity-pinned SI factors + number formatting)

final class VehicleGaugesFormatTests: XCTestCase {
    func testCanonicalFactorsArePinned() {
        XCTAssertEqual(VehicleGaugesFormat.metersPerKm, 1000.0)
        XCTAssertEqual(VehicleGaugesFormat.metersPerMile, 1609.344)
        XCTAssertEqual(VehicleGaugesFormat.secondsPerHour, 3600.0)
        XCTAssertEqual(VehicleGaugesFormat.metersPerSecondPerMph, 0.44704)
        XCTAssertEqual(VehicleGaugesFormat.maxRangeMeters, 965_606.4, accuracy: 1e-6)
        XCTAssertEqual(VehicleGaugesFormat.maxSpeedMetersPerSecond, 111.76, accuracy: 1e-9)
        XCTAssertEqual(VehicleGaugesFormat.maxChargeRateMetersPerHour, 160_934.4, accuracy: 1e-6)
        XCTAssertEqual(VehicleGaugesFormat.globalPrecision, 2)
        XCTAssertEqual(VehicleGaugesFormat.distancePrecision, 1)
    }

    func testConversions() {
        XCTAssertEqual(VehicleGaugesFormat.convertDistance(480_000, to: .kilometers), 480, accuracy: 1e-9)
        XCTAssertEqual(VehicleGaugesFormat.convertDistance(480_000, to: .miles), 298.2587, accuracy: 1e-3)
        XCTAssertEqual(VehicleGaugesFormat.convertSpeed(30, to: .kilometersPerHour), 108, accuracy: 1e-9)
        XCTAssertEqual(VehicleGaugesFormat.convertSpeed(30, to: .milesPerHour), 67.108, accuracy: 1e-3)
    }

    func testGaugeValueDecimalsRule() {
        XCTAssertEqual(VehicleGaugesFormat.gaugeValue(82, locale: enUS), "82")
        XCTAssertEqual(VehicleGaugesFormat.gaugeValue(82.5, locale: enUS), "82.50")
        XCTAssertEqual(VehicleGaugesFormat.gaugeValue(480, decimals: 0, locale: enUS), "480")
    }

    func testFmtNumberGrouping() {
        XCTAssertEqual(VehicleGaugesFormat.fmtNumber(1234, decimals: 0, locale: enUS), "1,234")
        XCTAssertEqual(VehicleGaugesFormat.fmtNumber(47, decimals: 0, locale: enUS), "47")
    }

    func testFormatDistanceLabelAndSentinel() {
        XCTAssertEqual(
            VehicleGaugesFormat.formatDistance(480_000, unit: .kilometers, locale: enUS),
            "480.0 km"
        )
        XCTAssertEqual(
            VehicleGaugesFormat.formatDistance(64000, unit: .kilometers, locale: enUS),
            "64.0 km"
        )
        XCTAssertEqual(
            VehicleGaugesFormat.formatDistance(.infinity, unit: .kilometers, locale: enUS),
            "—"
        )
    }
}

// MARK: - Content projection — gauges

final class VehicleGaugesGaugeProjectionTests: XCTestCase {
    private func gauge(_ id: String, _ content: VehicleGaugesContent) -> VehicleGaugesGauge? {
        content.gauges.first { $0.id == id }
    }

    func testGaugeOrderAndCount() {
        let content = VehicleGaugesContentProjection.build(state: chargingState(), vehicle: nil, units: metricUnits())
        XCTAssertEqual(content.gauges.map(\.id), ["battery", "range", "speed", "power"])
    }

    func testBatteryGaugeMetric() {
        let content = VehicleGaugesContentProjection.build(state: chargingState(), vehicle: nil, units: metricUnits())
        let battery = gauge("battery", content)
        XCTAssertEqual(battery?.valueText, "47")
        XCTAssertEqual(battery?.unit, "%")
        XCTAssertEqual(battery?.fraction ?? 0, 0.47, accuracy: 1e-9)
        XCTAssertEqual(battery?.tint, .warning)
    }

    func testRangeAndPowerGaugeMetric() {
        let content = VehicleGaugesContentProjection.build(state: chargingState(), vehicle: nil, units: metricUnits())
        let range = gauge("range", content)
        XCTAssertEqual(range?.valueText, "280")
        XCTAssertEqual(range?.unit, "km")
        XCTAssertEqual(range?.tint, .accent)
        let power = gauge("power", content)
        XCTAssertEqual(power?.valueText, "48")
        XCTAssertEqual(power?.unit, "kW")
        XCTAssertEqual(power?.fraction ?? 0, 48.0 / 250.0, accuracy: 1e-9)
        XCTAssertEqual(power?.tint, .success)
    }

    func testSpeedGaugeImperialAndInactiveTint() {
        var state = chargingState()
        state.speed = 0
        let content = VehicleGaugesContentProjection.build(state: state, vehicle: nil, units: imperialUnits())
        let speed = gauge("speed", content)
        XCTAssertEqual(speed?.valueText, "0")
        XCTAssertEqual(speed?.unit, "mph")
        XCTAssertEqual(speed?.tint, .inactive)
    }

    func testSpeedGaugeImperialMoving() {
        var state = chargingState()
        state.speed = 30
        let content = VehicleGaugesContentProjection.build(state: state, vehicle: nil, units: imperialUnits())
        let speed = gauge("speed", content)
        XCTAssertEqual(speed?.valueText, "67")
        XCTAssertEqual(speed?.tint, .power)
    }
}

// MARK: - Content projection — bars + chips

final class VehicleGaugesBarChipProjectionTests: XCTestCase {
    func testBarsIncludeChargeRateOnlyWhenCharging() {
        let charging = VehicleGaugesContentProjection.build(
            state: chargingState(),
            vehicle: nil,
            units: metricUnits()
        )
        XCTAssertEqual(charging.bars.map(\.id), ["batteryLevel", "estimatedRange", "chargeRate"])

        var idle = chargingState()
        idle.isCharging = false
        let idleContent = VehicleGaugesContentProjection.build(state: idle, vehicle: nil, units: metricUnits())
        XCTAssertEqual(idleContent.bars.map(\.id), ["batteryLevel", "estimatedRange"])
    }

    func testBarSublabelsAndTints() {
        let content = VehicleGaugesContentProjection.build(state: chargingState(), vehicle: nil, units: metricUnits())
        let battery = content.bars.first { $0.id == "batteryLevel" }
        XCTAssertEqual(battery?.sublabel, "47%")
        XCTAssertEqual(battery?.tint, .warning)
        let range = content.bars.first { $0.id == "estimatedRange" }
        XCTAssertEqual(range?.sublabel, "280.0 km")
        XCTAssertEqual(range?.tint, .accent)
        let chargeRate = content.bars.first { $0.id == "chargeRate" }
        XCTAssertEqual(chargeRate?.sublabel, "64.0 km/h")
        XCTAssertEqual(chargeRate?.tint, .success)
    }

    func testChipsOrderWordingAndTints() {
        let content = VehicleGaugesContentProjection.build(state: chargingState(), vehicle: nil, units: metricUnits())
        XCTAssertEqual(content.chips.map(\.id), ["lock", "sentry", "climate", "software"])
        let lock = content.chips[0]
        XCTAssertEqual(lock.labelKey, "common.locked")
        XCTAssertEqual(lock.tint, .success)
        XCTAssertEqual(lock.iconSystemName, "lock.fill")
        XCTAssertEqual(content.chips[1].labelKey, "common.sentryOff")
        XCTAssertEqual(content.chips[1].tint, .inactive)
        XCTAssertEqual(content.chips[2].labelKey, "common.climateOff")
    }

    func testSoftwareChipVerbatimAndFallback() {
        let withVersion = VehicleGaugesContentProjection.build(
            state: chargingState(),
            vehicle: nil,
            units: metricUnits()
        )
        XCTAssertEqual(withVersion.chips[3].verbatim, "2026.6.1")
        XCTAssertNil(withVersion.chips[3].labelKey)

        var blank = chargingState()
        blank.softwareVersion = nil
        let fallback = VehicleGaugesContentProjection.build(state: blank, vehicle: nil, units: metricUnits())
        XCTAssertNil(fallback.chips[3].verbatim)
        XCTAssertEqual(fallback.chips[3].labelKey, "common.notAvailable")
    }
}

// MARK: - Fraction clamping

final class VehicleGaugesFractionTests: XCTestCase {
    func testFractionClamps() {
        XCTAssertEqual(VehicleGaugesContentProjection.fraction(50, 100), 0.5, accuracy: 1e-9)
        XCTAssertEqual(VehicleGaugesContentProjection.fraction(150, 100), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleGaugesContentProjection.fraction(-5, 100), 0, accuracy: 1e-9)
        XCTAssertEqual(VehicleGaugesContentProjection.fraction(5, 0), 0, accuracy: 1e-9)
    }
}

// MARK: - Phase projection (web render + P4 leaf contract)

final class VehicleGaugesPhaseProjectionTests: XCTestCase {
    func testDataWhenStatePresent() {
        let resolved = VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput(state: chargingState()))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertNotNil(resolved.content)
    }

    func testLoadingEmptyError() {
        XCTAssertEqual(
            VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput(isLoading: true)).phase,
            .loading
        )
        XCTAssertEqual(VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput()).phase, .empty)
        XCTAssertEqual(
            VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput(errorMessage: "boom")).phase,
            .error("boom")
        )
    }

    func testCachedStateTakesPrecedenceOverErrorAndLoading() {
        let resolved = VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput(
            state: chargingState(),
            isLoading: true,
            errorMessage: "boom"
        ))
        XCTAssertEqual(resolved.phase, .data)
    }

    func testEmptyMessageDoesNotForceError() {
        XCTAssertEqual(VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput(errorMessage: "")).phase, .empty)
    }
}

// MARK: - Accessibility summaries

final class VehicleGaugesAccessibilityTests: XCTestCase {
    func testCarLabelJoinsAndDropsEmpty() {
        XCTAssertEqual(
            VehicleGaugesAccessibility.carLabel(
                modelName: "Model S",
                batteryText: "82%",
                statusParts: ["Charging", "Locked", ""]
            ),
            "Model S, 82%, Charging, Locked"
        )
        XCTAssertEqual(
            VehicleGaugesAccessibility.carLabel(modelName: "", batteryText: "", statusParts: ["Locked"]),
            "Locked"
        )
    }

    func testGaugeAndBarLabels() {
        XCTAssertEqual(VehicleGaugesAccessibility.gaugeLabel(label: "Range", value: "480", unit: "km"), "Range, 480 km")
        XCTAssertEqual(VehicleGaugesAccessibility.gaugeLabel(label: "Battery", value: "82", unit: ""), "Battery, 82")
        XCTAssertEqual(
            VehicleGaugesAccessibility.barLabel(label: "Battery Level", sublabel: "82%"),
            "Battery Level, 82%"
        )
    }
}
