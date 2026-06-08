import XCTest
@testable import TeslaSync

/// Tests the menu command hub's gating, confirmation, and action dispatch.
@MainActor final class AppCommandActionsTests: XCTestCase {
    func testRequestCommandNeedsAuthWhenSignedOut() {
        let actions = AppCommandActions()
        actions.isAuthenticated = false
        actions.requestCommand(.wake)
        XCTAssertNil(actions.pendingCommandConfirmation)
        XCTAssertEqual(actions.lastBlockedDecision, .needsAuthentication)
    }

    func testRequestCommandArmsConfirmationWhenAllowed() {
        let actions = AppCommandActions()
        actions.isAuthenticated = true
        actions.requestCommand(.wake)
        XCTAssertEqual(actions.pendingCommandConfirmation, .wake)
        XCTAssertNil(actions.lastBlockedDecision)
    }

    func testRequestCommandBlockedWhenNotPermitted() {
        let actions = AppCommandActions()
        actions.isAuthenticated = true
        actions.permittedCommands = [.lockDoors]
        actions.requestCommand(.wake)
        XCTAssertNil(actions.pendingCommandConfirmation)
        XCTAssertEqual(actions.lastBlockedDecision, .notPermitted)
    }

    func testConfirmRunsCommandAndClearsPending() {
        let actions = AppCommandActions()
        var ran: [VehicleCommandKind] = []
        actions.onRunCommand = { ran.append($0) }
        actions.isAuthenticated = true
        actions.requestCommand(.flashLights)
        actions.confirmPendingCommand()
        XCTAssertEqual(ran, [.flashLights])
        XCTAssertNil(actions.pendingCommandConfirmation)
    }

    func testCancelClearsPending() {
        let actions = AppCommandActions()
        actions.isAuthenticated = true
        actions.requestCommand(.wake)
        actions.cancelPendingCommand()
        XCTAssertNil(actions.pendingCommandConfirmation)
    }

    func testRefreshAndPrintInvokeClosures() {
        let actions = AppCommandActions()
        var refreshed = false
        var printed = false
        actions.onRefresh = { refreshed = true }
        actions.onPrint = { printed = true }
        actions.refresh()
        actions.triggerPrint()
        XCTAssertTrue(refreshed)
        XCTAssertTrue(printed)
    }
}
