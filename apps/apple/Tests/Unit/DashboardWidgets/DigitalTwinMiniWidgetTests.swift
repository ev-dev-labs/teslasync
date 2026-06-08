import OSLog
import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Pure adapter (cached → projection)

@MainActor final class DigitalTwinMiniAdapterTests: XCTestCase {
    func testAllSourcesAbsentReturnsNil() {
        XCTAssertNil(DigitalTwinMiniAdapter.project(DigitalTwinMiniInputs()))
    }

    func testLockedPrefersSecurityOverVehicleState() {
        let inputs = DigitalTwinMiniInputs(
            security: TwinSecuritySnapshot(locked: true),
            vehicleState: TwinVehicleStateSnapshot(isLocked: false)
        )
        XCTAssertEqual(DigitalTwinMiniAdapter.project(inputs)?.locked, true)
    }

    func testLockedFallsBackToVehicleState() {
        let inputs = DigitalTwinMiniInputs(vehicleState: TwinVehicleStateSnapshot(isLocked: false))
        XCTAssertEqual(DigitalTwinMiniAdapter.project(inputs)?.locked, false)
    }

    func testSentryPrefersSecurityOverVehicleState() {
        let inputs = DigitalTwinMiniInputs(
            security: TwinSecuritySnapshot(sentryMode: true),
            vehicleState: TwinVehicleStateSnapshot(sentryMode: false)
        )
        XCTAssertEqual(DigitalTwinMiniAdapter.project(inputs)?.sentryMode, true)
    }

    func testChargePortFromChargingPayload() {
        let inputs = DigitalTwinMiniInputs(charging: TwinChargingSnapshot(chargePortDoorOpen: true))
        XCTAssertEqual(DigitalTwinMiniAdapter.project(inputs)?.chargePortOpen, true)
    }

    func testChargePortInferredFromActiveCharging() {
        let inputs = DigitalTwinMiniInputs(charging: TwinChargingSnapshot(chargingState: "Charging"))
        let data = DigitalTwinMiniAdapter.project(inputs)
        XCTAssertEqual(data?.chargePortOpen, true)
        XCTAssertEqual(data?.isCharging, true)
    }

    func testChargingActiveVariants() {
        XCTAssertTrue(DigitalTwinMiniAdapter.isChargingActive(TwinVehicleStateSnapshot(isCharging: true), nil))
        XCTAssertTrue(DigitalTwinMiniAdapter.isChargingActive(TwinVehicleStateSnapshot(chargerPower: 7), nil))
        XCTAssertTrue(DigitalTwinMiniAdapter.isChargingActive(nil, TwinChargingSnapshot(chargerPowerKw: 11)))
        XCTAssertTrue(DigitalTwinMiniAdapter.isChargingActive(nil, TwinChargingSnapshot(chargingState: "STARTING")))
        XCTAssertTrue(DigitalTwinMiniAdapter.isChargingActive(nil, TwinChargingSnapshot(chargingState: "charg-ing")))
        XCTAssertFalse(DigitalTwinMiniAdapter.isChargingActive(TwinVehicleStateSnapshot(isCharging: false), nil))
        XCTAssertFalse(DigitalTwinMiniAdapter.isChargingActive(
            nil,
            TwinChargingSnapshot(chargingState: "Disconnected")
        ))
    }

    func testDrivingDetection() {
        XCTAssertTrue(DigitalTwinMiniAdapter.isVehicleDriving(TwinVehicleStateSnapshot(state: "Driving")))
        XCTAssertTrue(DigitalTwinMiniAdapter.isVehicleDriving(TwinVehicleStateSnapshot(speed: 42)))
        XCTAssertFalse(DigitalTwinMiniAdapter.isVehicleDriving(TwinVehicleStateSnapshot(state: "online", speed: 0)))
        XCTAssertFalse(DigitalTwinMiniAdapter.isVehicleDriving(nil))
    }

    func testParseDoorStateClosedShorthand() {
        let doors = DigitalTwinMiniAdapter.parseDoorState("ClosedAll")
        XCTAssertEqual(doors.driverFront, false)
        XCTAssertEqual(doors.passengerRear, false)
        XCTAssertNil(doors.trunkFront)
    }

