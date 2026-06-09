//
//  VehicleHero.Tests.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  Adapter coverage for the VehicleHero surface: the SI→display unit conversions
//  (ports of the web `useUnits` converters), the number / int / gauge formatters (port
//  of numberFormat.ts), the context-aware gauge set + clamped fractions, the status
//  parsing, the quick-action routes, the freshness age tokens, and the accessibility
//  joiners. The projection / stat-grid / model coverage lives in
//  `VehicleHero.ModelTests.swift`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and the
//  locale is injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleState(
    status: VehicleHeroPanelStatus = .parked,
    batteryLevel: Double = 72,
    ratedRangeMeters: Double = 354_000,
    speedMps: Double = 0,
    insideTempC: Double? = 21,
    isCharging: Bool = false,
    chargerPowerKw: Double? = nil
) -> VehicleHeroPanelState {
    VehicleHeroPanelState(
        status: status,
        batteryLevel: batteryLevel,
        ratedRangeMeters: ratedRangeMeters,
        idealRangeMeters: 402_000,
        odometerMeters: 41_842_000,
        speedMps: speedMps,
        powerKw: 0,
        insideTempC: insideTempC,
        outsideTempC: 12,
        isCharging: isCharging,
        chargerPowerKw: chargerPowerKw,
        chargeRateMeters: nil,
        timeToFullHours: 0,
        isLocked: true,
        sentryMode: false
    )
}

// MARK: - Unit conversions (ports of the web useUnits converters)

final class VehicleHeroPanelUnitsTests: XCTestCase {
    func testDistanceMetricIsKilometers() {
        XCTAssertEqual(VehicleHeroPanelUnits.distance(1000, .metric), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroPanelUnits.distance(354_000, .metric), 354, accuracy: 1e-9)
    }

    func testDistanceImperialIsMiles() {
        XCTAssertEqual(VehicleHeroPanelUnits.distance(1609.344, .imperial), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroPanelUnits.distance(160_934.4, .imperial), 100, accuracy: 1e-6)
    }

    func testSpeedConversions() {
        XCTAssertEqual(VehicleHeroPanelUnits.speed(10, .metric), 36, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroPanelUnits.speed(10, .imperial), 22.369362920544, accuracy: 1e-9)
    }

    func testTemperatureConversions() {
        XCTAssertEqual(VehicleHeroPanelUnits.temperature(20, .metric), 20, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroPanelUnits.temperature(0, .imperial), 32, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroPanelUnits.temperature(100, .imperial), 212, accuracy: 1e-9)
    }

    func testNonFiniteInputYieldsZero() {
        XCTAssertEqual(VehicleHeroPanelUnits.distance(.nan, .imperial), 0)
        XCTAssertEqual(VehicleHeroPanelUnits.speed(.infinity, .metric), 0)
        XCTAssertEqual(VehicleHeroPanelUnits.temperature(.nan, .imperial), 0)
    }

    func testUnitLabels() {
        XCTAssertEqual(VehicleHeroPanelUnitSystem.imperial.distanceUnit, "mi")
        XCTAssertEqual(VehicleHeroPanelUnitSystem.metric.distanceUnit, "km")
        XCTAssertEqual(VehicleHeroPanelUnitSystem.imperial.speedUnit, "mph")
        XCTAssertEqual(VehicleHeroPanelUnitSystem.metric.speedUnit, "km/h")
        XCTAssertEqual(VehicleHeroPanelUnitSystem.imperial.temperatureUnit, "°F")
        XCTAssertEqual(VehicleHeroPanelUnitSystem.metric.temperatureUnit, "°C")
        XCTAssertTrue(VehicleHeroPanelUnitSystem.imperial.isFahrenheit)
        XCTAssertFalse(VehicleHeroPanelUnitSystem.metric.isFahrenheit)
    }
}

// MARK: - Number formatting (port of numberFormat.ts)

