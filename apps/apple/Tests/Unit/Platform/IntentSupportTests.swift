import XCTest
@testable import TeslaSync

/// Tests intent support: error mapping, report routing, the vehicle entity
/// directory, and reading the cached snapshot.
@MainActor final class IntentSupportTests: XCTestCase {
    func testReportKindRoutes() {
        XCTAssertEqual(ReportKind.charging.route, .charging)
        XCTAssertEqual(ReportKind.driving.route, .driving)
        XCTAssertEqual(ReportKind.energy.route, .energy)
        XCTAssertEqual(ReportKind.battery.route, .energy)
        XCTAssertEqual(ReportKind.trips.route, .trips)
        XCTAssertEqual(ReportKind.allCases.count, 5)
    }

    func testGateErrorMapping() {
        XCTAssertNil(IntentGateError.error(for: .allowed, kind: .wake))
        XCTAssertEqual(
            IntentGateError.error(for: .needsAuthentication, kind: .wake)?.localizedStringResource,
            TeslaSyncIntentError.needsAuthentication.localizedStringResource
        )
        XCTAssertEqual(
            IntentGateError.error(for: .notPermitted, kind: .wake)?.localizedStringResource,
            TeslaSyncIntentError.notPermitted(.wake).localizedStringResource
        )
    }

    func testVehicleDirectoryRoundTrip() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "test.dir.\(UUID().uuidString)"))
        let store = VehicleDirectoryStore(defaults: defaults)
        XCTAssertTrue(store.load().isEmpty)
        let entries = [VehicleDirectoryEntry(id: "1", name: "Model 3"), VehicleDirectoryEntry(id: "2", name: "Model Y")]
        store.save(entries)
        XCTAssertEqual(store.load(), entries)
        store.clear()
        XCTAssertTrue(store.load().isEmpty)
    }

    func testVehicleEntityMapsFromDirectoryEntry() {
        let entity = VehicleEntity(VehicleDirectoryEntry(id: "7", name: "Roadster"))
        XCTAssertEqual(entity.id, "7")
        XCTAssertEqual(entity.name, "Roadster")
    }

    func testSnapshotReaderReturnsCachedCharging() throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("intent-snap-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = WidgetSnapshotStore(directory: dir)
        let snapshot = TeslaSyncWidgetSnapshot.sample()
        try store.save(snapshot)
        let read = IntentSnapshotReader.current(store: store)
        XCTAssertEqual(read?.charging?.batteryDisplay, snapshot.charging?.batteryDisplay)
    }

    func testSnapshotReaderReturnsNilWhenEmpty() {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("intent-empty-\(UUID().uuidString)", isDirectory: true)
        let store = WidgetSnapshotStore(directory: dir)
        XCTAssertNil(IntentSnapshotReader.current(store: store))
    }
}