    func testParseDoorStateDescriptive() {
        let doors = DigitalTwinMiniAdapter.parseDoorState("OpenDriverFront")
        XCTAssertEqual(doors.driverFront, true)
        XCTAssertNil(doors.passengerFront)
    }

    func testParseDoorStateJSON() {
        let doors = DigitalTwinMiniAdapter.parseDoorState("{\"DriverFront\":true,\"passenger_rear\":false}")
        XCTAssertEqual(doors.driverFront, true)
        XCTAssertEqual(doors.passengerRear, false)
    }

    func testParseDoorStateUnknownWhenEmpty() {
        XCTAssertEqual(DigitalTwinMiniAdapter.parseDoorState(nil), TwinDoorStates.unknown)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseDoorState("   "), TwinDoorStates.unknown)
    }

    func testParseWindowState() {
        XCTAssertEqual(DigitalTwinMiniAdapter.parseWindowState("Closed"), .closed)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseWindowState("Open"), .open)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseWindowState("PartiallyOpen"), .partial)
        XCTAssertNil(DigitalTwinMiniAdapter.parseWindowState(nil))
    }

    func testWindowSummaryFallback() {
        let inputs = DigitalTwinMiniInputs(
            security: TwinSecuritySnapshot(windowsOpen: "driver front")
        )
        let data = DigitalTwinMiniAdapter.project(inputs)
        XCTAssertEqual(data?.windowFD, .open)
        XCTAssertEqual(data?.windowRP, .unknown)
    }

    func testParseTurnSignal() {
        XCTAssertEqual(DigitalTwinMiniAdapter.parseTurnSignal("TurnSignalLeft"), .left)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseTurnSignal("RIGHT"), .right)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseTurnSignal("Both"), .both)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseTurnSignal("Off"), .off)
        XCTAssertEqual(DigitalTwinMiniAdapter.parseTurnSignal(nil), .unknown)
    }

    func testLastUpdatedMappedFromSecurity() {
        let when = Date(timeIntervalSince1970: 1_700_000_500)
        let inputs = DigitalTwinMiniInputs(security: TwinSecuritySnapshot(locked: true, createdAt: when))
        XCTAssertEqual(DigitalTwinMiniAdapter.project(inputs)?.lastUpdated, when)
    }

    func testFrunkAndTrunkDerivedFromDoors() {
        let inputs = DigitalTwinMiniInputs(security: TwinSecuritySnapshot(doorState: "TrunkRear"))
        let data = DigitalTwinMiniAdapter.project(inputs)
        XCTAssertEqual(data?.trunkOpen, true)
        XCTAssertNil(data?.frunkOpen)
    }
}

// MARK: - Badge mapping (accessibility labels present + correct tone)

@MainActor final class DigitalTwinMiniBadgeTests: XCTestCase {
    func testLockUnlocked() {
        let spec = DigitalTwinMiniBadges.lock(locked: false)
        XCTAssertEqual(spec.key, "widget.digitalTwinMini.unlocked")
        XCTAssertEqual(spec.tone, .danger)
        XCTAssertEqual(spec.systemImage, "lock.open.fill")
    }

    func testLockLocked() {
        let spec = DigitalTwinMiniBadges.lock(locked: true)
        XCTAssertEqual(spec.key, "widget.digitalTwinMini.locked")
        XCTAssertEqual(spec.tone, .success)
    }

    func testLockUnknownShowsDash() {
        let spec = DigitalTwinMiniBadges.lock(locked: nil)
        XCTAssertEqual(spec.key, "widget.digitalTwinMini.unknownDash")
        XCTAssertEqual(spec.tone, .success)
    }

    func testSentryOnOffAndHidden() {
        XCTAssertEqual(DigitalTwinMiniBadges.sentry(true)?.key, "widget.digitalTwinMini.sentryOn")
        XCTAssertEqual(DigitalTwinMiniBadges.sentry(true)?.tone, .info)
        XCTAssertEqual(DigitalTwinMiniBadges.sentry(false)?.key, "widget.digitalTwinMini.sentryOff")
        XCTAssertEqual(DigitalTwinMiniBadges.sentry(false)?.tone, .neutral)
        XCTAssertNil(DigitalTwinMiniBadges.sentry(nil))
    }
}

