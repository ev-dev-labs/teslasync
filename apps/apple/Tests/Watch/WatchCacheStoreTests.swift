import Foundation
import XCTest
@testable import TeslaSyncWatch

/// Round-trip + clearing for the watch-local payload cache.
final class WatchCacheStoreTests: XCTestCase {
    func testSaveAndLoadRoundTrip() {
        let store = WatchCacheStore(defaults: makeEphemeralDefaults())
        let payload = makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: Date(timeIntervalSince1970: 1_700_000_000)),
            isAuthenticated: true,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        store.save(payload)
        XCTAssertEqual(store.load(), payload)
    }

    func testLoadEmptyReturnsNil() {
        let store = WatchCacheStore(defaults: makeEphemeralDefaults())
        XCTAssertNil(store.load())
    }

    func testClearRemovesPayload() {
        let defaults = makeEphemeralDefaults()
        let store = WatchCacheStore(defaults: defaults)
        store.save(makePayload(snapshot: nil, isAuthenticated: false, generatedAt: Date()))
        store.clear()
        XCTAssertNil(store.load())
    }
}
