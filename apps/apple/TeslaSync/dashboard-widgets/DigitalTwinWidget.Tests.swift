//
//  DigitalTwinWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  Unit coverage for the DigitalTwinWidget surface:
//    • Adapter (cached → projection) — `TwinStateBuilder` / `VehicleTwinState`
//      parity with the web `lib/vehicleState.ts`.
//    • State holder — `DigitalTwinModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `vehicle-twin` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryDigitalTwinSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with lib/vehicleState.ts)

final class DigitalTwinAdapterTests: XCTestCase {
    func testEmptyWhenAllInputsNil() {
        let state = TwinStateBuilder.buildTwinState(security: nil, vehicleState: nil, charging: nil)
        XCTAssertEqual(state, .empty)
        XCTAssertFalse(state.isCharging)
        XCTAssertFalse(state.isDriving)
        XCTAssertNil(state.locked)
    }

    func testDescriptiveDoorTextParsesDriverFrontAndFrunk() {
        let doors = TwinStateBuilder.parseDoorState(.text("OpenDriverFront"))
        XCTAssertEqual(doors.driverFront, true)
        XCTAssertNil(doors.passengerFront)

        let frunk = TwinStateBuilder.parseDoorState(.text("FrunkOpen"))
        XCTAssertEqual(frunk.trunkFront, true)

        let trunk = TwinStateBuilder.parseDoorState(.text("LiftgateOpen"))
        XCTAssertEqual(trunk.trunkRear, true)
    }

    func testClosedAllShorthandResolvesAllDoorsClosed() {
        let doors = TwinStateBuilder.parseDoorState(.text("ClosedAll"))
        XCTAssertEqual(doors.driverFront, false)
        XCTAssertEqual(doors.passengerRear, false)
        XCTAssertNil(doors.trunkFront)
    }

    func testDoorFieldsObjectIsParsed() {
        let doors = TwinStateBuilder.parseDoorState(.fields(["DriverFront": true, "passenger_rear": false]))
        XCTAssertEqual(doors.driverFront, true)
        XCTAssertEqual(doors.passengerRear, false)
        XCTAssertNil(doors.driverRear)
    }

    func testDoorJSONStringIsParsed() {
        let doors = TwinStateBuilder.parseDoorState(.text("{\"DriverFront\":true,\"DriverRear\":false}"))
        XCTAssertEqual(doors.driverFront, true)
        XCTAssertEqual(doors.driverRear, false)
    }

    func testWindowStateParsing() {
        XCTAssertEqual(TwinStateBuilder.parseWindowState("Closed"), .closed)
        XCTAssertEqual(TwinStateBuilder.parseWindowState("WindowStateOpen"), .open)
        XCTAssertEqual(TwinStateBuilder.parseWindowState("Vent"), .partial)
        XCTAssertEqual(TwinStateBuilder.parseWindowState("0"), .closed)
        XCTAssertNil(TwinStateBuilder.parseWindowState(nil))
        XCTAssertNil(TwinStateBuilder.parseWindowState("   "))
    }

    func testTurnSignalParsing() {
        XCTAssertEqual(TwinStateBuilder.parseTurnSignal("TurnSignalLeft"), .left)
        XCTAssertEqual(TwinStateBuilder.parseTurnSignal("both"), .both)
        XCTAssertEqual(TwinStateBuilder.parseTurnSignal("Off"), .off)
        XCTAssertNil(TwinStateBuilder.parseTurnSignal(nil))
    }

    func testWindowsOpenSummaryFallback() {
        let security = TwinSecurityInput(windowsOpen: "driver_front")
        let state = TwinStateBuilder.buildTwinState(security: security, vehicleState: nil, charging: nil)
        XCTAssertEqual(state.windowFD, .open)
        XCTAssertNil(state.windowRP)
    }

    func testChargingActiveFromAnySource() {
        let viaFlag = TwinStateBuilder.buildTwinState(
            security: nil,
            vehicleState: TwinVehicleStateInput(isCharging: true),
            charging: nil
        )
        XCTAssertTrue(viaFlag.isCharging)
        XCTAssertEqual(viaFlag.chargePortOpen, true)

        let viaState = TwinStateBuilder.buildTwinState(
            security: nil,
            vehicleState: nil,
            charging: TwinChargingInput(chargingState: "Charging")
        )
        XCTAssertTrue(viaState.isCharging)

        let viaPower = TwinStateBuilder.buildTwinState(
            security: nil,
            vehicleState: nil,
            charging: TwinChargingInput(chargerPowerKw: 7.4)
        )
        XCTAssertTrue(viaPower.isCharging)
    }

