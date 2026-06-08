//
//  VehicleHeroCardWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0107 · VehicleHeroCardWidget (Apple)
//
//  Unit coverage for the VehicleHeroCardWidget surface:
//    • Adapter (cached → projection) — value parity with the web widget's numeric pipeline
//      (display_name || vin, model/trim, battery thresholds, convertDistanceFromSI / fmtInt,
//      convertTempFromSI rounding, charger-power suffix, FSM status → label + dot tone).
//    • Layout — the pure `isCompact` / `isWide` / `isTall` resolution across grid footprints.
//    • State holder — `VehicleHeroModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `vehicle-hero-card` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryVehicleHeroSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor
final class VehicleHeroAdapterTests: XCTestCase {
    private let vehicle = VehicleHeroVehicleDTO(
        displayName: "Bluebird", vin: "5YJ3E1EA7KF000000", model: "Model 3", trimBadging: "Long Range"
    )
    private let state = VehicleHeroStateDTO(
        statusRaw: "online",
        batteryLevel: 84,
        idealRangeMeters: 450_000,
        insideTempCelsius: 21,
        outsideTempCelsius: 14
    )

    private func project(
        _ state: VehicleHeroStateDTO?,
        _ units: VehicleHeroUnitPrefs = VehicleHeroUnitPrefs()
    ) -> VehicleHeroProjection {
        VehicleHeroProjector.project(vehicle: vehicle, state: state, units: units)
    }

    func testNameResolvesDisplayNameThenVin() {
        XCTAssertEqual(VehicleHeroProjector.resolveName(displayName: "Bluebird", vin: "VIN1"), "Bluebird")
        XCTAssertEqual(VehicleHeroProjector.resolveName(displayName: "", vin: "VIN1"), "VIN1")
    }

    func testSubtitleAppendsTrimWhenPresent() {
        XCTAssertEqual(
            VehicleHeroProjector.resolveSubtitle(model: "Model 3", trimBadging: "Long Range"),
            "Model 3 Long Range"
        )
        XCTAssertEqual(VehicleHeroProjector.resolveSubtitle(model: "Model 3", trimBadging: ""), "Model 3")
    }

    func testMetricsKilometersCelsius() {
        let projection = project(state)
        XCTAssertEqual(projection.name, "Bluebird")
        XCTAssertEqual(projection.subtitle, "Model 3 Long Range")
        XCTAssertEqual(projection.batteryText, "84%")
        XCTAssertEqual(projection.batteryLevel, 84)
        XCTAssertEqual(projection.batteryTone, .success)
        XCTAssertEqual(projection.rangeText, "450 km")
        XCTAssertEqual(projection.idealText, "450 km")
        XCTAssertEqual(projection.cabinText, "21°C")
        XCTAssertEqual(projection.outsideText, "14°C")
        XCTAssertEqual(projection.statusLabel, "Online")
        XCTAssertEqual(projection.statusTone, .success)
        XCTAssertFalse(projection.isCharging)
        XCTAssertNil(projection.chargingPowerText)
    }

    func testMetricsMilesFahrenheit() {
        let projection = project(state, VehicleHeroUnitPrefs(distance: .miles, temperature: .fahrenheit))
        // 450000 m / 1609.344 = 279.62 → round 280; 21°C → 69.8 → 70; 14°C → 57.2 → 57.
        XCTAssertEqual(projection.rangeText, "280 mi")
        XCTAssertEqual(projection.cabinText, "70°F")
        XCTAssertEqual(projection.outsideText, "57°F")
        XCTAssertEqual(projection.distanceSymbol, "mi")
        XCTAssertEqual(projection.temperatureSymbol, "°F")
    }

    func testBatteryToneThresholds() {
        XCTAssertEqual(project(VehicleHeroStateDTO(batteryLevel: 84)).batteryTone, .success)
        XCTAssertEqual(project(VehicleHeroStateDTO(batteryLevel: 51)).batteryTone, .success)
        XCTAssertEqual(project(VehicleHeroStateDTO(batteryLevel: 50)).batteryTone, .warning)
        XCTAssertEqual(project(VehicleHeroStateDTO(batteryLevel: 21)).batteryTone, .warning)
        XCTAssertEqual(project(VehicleHeroStateDTO(batteryLevel: 20)).batteryTone, .danger)
        XCTAssertEqual(project(VehicleHeroStateDTO(batteryLevel: 0)).batteryTone, .danger)
    }

