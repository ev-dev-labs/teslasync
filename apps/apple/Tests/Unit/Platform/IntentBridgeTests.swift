import XCTest
@testable import TeslaSync

/// Round-trip + privacy tests for the cross-process intent bridge.
final class IntentBridgeTests: XCTestCase {
    private func freshBridge() -> IntentBridge {
        let defaults = UserDefaults(suiteName: "test.bridge.\(UUID().uuidString)")!
        return IntentBridge(defaults: defaults)
    }

    func testPendingRouteRoundTripAndSingleConsume() {
        let bridge = freshBridge()
        XCTAssertNil(bridge.consumePendingRoute())
        bridge.requestRoute(.charging)
        XCTAssertEqual(bridge.consumePendingRoute(), .charging)
        XCTAssertNil(bridge.consumePendingRoute(), "a route should only be consumed once")
    }

    func testPendingRouteParsesKebabSegment() {
        let bridge = freshBridge()
        bridge.requestRoute(.vehicleSystems)
        XCTAssertEqual(bridge.consumePendingRoute(), .vehicleSystems)
    }

    func testPendingCommandRoundTrip() {
        let bridge = freshBridge()
        XCTAssertNil(bridge.consumePendingCommand())
        let request = VehicleCommandRequest(kind: .lockDoors, vehicleID: "v1")
        bridge.enqueueCommand(request)
        XCTAssertEqual(bridge.consumePendingCommand(), request)
        XCTAssertNil(bridge.consumePendingCommand())
    }

    func testRefreshRequestRoundTrip() {
        let bridge = freshBridge()
        XCTAssertFalse(bridge.consumeRefreshRequest())
        bridge.requestRefresh()
        XCTAssertTrue(bridge.consumeRefreshRequest())
        XCTAssertFalse(bridge.consumeRefreshRequest())
    }

    func testAuthenticatedMirror() {
        let bridge = freshBridge()
        XCTAssertFalse(bridge.isAuthenticated)
        bridge.setAuthenticated(true)
        XCTAssertTrue(bridge.isAuthenticated)
    }

    func testPermittedCommandsRoundTrip() {
        let bridge = freshBridge()
        XCTAssertTrue(bridge.permittedCommands.isEmpty)
        bridge.setPermittedCommands([.wake, .startCharging])
        XCTAssertEqual(bridge.permittedCommands, [.wake, .startCharging])
    }

    func testClearWipesEverything() {
        let bridge = freshBridge()
        bridge.requestRoute(.energy)
        bridge.enqueueCommand(VehicleCommandRequest(kind: .wake))
        bridge.requestRefresh()
        bridge.setAuthenticated(true)
        bridge.setPermittedCommands([.wake])
        bridge.clear()
        XCTAssertNil(bridge.consumePendingRoute())
        XCTAssertNil(bridge.consumePendingCommand())
        XCTAssertFalse(bridge.consumeRefreshRequest())
        XCTAssertFalse(bridge.isAuthenticated)
        XCTAssertTrue(bridge.permittedCommands.isEmpty)
    }
}
