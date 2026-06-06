import XCTest
@testable import TeslaSync

/// App Group store tests: atomic round-trip, graceful absence, clearing PII, and the
/// forward-schema guard that makes an unreadable file resolve to `nil`.
final class WidgetSnapshotStoreTests: XCTestCase {
    func testSaveThenLoadRoundTrips() throws {
        let store = makeTempWidgetStore()
        addTeardownBlock { Self.cleanUp(store) }
        let sample = TeslaSyncWidgetSnapshot.sample()
        try store.save(sample)
        XCTAssertEqual(store.load(), sample)
    }

    func testLoadIsNilWhenAbsent() {
        let store = makeTempWidgetStore()
        addTeardownBlock { Self.cleanUp(store) }
        XCTAssertNil(store.load())
    }

    func testClearRemovesSnapshot() throws {
        let store = makeTempWidgetStore()
        addTeardownBlock { Self.cleanUp(store) }
        try store.save(.sample())
        store.clear()
        XCTAssertNil(store.load())
    }

    func testFutureSchemaLoadsNil() throws {
        let store = makeTempWidgetStore()
        addTeardownBlock { Self.cleanUp(store) }
        let future = TeslaSyncWidgetSnapshot(schemaVersion: 999, generatedAt: Date())
        try store.save(future)
        XCTAssertNil(store.load())
    }

    private static func cleanUp(_ store: WidgetSnapshotStore) {
        guard let directory = store.directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