    func testChargingPowerSuffixOnlyWhenPositive() {
        let charging = VehicleHeroStateDTO(statusRaw: "charging", isCharging: true, chargerPowerKilowatts: 11)
        XCTAssertEqual(project(charging).chargingPowerText, "11.0 kW")
        XCTAssertTrue(project(charging).isCharging)

        let zero = VehicleHeroStateDTO(statusRaw: "charging", isCharging: true, chargerPowerKilowatts: 0)
        XCTAssertNil(project(zero).chargingPowerText)

        let none = VehicleHeroStateDTO(statusRaw: "charging", isCharging: true, chargerPowerKilowatts: nil)
        XCTAssertNil(project(none).chargingPowerText)
    }

    func testNoStateProjectsEmDashesAndOfflineStatus() {
        let projection = project(nil)
        XCTAssertEqual(projection.batteryText, "—")
        XCTAssertNil(projection.batteryLevel)
        XCTAssertEqual(projection.batteryTone, .muted)
        XCTAssertEqual(projection.rangeText, "—")
        XCTAssertEqual(projection.idealText, "—")
        XCTAssertEqual(projection.cabinText, "—")
        XCTAssertEqual(projection.outsideText, "—")
        XCTAssertFalse(projection.isCharging)
        XCTAssertEqual(projection.statusLabel, "Offline")
        XCTAssertEqual(projection.statusTone, .danger)
    }

    func testNilInnerRangeProjectsToZero() {
        let projection = project(VehicleHeroStateDTO(statusRaw: "online", idealRangeMeters: nil))
        XCTAssertEqual(projection.rangeText, "0 km")
    }

    func testRangeGroupsThousandsInFeet() {
        // 450000 m / 0.3048 = 1,476,377.95 → round 1,476,378 (grouped).
        let projection = project(state, VehicleHeroUnitPrefs(distance: .feet))
        XCTAssertEqual(projection.rangeText, "1,476,378 ft")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(vehicleHeroConvertDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(vehicleHeroConvertTempFromSI(.infinity, to: .celsius), 0)
        XCTAssertEqual(VehicleHeroFormat.number(.nan, decimals: 1), "0.0")
    }
}

// MARK: - Status classification (FSM theme parity)

@MainActor
final class VehicleHeroStatusTests: XCTestCase {
    func testKnownStatesMapToToneAndLabel() {
        XCTAssertEqual(VehicleHeroStatus.classify("online").tone, .success)
        XCTAssertEqual(VehicleHeroStatus.classify("driving").tone, .info)
        XCTAssertEqual(VehicleHeroStatus.classify("charging").tone, .warning)
        XCTAssertEqual(VehicleHeroStatus.classify("parked").tone, .accent)
        XCTAssertEqual(VehicleHeroStatus.classify("updating").tone, .info)
        XCTAssertEqual(VehicleHeroStatus.classify("asleep").tone, .neutral)
        XCTAssertEqual(VehicleHeroStatus.classify("offline").tone, .danger)
        XCTAssertEqual(VehicleHeroStatus.classify("online").fallback, "Online")
        XCTAssertEqual(VehicleHeroStatus.classify("offline").key, "vehicle.state.offline")
    }

    func testCaseInsensitiveAndUnknownFallback() {
        XCTAssertEqual(VehicleHeroStatus.classify("PARKED").tone, .accent)
        let unknown = VehicleHeroStatus.classify("supercharging")
        XCTAssertEqual(unknown.tone, .neutral)
        XCTAssertTrue(unknown.key.isEmpty)
        XCTAssertEqual(unknown.fallback, "Supercharging")
    }
}

// MARK: - Layout resolution (web isCompact / isWide / isTall)

@MainActor
final class VehicleHeroLayoutTests: XCTestCase {
    func testCompactOnlyAtOneByOne() {
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 1, rows: 1), .compact)
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 0, rows: 0), .compact)
    }

    func testFullFlags() {
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 1, rows: 2), .full(isWide: false, isTall: true))
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 2, rows: 1), .full(isWide: false, isTall: false))
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 2, rows: 2), .full(isWide: false, isTall: true))
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 3, rows: 2), .full(isWide: true, isTall: true))
        XCTAssertEqual(VehicleHeroLayout.resolve(cols: 4, rows: 2), .full(isWide: true, isTall: true))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class VehicleHeroPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .loading, hasVehicle: false), .loading)
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .loading, hasVehicle: true), .content)
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .empty, hasVehicle: false), .empty)
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .empty, hasVehicle: true), .empty)
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .loaded, hasVehicle: false), .empty)
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .loaded, hasVehicle: true), .content)
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .failed("x"), hasVehicle: false), .error("x"))
        XCTAssertEqual(VehicleHeroModel.resolvePhase(status: .failed("x"), hasVehicle: true), .content)
    }
}

