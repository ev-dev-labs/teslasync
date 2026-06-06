import XCTest
@testable import TeslaSync

/// Publisher tests: redaction is enforced on the way into the cache (no VIN, no
/// coordinates) and a `WidgetCenter` reload fires on publish and clear.
final class WidgetPublisherTests: XCTestCase {
    func testPublishRedactsAndReloads() {
        let store = makeTempWidgetStore()
        let counter = ReloadCounter()
        addTeardownBlock { Self.cleanUp(store) }
        let publisher = WidgetSnapshotPublisher(store: store, reload: { counter.increment() })

        let vehicle = VehicleStatusSummary(
            vehicleName: "Tesla 5YJ3E1EA7KF000000",
            batteryFraction: 0.5,
            batteryDisplay: "50%",
            rangeDisplay: "100 km",
            isCharging: false,
            isPluggedIn: false,
            locationLabel: "37.7749, -122.4194",
            sampledAt: Date()
        )
        let snapshot = TeslaSyncWidgetSnapshot(generatedAt: Date(), vehicle: vehicle)

        XCTAssertTrue(publisher.publish(snapshot))
        XCTAssertEqual(counter.count, 1)

        let loaded = store.load()
        XCTAssertNotNil(loaded?.vehicle)
        XCTAssertEqual(loaded?.vehicle?.vehicleName.contains("5YJ3E1EA7KF000000"), false)
        XCTAssertNil(loaded?.vehicle?.locationLabel)
    }

    func testClearReloads() {
        let store = makeTempWidgetStore()
        let counter = ReloadCounter()
        addTeardownBlock { Self.cleanUp(store) }
        let publisher = WidgetSnapshotPublisher(store: store, reload: { counter.increment() })
        publisher.clear()
        XCTAssertEqual(counter.count, 1)
    }

    private static func cleanUp(_ store: WidgetSnapshotStore) {
        guard let directory = store.directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