final class VehicleHeroPanelFormatTests: XCTestCase {
    func testNumberGroupsAndFixesDecimals() {
        XCTAssertEqual(VehicleHeroPanelFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(VehicleHeroPanelFormat.number(0, locale: enUS), "0.00")
    }

    func testIntRoundsAndGroups() {
        XCTAssertEqual(VehicleHeroPanelFormat.int(12345.6, locale: enUS), "12,346")
        XCTAssertEqual(VehicleHeroPanelFormat.int(354, locale: enUS), "354")
    }

    func testGaugeUsesZeroDecimalsForIntegers() {
        XCTAssertEqual(VehicleHeroPanelFormat.gauge(85, locale: enUS), "85")
        XCTAssertEqual(VehicleHeroPanelFormat.gauge(350, locale: enUS), "350")
    }

    func testGaugeUsesPrecisionForFractions() {
        XCTAssertEqual(VehicleHeroPanelFormat.gauge(85.4, locale: enUS), "85.40")
    }

    func testMeasurementWithAndWithoutDecimals() {
        XCTAssertEqual(VehicleHeroPanelFormat.measurement(48.28, 0, "km/h", enUS), "48 km/h")
        XCTAssertEqual(VehicleHeroPanelFormat.measurement(41842, nil, "km", enUS), "41,842 km")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(VehicleHeroPanelFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(VehicleHeroPanelFormat.int(.infinity, locale: enUS), "0")
    }
}

// MARK: - Gauge fractions + composition (web RadialGauge block)

final class VehicleHeroPanelGaugeTests: XCTestCase {
    func testClampFractionProportional() {
        XCTAssertEqual(VehicleHeroPanelGauges.clampFraction(300, 600), 0.5, accuracy: 1e-9)
    }

    func testClampFractionClampsToUnit() {
        XCTAssertEqual(VehicleHeroPanelGauges.clampFraction(900, 600), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroPanelGauges.clampFraction(-50, 600), 0, accuracy: 1e-9)
    }

    func testClampFractionGuardsNonFiniteAndNonPositiveMax() {
        XCTAssertEqual(VehicleHeroPanelGauges.clampFraction(.nan, 600), 0)
        XCTAssertEqual(VehicleHeroPanelGauges.clampFraction(50, 0), 0)
    }

    func testIdleGaugeSet() {
        let gauges = VehicleHeroPanelGauges.gauges(for: sampleState(), system: .metric, locale: enUS)
        XCTAssertEqual(gauges.map(\.id), ["battery", "range", "inside", "outside"])
    }

    func testDrivingAddsSpeedGauge() {
        let gauges = VehicleHeroPanelGauges.gauges(
            for: sampleState(status: .driving, speedMps: 27.7778), system: .metric, locale: enUS
        )
        XCTAssertEqual(gauges.map(\.id), ["battery", "range", "speed", "inside", "outside"])
        let speed = gauges.first { $0.id == "speed" }
        XCTAssertEqual(speed?.valueText, "100")
        XCTAssertEqual(speed?.unit, "km/h")
    }

    func testChargingAddsPowerGauge() {
        let gauges = VehicleHeroPanelGauges.gauges(
            for: sampleState(status: .charging, isCharging: true, chargerPowerKw: 11),
            system: .metric, locale: enUS
        )
        XCTAssertEqual(gauges.map(\.id), ["battery", "range", "power", "inside", "outside"])
        let power = gauges.first { $0.id == "power" }
        XCTAssertEqual(power?.valueText, "11")
        XCTAssertEqual(power?.unit, "kW")
    }

    func testBatteryAccentByThreshold() {
        let high = VehicleHeroPanelGauges.gauges(for: sampleState(batteryLevel: 80), system: .metric)
        XCTAssertEqual(high.first?.accent, .battery)
        let low = VehicleHeroPanelGauges.gauges(for: sampleState(batteryLevel: 40), system: .metric)
        XCTAssertEqual(low.first?.accent, .batteryLow)
    }

    func testRangeGaugeConvertsAndRounds() {
        let metric = VehicleHeroPanelGauges.gauges(
            for: sampleState(ratedRangeMeters: 354_000),
            system: .metric,
            locale: enUS
        )
        let range = metric.first { $0.id == "range" }
        XCTAssertEqual(range?.valueText, "354")
        XCTAssertEqual(range?.unit, "km")
        XCTAssertEqual(range?.fraction ?? 0, 354.0 / 600.0, accuracy: 1e-9)

        let imperial = VehicleHeroPanelGauges.gauges(
            for: sampleState(ratedRangeMeters: 354_000), system: .imperial, locale: enUS
        )
        let miRange = imperial.first { $0.id == "range" }
        XCTAssertEqual(miRange?.valueText, "220") // 354000 / 1609.344 = 219.96 → 220
        XCTAssertEqual(miRange?.unit, "mi")
    }

    func testTemperatureGaugeMaxFollowsUnit() {
        let imperial = VehicleHeroPanelGauges.gauges(for: sampleState(insideTempC: 20), system: .imperial, locale: enUS)
        let inside = imperial.first { $0.id == "inside" }
        XCTAssertEqual(inside?.valueText, "68") // 20°C → 68°F
        XCTAssertEqual(inside?.unit, "°F")
        XCTAssertEqual(inside?.fraction ?? 0, 68.0 / 122.0, accuracy: 1e-9)
    }
}

// MARK: - Status parsing (web state?.state ?? 'offline')

final class VehicleHeroPanelStatusTests: XCTestCase {
    func testParsesKnownStates() {
        XCTAssertEqual(VehicleHeroPanelStatus(raw: "driving"), .driving)
        XCTAssertEqual(VehicleHeroPanelStatus(raw: "CHARGING"), .charging)
        XCTAssertEqual(VehicleHeroPanelStatus(raw: "parked"), .parked)
    }

    func testUnknownOrNilFallsBackToOffline() {
        XCTAssertEqual(VehicleHeroPanelStatus(raw: "teleporting"), .offline)
        XCTAssertEqual(VehicleHeroPanelStatus(raw: nil), .offline)
    }

    func testLabelKeyAndFallback() {
        XCTAssertEqual(VehicleHeroPanelStatus.driving.labelKey, "vehicle.state.driving")
        XCTAssertEqual(VehicleHeroPanelStatus.driving.labelFallback, "Driving")
        XCTAssertEqual(VehicleHeroPanelStatus.asleep.labelFallback, "Asleep")
    }
}

// MARK: - Quick actions (web Link routes)

final class VehicleHeroPanelActionTests: XCTestCase {
    func testAllActionsOrder() {
        XCTAssertEqual(VehicleHeroPanelAction.allCases, [.details, .commands, .liveMap, .digitalTwin])
    }

    func testRouteMapping() {
        XCTAssertEqual(VehicleHeroPanelAction.details.route(vehicleID: 7), .details(vehicleID: 7))
        XCTAssertEqual(VehicleHeroPanelAction.commands.route(vehicleID: 7), .commands)
        XCTAssertEqual(VehicleHeroPanelAction.liveMap.route(vehicleID: 7), .liveMap)
        XCTAssertEqual(VehicleHeroPanelAction.digitalTwin.route(vehicleID: 7), .digitalTwin)
    }
}

// MARK: - Freshness (web FreshnessIndicator age)

final class VehicleHeroPanelFreshnessTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    func testFreshValueIsNow() {
        let result = VehicleHeroPanelFreshness.describe(updatedAt: now.addingTimeInterval(-10), now: now)
        XCTAssertEqual(result.token, "now")
        XCTAssertFalse(result.isStale)
    }

    func testMinutesAndStaleFlag() {
        let result = VehicleHeroPanelFreshness.describe(updatedAt: now.addingTimeInterval(-300), now: now)
        XCTAssertEqual(result.token, "5m")
        XCTAssertTrue(result.isStale)
    }

    func testHoursAndDays() {
        XCTAssertEqual(VehicleHeroPanelFreshness.token(for: 7200), "2h")
        XCTAssertEqual(VehicleHeroPanelFreshness.token(for: 172_800), "2d")
    }

    func testNilTimestampIsStale() {
        let result = VehicleHeroPanelFreshness.describe(updatedAt: nil, now: now)
        XCTAssertEqual(result.token, "—")
        XCTAssertTrue(result.isStale)
    }
}

// MARK: - Accessibility summary content

final class VehicleHeroPanelAccessibilityTests: XCTestCase {
    func testHeaderLabelJoinsParts() {
        XCTAssertEqual(
            VehicleHeroPanelAccessibility.headerLabel(title: "Lightning", status: "Driving"),
            "Lightning, Driving"
        )
    }

    func testGaugeLabelWithUnit() {
        XCTAssertEqual(
            VehicleHeroPanelAccessibility.gaugeLabel(label: "Battery", value: "72", unit: "%"),
            "Battery, 72 %"
        )
    }

    func testGaugeLabelWithoutUnit() {
        XCTAssertEqual(
            VehicleHeroPanelAccessibility.gaugeLabel(label: "Battery", value: "72", unit: ""),
            "Battery, 72"
        )
    }

    func testStatLabelJoinsParts() {
        XCTAssertEqual(
            VehicleHeroPanelAccessibility.statLabel(label: "Odometer", value: "41,842 km"),
            "Odometer, 41,842 km"
        )
    }
}