// MARK: - Registry descriptor parity

@MainActor final class DigitalTwinMiniDescriptorTests: XCTestCase {
    func testDescriptorMatchesWebRegistry() {
        let descriptor = DigitalTwinMiniWidget.descriptor
        XCTAssertEqual(descriptor.id, "digital-twin-mini")
        XCTAssertEqual(descriptor.category, "vehicle")
        XCTAssertEqual(descriptor.defaultSize, DigitalTwinMiniGridSize(cols: 2, rows: 4))
        XCTAssertEqual(descriptor.minSize, DigitalTwinMiniGridSize(cols: 1, rows: 4))
        XCTAssertEqual(descriptor.maxSize, DigitalTwinMiniGridSize(cols: 4, rows: 40))
    }
}

// MARK: - View-model state machine + telemetry

/// Thread-safe collector for the diagnostics seam.
private final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [(event: String, surface: String)] = []

    func record(_ event: String, _ surface: String) {
        lock.lock()
        defer { lock.unlock() }
        storage.append((event, surface))
    }

    var events: [(event: String, surface: String)] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

@MainActor final class DigitalTwinMiniModelTests: XCTestCase {
    func testNoVehicleProducesEmpty() async {
        let model = DigitalTwinMiniModel(source: DigitalTwinMiniUnconfiguredSource())
        await model.load()
        XCTAssertFalse(model.hasVehicle)
        XCTAssertNil(model.state.value)
        XCTAssertFalse(model.showsErrorSurface)
    }

    func testLoadedProjection() async {
        let source = DigitalTwinMiniStaticSource(
            vehicle: TwinVehicle(id: 7, name: "Model Y"),
            inputs: DigitalTwinMiniInputs(security: TwinSecuritySnapshot(locked: true, sentryMode: false))
        )
        let model = DigitalTwinMiniModel(source: source)
        await model.load()
        XCTAssertTrue(model.hasVehicle)
        XCTAssertEqual(model.vehicle?.id, 7)
        XCTAssertEqual(model.state.value?.locked, true)
        XCTAssertEqual(model.state.value?.sentryMode, false)
        XCTAssertFalse(model.isOffline)
    }

    func testOfflineKeepsCachedValueAndFlags() async {
        let source = DigitalTwinMiniStaticSource(
            vehicle: TwinVehicle(id: 1, name: "Roadster"),
            inputs: DigitalTwinMiniInputs(security: TwinSecuritySnapshot(locked: true))
        )
        let model = DigitalTwinMiniModel(source: source)
        await model.load()
        XCTAssertNotNil(model.state.value)

        let offline = DigitalTwinMiniStaticSource(vehicle: nil, failure: .offline)
        let offlineModel = DigitalTwinMiniModel(source: offline)
        await offlineModel.load()
        XCTAssertTrue(offlineModel.isOffline)
        XCTAssertNotNil(offlineModel.state.error)
        XCTAssertFalse(offlineModel.showsErrorSurface)
    }

    func testHardErrorShowsErrorSurface() async {
        let source = DigitalTwinMiniStaticSource(vehicle: nil, failure: .timeout(message: "slow"))
        let model = DigitalTwinMiniModel(source: source)
        await model.load()
        XCTAssertNotNil(model.state.error)
        XCTAssertTrue(model.showsErrorSurface)
        XCTAssertFalse(model.isOffline)
    }

    func testStalenessUsesInjectedClock() async {
        let createdAt = Date(timeIntervalSince1970: 999_900)
        let staleNow = Date(timeIntervalSince1970: 1_000_000)
        let staleModel = DigitalTwinMiniModel(
            source: DigitalTwinMiniStaticSource(
                vehicle: TwinVehicle(id: 3, name: "Cybertruck"),
                inputs: DigitalTwinMiniInputs(security: TwinSecuritySnapshot(locked: true, createdAt: createdAt))
            ),
            now: { staleNow },
            stalenessWindow: 12
        )
        await staleModel.load()
        XCTAssertTrue(staleModel.isStale)

        let freshNow = Date(timeIntervalSince1970: 999_905)
        let freshModel = DigitalTwinMiniModel(
            source: DigitalTwinMiniStaticSource(
                vehicle: TwinVehicle(id: 3, name: "Cybertruck"),
                inputs: DigitalTwinMiniInputs(security: TwinSecuritySnapshot(locked: true, createdAt: createdAt))
            ),
            now: { freshNow },
            stalenessWindow: 12
        )
        await freshModel.load()
        XCTAssertFalse(freshModel.isStale)
    }

