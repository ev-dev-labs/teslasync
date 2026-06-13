//
//  SearchInput.StoreTests.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The persistence-seam coverage — the native parity of the web `@/lib/searchHistory` `localStorage`
//  envelope: the `UserDefaults`-backed production store (round-trip record/recent, de-dup, scope isolation,
//  remove, clear, and the resilient decode that degrades malformed JSON to an empty store) and the
//  in-memory double (engine-backed semantics + mutation counters for previews / tests). Split from the
//  other test files for the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest
//  targets; each `UserDefaults` test uses an isolated scratch suite and tears it down.
//

import XCTest
@testable import TeslaSync

// MARK: - UserDefaults store (web `localStorage` envelope)

final class SearchInputUserDefaultsStoreTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "SearchInputStoreTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    private func makeStore(now: @escaping @Sendable () -> Double = { 1 }) -> UserDefaultsSearchInputHistoryStore {
        UserDefaultsSearchInputHistoryStore(defaults: defaults, now: now)
    }

    func testRecordThenRecentRoundTrips() {
        let store = makeStore()
        store.record(scope: "drives", query: "Supercharger")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["Supercharger"])
    }

    func testRecentNewestFirstAndDeduplicates() {
        let clock = MonotonicClock()
        let store = makeStore(now: { clock.next() })
        store.record(scope: "drives", query: "alpha")
        store.record(scope: "drives", query: "bravo")
        store.record(scope: "drives", query: "alpha")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["alpha", "bravo"])
    }

    func testScopesAreIsolated() {
        let store = makeStore()
        store.record(scope: "drives", query: "road trip")
        store.record(scope: "charging", query: "home plug")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["road trip"])
        XCTAssertEqual(store.recent(scope: "charging", max: 8), ["home plug"])
    }

    func testRecordIgnoresShortQuery() {
        let store = makeStore()
        store.record(scope: "drives", query: "a")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), [])
    }

    func testRemoveDeletesMatchingEntry() {
        let store = makeStore()
        store.record(scope: "drives", query: "keep")
        store.record(scope: "drives", query: "drop")
        store.remove(scope: "drives", query: "DROP")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["keep"])
    }

    func testClearWipesScopeOnly() {
        let store = makeStore()
        store.record(scope: "drives", query: "gone")
        store.record(scope: "charging", query: "stays")
        store.clear(scope: "drives")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), [])
        XCTAssertEqual(store.recent(scope: "charging", max: 8), ["stays"])
    }

    func testEmptyScopeIsANoOp() {
        let store = makeStore()
        store.record(scope: "", query: "ignored")
        XCTAssertEqual(store.recent(scope: "", max: 8), [])
    }

    func testResilientToMalformedPayload() {
        defaults.set(Data("not json".utf8), forKey: UserDefaultsSearchInputHistoryStore.storageKey)
        let store = makeStore()
        XCTAssertEqual(store.recent(scope: "drives", max: 8), [], "malformed JSON degrades to empty")
        // And a subsequent write still succeeds over the garbage.
        store.record(scope: "drives", query: "recovered")
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["recovered"])
    }

    func testUsesWebStorageKey() {
        XCTAssertEqual(UserDefaultsSearchInputHistoryStore.storageKey, "teslasync:search-history:v1")
    }
}

// MARK: - In-memory store (previews + tests)

final class SearchInputInMemoryStoreTests: XCTestCase {
    func testConvenienceSeedPreservesOrder() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["first", "second", "third"])
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["first", "second", "third"])
    }

    func testRecordCountsAndOrders() {
        let store = InMemorySearchInputHistoryStore()
        store.record(scope: "drives", query: "alpha")
        store.record(scope: "drives", query: "bravo")
        XCTAssertEqual(store.recordCount, 2)
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["bravo", "alpha"])
    }

    func testRemoveAndClearCounts() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["keep", "drop"])
        store.remove(scope: "drives", query: "drop")
        XCTAssertEqual(store.removeCount, 1)
        XCTAssertEqual(store.recent(scope: "drives", max: 8), ["keep"])
        store.clear(scope: "drives")
        XCTAssertEqual(store.clearCount, 1)
        XCTAssertEqual(store.recent(scope: "drives", max: 8), [])
    }

    func testEmptyScopeIsANoOp() {
        let store = InMemorySearchInputHistoryStore()
        store.record(scope: "", query: "ignored")
        XCTAssertEqual(store.recordCount, 0)
        XCTAssertEqual(store.recent(scope: "", max: 8), [])
    }
}

// MARK: - Test double

/// A monotonic millisecond clock for the `UserDefaults` store's injectable `now` seam. A reference type so
/// it can be captured by the store's `@Sendable` clock closure under Swift 6 strict concurrency; lock-guarded
/// so each `record` reads a strictly-increasing timestamp deterministically.
private final class MonotonicClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0.0

    func next() -> Double {
        lock.withLock {
            value += 1
            return value
        }
    }
}
