//
//  VehicleHeroWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  Unit coverage for the VehicleHeroWidget surface:
//    • Adapter — SI converters, fmtNumber/fmtInt parity, firmware precedence,
//      vehicle-state → badge catalog, a11y summaries.
//    • Projection — gauges (context + clamp + color), charging detail, the
//      context stat grid + always cards (parity with web buildStatCards).
//    • State holder — VehicleHeroWidgetModel phase resolution + P1/S11 telemetry.
//    • Registry — canonical vehicle-hero metadata + size clamping.
//
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no real store
//  (the model is driven by VehicleHeroWidgetInMemoryVehicleHeroSource).
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures + localizers

private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }
private let keyTap: @Sendable (String, String) -> String = { key, _ in "L:\(key)" }
private let metric = UnitDisplayPrefs(
    distanceUnit: "km", speedUnit: "km/h", tempUnit: "°C", isFahrenheit: false, locale: "en_US", precision: 2
)
private let imperial = UnitDisplayPrefs(
    distanceUnit: "mi", speedUnit: "mph", tempUnit: "°F", isFahrenheit: true, locale: "en_US", precision: 2
)
private let vehicle = VehicleInput(
    id: 7, vin: "VIN123", displayName: "Bolt", model: "Model 3", trimBadging: "Long Range"
)

private func drivingState() -> VehicleStateInput {
    VehicleStateInput(
        state: "driving", speedMps: 29.06, powerKw: 121, batteryLevel: 72,
        ratedRangeM: 380_000, idealRangeM: 400_000, odometerM: 42_000_000,
        insideTempC: 21, outsideTempC: 14, isLocked: true, sentryMode: true, softwareVersion: "2026.8.1"
    )
}

private func chargingState() -> VehicleStateInput {
    VehicleStateInput(
        state: "charging", speedMps: 0, powerKw: -2, batteryLevel: 40,
        ratedRangeM: 210_000, idealRangeM: 230_000, odometerM: 42_000_000,
        insideTempC: 20, outsideTempC: 9, isCharging: true, chargerPowerKw: 48,
        chargeRateMph: 48000, timeToFullChargeH: 1.4, isLocked: false, sentryMode: false
    )
}

private func idleState(inside: Double? = 22.5) -> VehicleStateInput {
    VehicleStateInput(
        state: "online", batteryLevel: 84, ratedRangeM: 440_000, idealRangeM: 460_000,
        odometerM: 42_000_000, insideTempC: inside, outsideTempC: 12.3, isLocked: true, sentryMode: true
    )
}

// MARK: - Adapter: converters + formatters + firmware

