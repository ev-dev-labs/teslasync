import Foundation
import XCTest
@testable import TeslaSyncWatch

/// The snapshot → glance view-model mapping the watch UI binds to.
final class WatchGlanceDataTests: XCTestCase {
    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    func testNilSnapshotMapsToNil() {
        XCTAssertNil(WatchGlanceData(snapshot: nil))
    }

    func testEmptySnapshotMapsToNil() {
        let empty = TeslaSyncWidgetSnapshot.empty(generatedAt: reference)
        XCTAssertNil(WatchGlanceData(snapshot: empty), "no vehicle → honest empty state")
    }

    func testParkedMapping() throws {
        let snapshot = makeVehicleSnapshot(generatedAt: reference)
        let glance = try XCTUnwrap(WatchGlanceData(snapshot: snapshot))
        XCTAssertEqual(glance.vehicleName, "Model 3")
        XCTAssertEqual(glance.batteryDisplay, "72%")
        XCTAssertEqual(glance.rangeDisplay, "243 km")
        XCTAssertEqual(glance.state, .parked)
        XCTAssertFalse(glance.isCharging)
        XCTAssertNil(glance.chargeFinishBy)
        XCTAssertEqual(glance.isLocked, true)
        XCTAssertEqual(glance.isSentryOn, true)
        XCTAssertEqual(glance.insideTempDisplay, "21°")
    }

    func testChargingMapping() throws {
        let finish = reference.addingTimeInterval(1800)
        let snapshot = makeVehicleSnapshot(generatedAt: reference, isCharging: true, finishBy: finish)
        let glance = try XCTUnwrap(WatchGlanceData(snapshot: snapshot))
        XCTAssertEqual(glance.state, .charging)
        XCTAssertTrue(glance.isCharging)
        XCTAssertEqual(glance.chargeFinishBy, finish)
        XCTAssertEqual(glance.chargeAddedDisplay, "18 kWh")
    }

    func testPluggedMapping() throws {
        let snapshot = makeVehicleSnapshot(generatedAt: reference, isPluggedIn: true)
        let glance = try XCTUnwrap(WatchGlanceData(snapshot: snapshot))
        XCTAssertEqual(glance.state, .plugged)
    }

    func testUnknownClimateSecurityIsNil() throws {
        let snapshot = makeVehicleSnapshot(
            generatedAt: reference,
            isLocked: nil,
            isClimateOn: nil,
            isSentryOn: nil,
            insideTemp: nil
        )
        let glance = try XCTUnwrap(WatchGlanceData(snapshot: snapshot))
        XCTAssertNil(glance.isLocked)
        XCTAssertNil(glance.isClimateOn)
        XCTAssertNil(glance.isSentryOn)
        XCTAssertNil(glance.insideTempDisplay)
    }

    func testVehicleStateFromNilSnapshotIsUnknown() {
        XCTAssertEqual(WatchVehicleState(snapshot: nil), .unknown)
    }
}
