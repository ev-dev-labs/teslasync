import XCTest
@testable import TeslaSync

/// Tests the command domain: kind metadata, the safety gate, the request shape,
/// and the executor seams.
@MainActor
final class VehicleCommandTests: XCTestCase {
    func testAllKindsHaveMetadataAndConfirm() {
        XCTAssertEqual(VehicleCommandKind.allCases.count, 13)
        for kind in VehicleCommandKind.allCases {
            XCTAssertFalse(kind.systemImage.isEmpty, "\(kind) missing glyph")
            XCTAssertTrue(kind.requiresConfirmation, "every actuation must confirm")
        }
    }

    func testSensitiveCommands() {
        XCTAssertTrue(VehicleCommandKind.unlockDoors.isSensitive)
        XCTAssertTrue(VehicleCommandKind.ventWindows.isSensitive)
        XCTAssertTrue(VehicleCommandKind.openChargePort.isSensitive)
        XCTAssertFalse(VehicleCommandKind.lockDoors.isSensitive)
        XCTAssertFalse(VehicleCommandKind.wake.isSensitive)
    }

    func testCommonShortcutCommandsAreValidSubset() {
        let all = Set(VehicleCommandKind.allCases)
        XCTAssertTrue(Set(VehicleCommandKind.commonShortcutCommands).isSubset(of: all))
        XCTAssertTrue(VehicleCommandKind.commonShortcutCommands.contains(.wake))
    }

    func testGateNeedsAuthenticationWhenSignedOut() {
        let decision = VehicleCommandGate.evaluate(.wake, isAuthenticated: false, permitted: [])
        XCTAssertEqual(decision, .needsAuthentication)
    }

    func testGateAllowsWhenAuthenticatedAndPermissionsUnknown() {
        // An empty permitted set means "unknown" and must not block; the server is
        // still authoritative when the command runs.
        let decision = VehicleCommandGate.evaluate(.wake, isAuthenticated: true, permitted: [])
        XCTAssertEqual(decision, .allowed)
    }

    func testGateAllowsWhenPermitted() {
        let decision = VehicleCommandGate.evaluate(.lockDoors, isAuthenticated: true, permitted: [.lockDoors, .wake])
        XCTAssertEqual(decision, .allowed)
    }

    func testGateBlocksWhenNotPermitted() {
        let decision = VehicleCommandGate.evaluate(.unlockDoors, isAuthenticated: true, permitted: [.wake])
        XCTAssertEqual(decision, .notPermitted)
    }

    func testRequestCodableRoundTripAndDefaults() throws {
        let request = VehicleCommandRequest(kind: .startCharging, vehicleID: "abc")
        XCTAssertFalse(request.id.isEmpty)
        let data = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(VehicleCommandRequest.self, from: data)
        XCTAssertEqual(decoded, request)
    }

    func testUnavailableCommanderReportsUnavailable() async {
        let outcome = await UnavailableVehicleCommanding().perform(VehicleCommandRequest(kind: .wake))
        XCTAssertEqual(outcome, .unavailable)
    }

    func testPreviewCommanderRecordsAndReturnsOutcome() async {
        let commander = PreviewVehicleCommanding(outcome: .success)
        let request = VehicleCommandRequest(kind: .flashLights)
        let outcome = await commander.perform(request)
        XCTAssertEqual(outcome, .success)
        XCTAssertEqual(commander.received, [request])
    }

    func testOutcomeMessageKeys() {
        XCTAssertEqual(VehicleCommandOutcome.success.messageKey, "command.outcome.success")
        XCTAssertEqual(VehicleCommandOutcome.unavailable.messageKey, "command.outcome.unavailable")
        XCTAssertEqual(VehicleCommandOutcome.failed(reasonKey: "x").messageKey, "x")
    }
}
