import Foundation
import XCTest
@testable import TeslaSyncWatch

/// Round-trip + forward-compatibility for the cross-device payload and the envelope
/// that carries it over WatchConnectivity.
final class WatchSyncPayloadTests: XCTestCase {
    func testPayloadRoundTrip() throws {
        let payload = makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: Date(timeIntervalSince1970: 1_700_000_000)),
            settings: WatchSyncSettings(measurementSystem: .imperial, notificationsEnabled: false),
            isAuthenticated: true,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_500)
        )
        let data = try WatchSyncCoder.encode(payload)
        let decoded = WatchSyncCoder.decode(data)
        XCTAssertEqual(decoded, payload)
    }

    func testFutureSchemaRejected() throws {
        let payload = WatchSyncPayload(
            schemaVersion: WatchSyncPayload.currentSchemaVersion + 1,
            snapshot: nil,
            settings: .default,
            isAuthenticated: false,
            generatedAt: Date()
        )
        let data = try WatchSyncCoder.encode(payload)
        XCTAssertNil(WatchSyncCoder.decode(data), "a newer schema must not be misread")
    }

    func testSettingsLenientDecodeFillsDefaults() throws {
        let json = Data(#"{"measurementSystem":"imperial"}"#.utf8)
        let decoded = try JSONDecoder().decode(WatchSyncSettings.self, from: json)
        XCTAssertEqual(decoded.measurementSystem, .imperial)
        XCTAssertEqual(decoded.notificationsEnabled, WatchSyncSettings.default.notificationsEnabled)
        XCTAssertEqual(decoded.offlineCacheEnabled, WatchSyncSettings.default.offlineCacheEnabled)
    }

    func testEnvelopePayloadRoundTrip() {
        let payload = makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: Date(timeIntervalSince1970: 1_700_000_000)),
            isAuthenticated: true,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let context = WatchSyncEnvelope.context(for: payload)
        XCTAssertEqual(WatchSyncEnvelope.payload(from: context), payload)
    }

    func testEnvelopeCommandRoundTrip() {
        let request = WatchCommandRequest(
            id: "cmd-1",
            action: .lockDoors,
            requestedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let message = WatchSyncEnvelope.message(for: request)
        XCTAssertEqual(WatchSyncEnvelope.commandRequest(from: message), request)

        let result = WatchCommandResult(requestID: request.id, success: true, outcomeKey: "command.outcome.success")
        let resultMessage = WatchSyncEnvelope.message(for: result)
        XCTAssertEqual(WatchSyncEnvelope.commandResult(from: resultMessage), result)
    }

    func testEnvelopeRefreshRequest() {
        let message = WatchSyncEnvelope.refreshRequestMessage()
        XCTAssertTrue(WatchSyncEnvelope.isRefreshRequest(message))
        let commandMessage = WatchSyncEnvelope.message(for: WatchCommandRequest(action: .wake))
        XCTAssertFalse(WatchSyncEnvelope.isRefreshRequest(commandMessage))
    }
}
