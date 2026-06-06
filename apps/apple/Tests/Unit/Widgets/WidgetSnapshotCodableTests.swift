import XCTest
@testable import TeslaSync

/// Codable / schema tests for the cached payload: lossless round-trip, an empty
/// envelope with no summaries, unit-interval clamping, and the forward-compatibility
/// guard that rejects a newer schema instead of misreading it.
final class WidgetSnapshotCodableTests: XCTestCase {
    func testRoundTripSample() throws {
        let sample = TeslaSyncWidgetSnapshot.sample()
        let data = try WidgetSnapshotCoder.encode(sample)
        let decoded = try WidgetSnapshotCoder.decode(data)
        XCTAssertEqual(decoded, sample)
    }

    func testEmptyHasNoSummaries() {
        let empty = TeslaSyncWidgetSnapshot.empty(generatedAt: Date(timeIntervalSince1970: 0))
        XCTAssertNil(empty.vehicle)
        XCTAssertNil(empty.charging)
        XCTAssertNil(empty.recentDrive)
        XCTAssertNil(empty.alerts)
        XCTAssertNil(empty.energy)
        XCTAssertNil(empty.systemHealth)
        XCTAssertTrue(empty.isReadable)
    }

    func testCurrentSchemaIsReadable() {
        XCTAssertEqual(TeslaSyncWidgetSnapshot.sample().schemaVersion, TeslaSyncWidgetSnapshot.currentSchemaVersion)
        XCTAssertTrue(TeslaSyncWidgetSnapshot.sample().isReadable)
    }

    func testFutureSchemaIsNotReadable() {
        let future = TeslaSyncWidgetSnapshot(
            schemaVersion: TeslaSyncWidgetSnapshot.currentSchemaVersion + 1,
            generatedAt: Date()
        )
        XCTAssertFalse(future.isReadable)
    }

    func testBatteryFractionClampedToUnitInterval() {
        let over = VehicleStatusSummary(
            vehicleName: "Car",
            batteryFraction: 2.5,
            batteryDisplay: "100%",
            rangeDisplay: "0 km",
            isCharging: false,
            isPluggedIn: false,
            locationLabel: nil,
            sampledAt: Date()
        )
        XCTAssertEqual(over.batteryFraction, 1.0)
    }
}