@MainActor final class VehicleHeroWidgetAdapterTests: XCTestCase {
    func testDistanceConversionMatchesWebConstants() {
        XCTAssertEqual(VehicleHeroConvert.distance(1000, "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroConvert.distance(1609.344, "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroConvert.distance(0.3048, "ft"), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroConvert.distance(1000, "parsec"), 1, accuracy: 1e-9) // unknown → metric
    }

    func testSpeedAndTemperatureConversion() {
        XCTAssertEqual(VehicleHeroConvert.speed(10, "km/h"), 36, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroConvert.speed(0.44704, "mph"), 1, accuracy: 1e-6)
        XCTAssertEqual(VehicleHeroConvert.temperature(100, "°C"), 100, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroConvert.temperature(0, "°F"), 32, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroConvert.temperature(100, "°F"), 212, accuracy: 1e-9)
    }

    func testNumberFormattingParity() {
        XCTAssertEqual(VehicleHeroWidgetFormat.number(12345.6, decimals: 0, locale: "en_US"), "12,346")
        XCTAssertEqual(VehicleHeroWidgetFormat.number(42.567, decimals: 2, locale: "en_US"), "42.57")
        XCTAssertEqual(VehicleHeroWidgetFormat.int(1234, locale: "en_US"), "1,234")
    }

    func testNumberFormattingGuardsNonFinite() {
        XCTAssertEqual(VehicleHeroWidgetFormat.number(.nan, decimals: 2, locale: "en_US"), "0.00")
        XCTAssertEqual(VehicleHeroWidgetFormat.number(.infinity, decimals: 0, locale: "en_US"), "0")
    }

    func testFirmwarePrecedence() {
        func firmware(_ live: String?, _ swUpdate: String?, _ software: String?) -> String {
            VehicleHeroFirmware.resolve(liveVersion: live, liveSwUpdateVersion: swUpdate, softwareVersion: software)
        }
        XCTAssertEqual(firmware("a", "b", "c"), "a")
        XCTAssertEqual(firmware(nil, "b", "c"), "b")
        XCTAssertEqual(firmware(" ", nil, "c"), "c")
        XCTAssertEqual(firmware(nil, nil, nil), "—")
    }
}

// MARK: - Adapter: status catalog

@MainActor final class VehicleHeroStatusCatalogTests: XCTestCase {
    func testKnownStatesCarryToneDotAndLabel() {
        let online = VehicleHeroStatusCatalog.visual(for: "online", localize: echo)
        XCTAssertEqual(online.label, "Online")
        XCTAssertEqual(online.tone, .success)

        let driving = VehicleHeroStatusCatalog.visual(for: "driving", localize: echo)
        XCTAssertEqual(driving.tone, .info)
        XCTAssertEqual(driving.dotColor, VehicleHeroPalette.blue)

        let charging = VehicleHeroStatusCatalog.visual(for: "charging", localize: echo)
        XCTAssertEqual(charging.dotColor, VehicleHeroPalette.yellow)
        XCTAssertEqual(VehicleHeroStatusCatalog.visual(for: "offline", localize: echo).tone, .danger)
    }

    func testUnknownStateFallsBackToCapitalizedNeutral() {
        let unknown = VehicleHeroStatusCatalog.visual(for: "teleporting", localize: echo)
        XCTAssertEqual(unknown.label, "Teleporting")
        XCTAssertEqual(unknown.tone, .neutral)
    }

    func testStatusResolvesPerStateKey() {
        XCTAssertEqual(VehicleHeroStatusCatalog.visual(for: "parked", localize: keyTap).label, "L:hero.state.parked")
    }
}

// MARK: - Projection: gauges

@MainActor final class VehicleHeroGaugeTests: XCTestCase {
    private func gauges(_ state: VehicleStateInput, _ prefs: UnitDisplayPrefs = metric) -> [VehicleHeroGauge] {
        VehicleHeroWidgetProjection.build(
            vehicle: vehicle, state: state, firmware: "fw", prefs: prefs, localize: echo
        ).gauges
    }

    func testDrivingShowsSpeedNotPower() {
        let ids = gauges(drivingState()).map(\.id)
        XCTAssertEqual(ids, ["battery", "range", "speed", "inside", "outside"])
    }

    func testChargingShowsPowerNotSpeed() {
        let ids = gauges(chargingState()).map(\.id)
        XCTAssertEqual(ids, ["battery", "range", "power", "inside", "outside"])
    }

    func testIdleShowsNeitherSpeedNorPower() {
        XCTAssertEqual(gauges(idleState()).map(\.id), ["battery", "range", "inside", "outside"])
    }

    func testBatteryColorAndFractionClamp() {
        let high = gauges(idleState()).first { $0.id == "battery" }
        XCTAssertEqual(high?.color, VehicleHeroPalette.green)
        XCTAssertEqual(high?.valueText, "84")
        XCTAssertEqual(high?.fraction ?? 0, 0.84, accuracy: 1e-9)

        let low = gauges(chargingState()).first { $0.id == "battery" }
        XCTAssertEqual(low?.color, VehicleHeroPalette.amber)
    }

