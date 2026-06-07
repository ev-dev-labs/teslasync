import Foundation
import XCTest
@testable import TeslaSyncWatch

/// Guards the safety contract of the watch quick actions and the raw-value mapping
/// the phone relies on to reconstruct the command.
final class WatchQuickActionTests: XCTestCase {
    func testLocalActionsNeedNoAuthOrConfirmation() {
        for action in [WatchQuickAction.refresh, .openOnPhone] {
            XCTAssertFalse(action.isVehicleCommand)
            XCTAssertFalse(action.requiresAuthentication)
            XCTAssertFalse(action.requiresConfirmation)
        }
    }

    func testVehicleCommandsRequireAuthAndConfirmation() {
        for action in [WatchQuickAction.wake, .climateOn, .lockDoors, .flashLights] {
            XCTAssertTrue(action.isVehicleCommand)
            XCTAssertTrue(action.requiresAuthentication)
            XCTAssertTrue(action.requiresConfirmation)
        }
    }

    func testRawValuesMatchPhoneCommandKinds() {
        // These must stay identical to the phone's VehicleCommandKind raw values so
        // the relay reconstructs the command without a second mapping table.
        XCTAssertEqual(WatchQuickAction.wake.rawValue, "wake")
        XCTAssertEqual(WatchQuickAction.climateOn.rawValue, "climateOn")
        XCTAssertEqual(WatchQuickAction.lockDoors.rawValue, "lockDoors")
        XCTAssertEqual(WatchQuickAction.flashLights.rawValue, "flashLights")
    }

    func testMenuHasNoDuplicatesAndCoversCases() {
        XCTAssertEqual(Set(WatchQuickAction.menu).count, WatchQuickAction.menu.count)
        XCTAssertEqual(Set(WatchQuickAction.menu), Set(WatchQuickAction.allCases))
    }
}
