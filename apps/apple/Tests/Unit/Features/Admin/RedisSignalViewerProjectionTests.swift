import XCTest
@testable import TeslaSync

/// Pure projection tests for the Redis Signal Viewer value types — the web `categorizeSignal`
/// buckets + `CATEGORY_COLORS` tone map, the anchored `isLocationSignal`, the vehicle-label
/// fallback, the value type/display coercion, the display formatters, and the by-name row sort.
/// Split from the model state-machine suite to keep each file focused and within length limits.
final class RedisSignalViewerProjectionTests: XCTestCase {
    func testCategorizeMatchesWebBuckets() {
        XCTAssertEqual(RedisSignalCategory.categorize("battery_level"), .battery)
        XCTAssertEqual(RedisSignalCategory.categorize("bms_state"), .battery)
        XCTAssertEqual(RedisSignalCategory.categorize("pack_voltage"), .battery)
        XCTAssertEqual(RedisSignalCategory.categorize("ac_charging_power"), .charging)
        XCTAssertEqual(RedisSignalCategory.categorize("charge_state"), .charging)
        XCTAssertEqual(RedisSignalCategory.categorize("vehicle_speed"), .driving)
        XCTAssertEqual(RedisSignalCategory.categorize("odometer"), .driving)
        XCTAssertEqual(RedisSignalCategory.categorize("latitude"), .driving)
        XCTAssertEqual(RedisSignalCategory.categorize("inside_temp"), .climate)
        XCTAssertEqual(RedisSignalCategory.categorize("hvac_on"), .climate)
        XCTAssertEqual(RedisSignalCategory.categorize("software_version"), .other)
    }

    func testCategoryTonesMatchWebColorMap() {
        XCTAssertEqual(RedisSignalCategory.battery.tone, .success)
        XCTAssertEqual(RedisSignalCategory.charging.tone, .info)
        XCTAssertEqual(RedisSignalCategory.driving.tone, .warning)
        XCTAssertEqual(RedisSignalCategory.climate.tone, .danger)
        XCTAssertEqual(RedisSignalCategory.other.tone, .neutral)
    }

    func testIsLocationSignalIsAnchored() {
        XCTAssertTrue(RedisSignalRow(name: "latitude", value: .number(1)).isLocation)
        XCTAssertTrue(RedisSignalRow(name: "gps_lat", value: .number(1)).isLocation)
        XCTAssertTrue(RedisSignalRow(name: "location_lng", value: .number(1)).isLocation)
        // Not anchored full matches — must stay unmasked.
        XCTAssertFalse(RedisSignalRow(name: "latitude_raw", value: .number(1)).isLocation)
        XCTAssertFalse(RedisSignalRow(name: "battery_level", value: .number(1)).isLocation)
    }

    func testVehicleLabelFallback() {
        XCTAssertEqual(RedisSignalVehicle(id: 7, displayName: "Roadster", vin: "V").label, "Roadster")
        XCTAssertEqual(RedisSignalVehicle(id: 7, displayName: nil, vin: "5YJ").label, "5YJ")
        XCTAssertEqual(RedisSignalVehicle(id: 7, displayName: "", vin: "").label, "Vehicle 7")
    }

    func testValueTypeLabelAndDisplay() {
        XCTAssertEqual(RedisSignalValue.number(42).typeLabel, "number")
        XCTAssertEqual(RedisSignalValue.string("x").typeLabel, "string")
        XCTAssertEqual(RedisSignalValue.boolean(true).typeLabel, "boolean")
        XCTAssertEqual(RedisSignalValue.number(42).display, "42")
        XCTAssertEqual(RedisSignalValue.number(42.5).display, "42.5")
        XCTAssertEqual(RedisSignalValue.boolean(false).display, "false")
        XCTAssertEqual(RedisSignalValue.string("Disconnected").display, "Disconnected")
    }

    func testFormatters() {
        XCTAssertEqual(RedisSignalFormat.int(1234), "1,234")
        XCTAssertEqual(RedisSignalFormat.int(0), "0")
        XCTAssertEqual(RedisSignalFormat.numberValue(42), "42")
        XCTAssertEqual(RedisSignalFormat.numberValue(42.5), "42.5")
        XCTAssertEqual(RedisSignalFormat.numberValue(-122.084097), "-122.084097")
    }

    func testSnapshotSortsRowsByName() {
        let snap = RedisSignalsSnapshot(
            vehicleID: 1,
            signalCount: 3,
            rows: [
                RedisSignalRow(name: "charge_state", value: .string("x")),
                RedisSignalRow(name: "battery_level", value: .number(1)),
                RedisSignalRow(name: "odometer", value: .number(2))
            ]
        )
        XCTAssertEqual(snap.rows.map(\.name), ["battery_level", "charge_state", "odometer"])
    }
}