    func testRangeConvertsToImperialAndUnitLabels() {
        let metricRange = gauges(idleState()).first { $0.id == "range" }
        XCTAssertEqual(metricRange?.valueText, "440")
        XCTAssertEqual(metricRange?.unit, "km")

        let mile = gauges(idleState(), imperial).first { $0.id == "range" }
        XCTAssertEqual(mile?.unit, "mi")
        XCTAssertEqual(mile?.valueText, "273") // 440000 m / 1609.344 ≈ 273
    }

    func testTemperatureGaugeMaxFollowsUnitSystem() {
        let metricInside = gauges(idleState()).first { $0.id == "inside" }
        XCTAssertEqual(metricInside?.fraction ?? 0, 23 / 50, accuracy: 1e-9) // round(22.5)=23, max 50
        let imperialInside = gauges(idleState(), imperial).first { $0.id == "inside" }
        XCTAssertEqual(imperialInside?.unit, "°F")
    }
}

// MARK: - Projection: charging detail + stat cards

@MainActor final class VehicleHeroStatTests: XCTestCase {
    private func projection(_ state: VehicleStateInput?, firmware: String = "2026.8.1") -> VehicleHeroWidgetProjection {
        VehicleHeroWidgetProjection.build(
            vehicle: vehicle,
            state: state,
            firmware: firmware,
            prefs: metric,
            localize: echo
        )
    }

    func testChargingDetailOnlyWhenCharging() {
        XCTAssertNil(projection(drivingState()).charging)
        let charging = projection(chargingState()).charging
        XCTAssertEqual(charging?.powerText, "48.00 kW")
        XCTAssertEqual(charging?.rateText, "48 km/h")
        XCTAssertEqual(charging?.timeToFullText, "1.4h")
        XCTAssertEqual(charging?.doneInHours ?? 0, 1.4, accuracy: 1e-9)
    }

    func testStatCardContextSelectionAndCount() {
        XCTAssertEqual(projection(drivingState()).statCards.first?.id, "ctx-speed")
        XCTAssertEqual(projection(chargingState()).statCards.first?.id, "ctx-rate")
        XCTAssertEqual(projection(idleState()).statCards.first?.id, "ctx-inside")
        XCTAssertEqual(projection(idleState()).statCards.count, 8) // 4 context + 4 always
    }

    func testAlwaysCardsCarryLockSentryFirmwarePower() {
        let cards = projection(idleState()).statCards
        let byId = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, $0) })
        XCTAssertEqual(byId["always-status"]?.value, "Locked")
        XCTAssertEqual(byId["always-sentry"]?.value, "Active")
        XCTAssertEqual(byId["always-firmware"]?.value, "2026.8.1")
        XCTAssertEqual(byId["always-power"]?.color, VehicleHeroPalette.slate) // idle power 0 → slate
    }

    func testPowerColorTracksSign() {
        XCTAssertEqual(VehicleHeroWidgetProjection.powerColor(5), VehicleHeroPalette.amber)
        XCTAssertEqual(VehicleHeroWidgetProjection.powerColor(-5), VehicleHeroPalette.green)
        XCTAssertEqual(VehicleHeroWidgetProjection.powerColor(0), VehicleHeroPalette.slate)
    }

    func testTemperatureCardShowsDashWhenNil() {
        let cards = projection(idleState(inside: nil)).statCards
        XCTAssertEqual(cards.first { $0.id == "ctx-inside" }?.value, "—")
    }
}

// MARK: - Projection: header + a11y

@MainActor final class VehicleHeroHeaderTests: XCTestCase {
    func testSubtitleJoinsModelTrimAndVin() {
        XCTAssertEqual(
            VehicleHeroWidgetProjection.subtitle(for: vehicle), "Model 3 Long Range · VIN123"
        )
        let noTrim = VehicleInput(id: 1, vin: "V", displayName: "n", model: "Model Y", trimBadging: "")
        XCTAssertEqual(VehicleHeroWidgetProjection.subtitle(for: noTrim), "Model Y · V")
    }