    func testDrivingFromStateOrSpeed() {
        let viaState = TwinStateBuilder.buildTwinState(
            security: nil,
            vehicleState: TwinVehicleStateInput(state: "Driving"),
            charging: nil
        )
        XCTAssertTrue(viaState.isDriving)

        let viaSpeed = TwinStateBuilder.buildTwinState(
            security: nil,
            vehicleState: TwinVehicleStateInput(speed: 18),
            charging: nil
        )
        XCTAssertTrue(viaSpeed.isDriving)
    }

    func testLockFallsBackToVehicleState() {
        let state = TwinStateBuilder.buildTwinState(
            security: TwinSecurityInput(),
            vehicleState: TwinVehicleStateInput(isLocked: true),
            charging: nil
        )
        XCTAssertEqual(state.locked, true)
    }

    func testProjectionCounts() {
        let state = VehicleTwinState(
            doors: TwinDoorStates(driverFront: true, passengerFront: false, driverRear: true),
            windowFD: .open,
            windowFP: .closed,
            windowRD: .partial,
            windowRP: nil
        )
        XCTAssertTrue(state.hasWindowData)
        XCTAssertEqual(state.openWindowCount, 2)
        XCTAssertEqual(state.openDoorCount, 2)
    }

    func testFrunkAndTrunkDeriveFromDoors() {
        let state = TwinStateBuilder.buildTwinState(
            security: TwinSecurityInput(doorState: .fields(["TrunkFront": true, "TrunkRear": true])),
            vehicleState: nil,
            charging: nil
        )
        XCTAssertEqual(state.frunkOpen, true)
        XCTAssertEqual(state.trunkOpen, true)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class DigitalTwinModelTests: XCTestCase {
    private func makeModel(
        _ update: DigitalTwinUpdate,
        telemetry: DigitalTwinTelemetry = OSLogDigitalTwinTelemetry()
    ) -> (DigitalTwinModel, InMemoryDigitalTwinSource) {
        let source = InMemoryDigitalTwinSource(initial: update)
        let model = DigitalTwinModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutVehicleShowsLoading() {
        let (model, _) = makeModel(DigitalTwinUpdate(status: .loading, vehicle: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutVehicleShowsEmpty() {
        let (model, _) = makeModel(DigitalTwinUpdate(status: .loaded, vehicle: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(DigitalTwinUpdate(status: .failed("boom"), vehicle: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testVehiclePresentShowsContentEvenWhileFetchingOrFailed() {
        let vehicle = TwinVehicle(id: 7, displayName: "Roadster")
        let (loading, _) = makeModel(DigitalTwinUpdate(status: .loading, vehicle: vehicle))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(DigitalTwinUpdate(status: .failed("net"), vehicle: vehicle))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDigitalTwinTelemetry()
        let (model, source) = makeModel(DigitalTwinUpdate(status: .loading, vehicle: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DigitalTwinWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DigitalTwinUpdate(status: .loaded, vehicle: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DigitalTwinUpdate(status: .loading, vehicle: nil))
        model.start()
        source.push(
            DigitalTwinUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: TwinVehicle(id: 3, displayName: "Cybertruck"),
                security: TwinSecurityInput(locked: true),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.twin.locked, true)
    }

    func testTwinSizeThreshold() {
        XCTAssertEqual(DigitalTwinModel.twinSize(for: DashboardWidgetSize(cols: 2, rows: 4)), .sm)
        XCTAssertEqual(DigitalTwinModel.twinSize(for: DashboardWidgetSize(cols: 3, rows: 4)), .md)
        XCTAssertEqual(DigitalTwinModel.twinSize(for: DashboardWidgetSize(cols: 2, rows: 5)), .md)
    }
}

// MARK: - Registry parity

final class DigitalTwinRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DigitalTwinWidget.registration
        XCTAssertEqual(registration.id, "vehicle-twin")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DigitalTwinWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class DigitalTwinAccessibilityTests: XCTestCase {
    func testSummaryIncludesLockWindowAndStateLabels() {
        let state = VehicleTwinState(
            windowFD: .open,
            windowFP: .closed,
            windowRD: .closed,
            windowRP: .closed,
            isCharging: true,
            isDriving: true,
            locked: true,
            sentryMode: true
        )
        let summary = DigitalTwinAccessibility.summary(for: state)
        XCTAssertTrue(summary.contains("Locked"))
        XCTAssertTrue(summary.contains("1 Open"))
        XCTAssertTrue(summary.contains("Driving"))
        XCTAssertTrue(summary.contains("Charging"))
        XCTAssertTrue(summary.contains("Sentry"))
    }

    func testSummaryHandlesUnknownState() {
        let summary = DigitalTwinAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("Lock Unknown"))
        XCTAssertTrue(summary.contains("Windows Unknown"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDigitalTwinTelemetry: DigitalTwinTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