@MainActor
final class VehicleHeroModelTests: XCTestCase {
    private let vehicle = VehicleHeroVehicleDTO(displayName: "Bluebird", vin: "VIN", model: "Model 3")

    private func makeModel(
        _ update: VehicleHeroUpdate,
        telemetry: VehicleHeroTelemetry = OSLogVehicleHeroTelemetry()
    ) -> (VehicleHeroModel, InMemoryVehicleHeroSource) {
        let source = InMemoryVehicleHeroSource(initial: update)
        let model = VehicleHeroModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutVehicleShowsLoading() {
        let (model, _) = makeModel(VehicleHeroUpdate(status: .loading, vehicle: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutVehicleShowsEmpty() {
        let (model, _) = makeModel(VehicleHeroUpdate(status: .loaded, vehicle: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutVehicleShowsError() {
        let (model, _) = makeModel(VehicleHeroUpdate(status: .failed("boom"), vehicle: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testVehiclePresentShowsContentEvenWhileFailed() {
        let state = VehicleHeroStateDTO(statusRaw: "online", batteryLevel: 84, idealRangeMeters: 450_000)
        let (model, _) = makeModel(VehicleHeroUpdate(status: .failed("net"), vehicle: vehicle, state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.batteryText, "84%")
        XCTAssertEqual(model.projection?.rangeText, "450 km")
    }

    func testVehiclePresentWithoutStateRendersContentWithDashes() {
        let (model, _) = makeModel(VehicleHeroUpdate(status: .loaded, vehicle: vehicle, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.batteryText, "—")
        XCTAssertEqual(model.projection?.statusLabel, "Offline")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyVehicleHeroTelemetry()
        let (model, source) = makeModel(VehicleHeroUpdate(status: .loading, vehicle: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleHeroCardWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(VehicleHeroUpdate(status: .loaded, vehicle: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(VehicleHeroUpdate(status: .loaded, vehicle: vehicle))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(VehicleHeroUpdate(status: .loaded, connection: .stale, isFetching: true, vehicle: vehicle))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(VehicleHeroUpdate(status: .loaded, connection: .stale, isFetching: false, vehicle: vehicle))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUnitsTrackUpdates() {
        let (model, source) = makeModel(VehicleHeroUpdate(status: .loading, vehicle: nil))
        model.start()
        source.push(
            VehicleHeroUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: vehicle,
                state: VehicleHeroStateDTO(statusRaw: "online", idealRangeMeters: 161_000),
                units: VehicleHeroUnitPrefs(distance: .miles, temperature: .fahrenheit),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection?.distanceSymbol, "mi")
    }
}

// MARK: - Registry parity

@MainActor
final class VehicleHeroRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VehicleHeroCardWidget.registration
        XCTAssertEqual(registration.id, "vehicle-hero-card")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(VehicleHeroCardWidget.surfaceSlug, "VehicleHeroCardWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = VehicleHeroCardWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor
final class VehicleHeroAccessibilityTests: XCTestCase {
    private let vehicle = VehicleHeroVehicleDTO(displayName: "Bluebird", vin: "VIN", model: "Model 3")

    func testSummaryIncludesEveryReadout() {
        let projection = VehicleHeroProjector.project(
            vehicle: vehicle,
            state: VehicleHeroStateDTO(
                statusRaw: "online", batteryLevel: 84, idealRangeMeters: 450_000,
                insideTempCelsius: 21, outsideTempCelsius: 14
            ),
            units: VehicleHeroUnitPrefs()
        )
        XCTAssertEqual(
            VehicleHeroAccessibility.summary(for: projection),
            "Bluebird. Online. Battery 84%. Range 450 km. Cabin 21°C. Outside 14°C"
        )
    }

    func testSummaryAppendsChargingClause() {
        let projection = VehicleHeroProjector.project(
            vehicle: vehicle,
            state: VehicleHeroStateDTO(
                statusRaw: "charging", batteryLevel: 47, idealRangeMeters: 320_000,
                insideTempCelsius: 22, outsideTempCelsius: 9, isCharging: true, chargerPowerKilowatts: 11
            ),
            units: VehicleHeroUnitPrefs()
        )
        XCTAssertEqual(
            VehicleHeroAccessibility.summary(for: projection),
            "Bluebird. Charging. Battery 47%. Range 320 km. Cabin 22°C. Outside 9°C. Charging 11.0 kW"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVehicleHeroTelemetry: VehicleHeroTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