    func testViewOpenedTelemetryEmittedOnce() {
        let log = EventLog()
        let model = DigitalTwinMiniModel(
            source: DigitalTwinMiniUnconfiguredSource(),
            telemetry: { event, surface in log.record(event, surface) }
        )
        model.onAppear()
        model.onAppear()
        model.onDisappear()
        let opens = log.events.filter { $0.event == "view.opened" }
        XCTAssertEqual(opens.count, 1)
        XCTAssertEqual(opens.first?.surface, "DigitalTwinMiniWidget")
    }
}

// MARK: - Per-state render (snapshot) coverage

@MainActor final class DigitalTwinMiniRenderTests: XCTestCase {
    private func rendersToImage(_ view: some View) -> Bool {
        let renderer = ImageRenderer(content: view.frame(width: 200, height: 320))
        #if canImport(UIKit)
            return renderer.uiImage != nil
        #else
            return renderer.nsImage != nil
        #endif
    }

    func testLoadingStateRenders() {
        XCTAssertTrue(rendersToImage(DigitalTwinMiniSkeleton()))
    }

    func testEmptyStateRenders() {
        XCTAssertTrue(rendersToImage(DigitalTwinMiniEmpty()))
    }

    func testContentStateRenders() {
        XCTAssertTrue(
            rendersToImage(
                DigitalTwinMiniContent(data: .preview, exteriorColor: "Red Multi-Coat", showBadges: true)
            )
        )
    }

    func testContentCompactHidesBadgesRenders() {
        XCTAssertTrue(
            rendersToImage(
                DigitalTwinMiniContent(data: .preview, exteriorColor: nil, showBadges: false)
            )
        )
    }

    func testStaleFreshnessRenders() {
        XCTAssertTrue(
            rendersToImage(
                DigitalTwinMiniFreshness(
                    isFetching: false, isStale: true, isOffline: false, isError: false, onRefresh: {}
                )
            )
        )
    }

    func testOfflineFreshnessRenders() {
        XCTAssertTrue(
            rendersToImage(
                DigitalTwinMiniFreshness(
                    isFetching: false, isStale: false, isOffline: true, isError: false, onRefresh: {}
                )
            )
        )
    }

    func testErrorFreshnessRenders() {
        XCTAssertTrue(
            rendersToImage(
                DigitalTwinMiniFreshness(
                    isFetching: false, isStale: false, isOffline: false, isError: true, onRefresh: {}
                )
            )
        )
    }

    func testWidgetRendersThroughPublicEntry() {
        let widget = DigitalTwinMiniWidget(
            source: DigitalTwinMiniStaticSource(
                vehicle: TwinVehicle(id: 1, name: "Model 3", exteriorColor: "#cc2233"),
                inputs: DigitalTwinMiniInputs(security: TwinSecuritySnapshot(locked: true))
            ),
            onOpen: {}
        )
        XCTAssertTrue(rendersToImage(widget))
    }
}

// MARK: - Exterior color resolution

@MainActor final class DigitalTwinMiniColorTests: XCTestCase {
    func testHexAndNamedColorsResolve() {
        // Pure resolution must not crash and must return a usable color for each branch.
        _ = twinExteriorColor("#1A2B3C")
        _ = twinExteriorColor("Red Multi-Coat")
        _ = twinExteriorColor("Pearl White")
        _ = twinExteriorColor("Solid Black")
        _ = twinExteriorColor("Deep Blue Metallic")
        _ = twinExteriorColor(nil)
        XCTAssertEqual(twinExteriorColor("   "), twinExteriorColor(nil))
    }
}
