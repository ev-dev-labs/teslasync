import Foundation
import XCTest
@testable import TeslaSync

/// Token storage contract: the in-memory store (deterministic) and a real
/// Keychain round-trip (skipped where the environment provides no keychain).
@MainActor final class KeychainTokenStoreTests: XCTestCase {
    func testInMemoryRoundTrip() throws {
        let store = InMemoryTokenStore()
        XCTAssertNil(try store.load())
        let tokens = AuthTokens.fixture()
        try store.save(tokens)
        XCTAssertEqual(try store.load(), tokens)
        try store.clear()
        XCTAssertNil(try store.load())
    }

    func testKeychainRoundTrip() throws {
        let configuration = KeychainConfiguration(
            service: "io.teslasync.app.tests.\(UUID().uuidString)",
            account: "token-set"
        )
        let store = KeychainTokenStore(configuration: configuration)
        let tokens = AuthTokens.fixture()
        do {
            try store.save(tokens)
        } catch let AuthError.keychain(status) {
            throw XCTSkip("Keychain unavailable in this environment (OSStatus \(status))")
        }
        defer { try? store.clear() }
        XCTAssertEqual(try store.load(), tokens)
        try store.clear()
        XCTAssertNil(try store.load())
    }
}