    func testTitleFallsBackToVinAndStatusDefaultsOffline() {
        let anon = VehicleInput(id: 1, vin: "VIN999", displayName: "", model: "M", trimBadging: "")
        let proj = VehicleHeroWidgetProjection.build(
            vehicle: anon,
            state: nil,
            firmware: "—",
            prefs: metric,
            localize: echo
        )
        XCTAssertEqual(proj.title, "VIN999")
        XCTAssertFalse(proj.hasState)
        XCTAssertEqual(proj.status.label, "Offline") // state nil → "offline"
        XCTAssertTrue(proj.gauges.isEmpty)
    }

    func testAccessibilitySummaries() {
        let summary = VehicleHeroWidgetAccessibility.headerSummary(
            name: "Bolt", stateLabel: "Online", batteryText: "72", percentWord: "percent"
        )
        XCTAssertTrue(summary.contains("Bolt"))
        XCTAssertTrue(summary.contains("Online"))
        XCTAssertTrue(summary.contains("72 percent"))
        XCTAssertEqual(
            VehicleHeroWidgetAccessibility.gaugeValue(label: "Battery", valueText: "72", unit: "%"), "Battery, 72 %"
        )
        XCTAssertEqual(
            VehicleHeroWidgetAccessibility.gaugeValue(label: "Range", valueText: "440", unit: ""), "Range, 440"
        )
    }
}

// MARK: - State holder: phases + telemetry

@MainActor final class VehicleHeroWidgetModelTests: XCTestCase {
    private func make(
        _ update: VehicleHeroWidgetUpdate,
        telemetry: VehicleHeroWidgetTelemetry = VehicleHeroWidgetOSLogVehicleHeroTelemetry()
    ) -> (VehicleHeroWidgetModel, VehicleHeroWidgetInMemoryVehicleHeroSource) {
        let source = VehicleHeroWidgetInMemoryVehicleHeroSource(initial: update)
        return (VehicleHeroWidgetModel(source: source, telemetry: telemetry), source)
    }

    func testPhaseResolutionWithoutVehicle() {
        let (loading, _) = make(VehicleHeroWidgetUpdate(status: .loading, vehicle: nil))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (empty, _) = make(VehicleHeroWidgetUpdate(status: .loaded, vehicle: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (failed, _) = make(VehicleHeroWidgetUpdate(status: .failed("boom"), vehicle: nil))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testVehiclePresentAlwaysRendersContent() {
        for status in [VehicleHeroWidgetLoadStatus.loading, .loaded, .failed("net")] {
            let (model, _) = make(VehicleHeroWidgetUpdate(status: status, vehicle: vehicle, state: idleState()))
            model.start()
            XCTAssertEqual(model.phase, .content)
            XCTAssertNotNil(model.projection)
        }
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = VehicleHeroWidgetSpyTelemetry()
        let (model, source) = make(VehicleHeroWidgetUpdate(status: .loading, vehicle: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleHeroWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesAndUpdatesTrack() {
        let (model, source) = make(VehicleHeroWidgetUpdate(status: .loading, vehicle: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)

        source.push(VehicleHeroWidgetUpdate(
            status: .loaded,
            connection: .offline,
            vehicle: vehicle,
            state: drivingState()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.status.label, "Driving")
    }
}

// MARK: - Registry parity

@MainActor final class VehicleHeroWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VehicleHeroWidget.registration
        XCTAssertEqual(registration.id, "vehicle-hero")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 9))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = VehicleHeroWidget.registration
        func clamp(_ cols: Int, _ rows: Int) -> DashboardWidgetSize {
            registration.clamp(DashboardWidgetSize(cols: cols, rows: rows))
        }
        XCTAssertEqual(clamp(0, 0), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(clamp(9, 99), DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(clamp(3, 12), DashboardWidgetSize(cols: 3, rows: 12))
    }
}

// MARK: - Test doubles

private final class VehicleHeroWidgetSpyTelemetry: VehicleHeroWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
