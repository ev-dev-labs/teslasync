//
//  ScrollRestoration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  Unit coverage for the Foundation-only adapter primitives — the verbatim ports of the web building
//  blocks:
//    • ScrollRestorationKey — the `keyFor(pathname, search)` port (storage prefix, serialized key,
//      value equality / hashing).
//    • ScrollNavigationAction — the `useNavigationType()` port (POP / PUSH / REPLACE parsing,
//      case-insensitivity, unknown → nil, the "only POP restores" rule).
//    • SessionScrollPositionStore / UnavailableScrollPositionStore — the `window.sessionStorage` seam
//      (round-trip, missing → nil, the `Number.isFinite` read guard, clear, availability) and the inert
//      private-mode degrade.
//    • ScrollSaveThrottle — the `requestAnimationFrame` coalescing peer (first accept, drop-within,
//      accept-after, reset re-arm).
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store.
//

import XCTest
@testable import TeslaSync

// MARK: - ScrollRestorationKey (web keyFor)

final class ScrollRestorationKeyTests: XCTestCase {
    func testStoragePrefixMatchesWeb() {
        XCTAssertEqual(ScrollRestorationKey.storagePrefix, "teslasync.scroll:")
    }

    func testStorageKeyConcatenatesPrefixPathSearch() {
        let key = ScrollRestorationKey(path: "/drives", search: "?range=30d")
        XCTAssertEqual(key.storageKey, "teslasync.scroll:/drives?range=30d")
    }

    func testStorageKeyWithoutSearch() {
        XCTAssertEqual(ScrollRestorationKey(path: "/vehicles").storageKey, "teslasync.scroll:/vehicles")
    }

    func testKeyForBuildsEquivalentKey() {
        XCTAssertEqual(
            ScrollRestorationKey.keyFor(path: "/x", search: "?a=1"),
            ScrollRestorationKey(path: "/x", search: "?a=1")
        )
    }

    func testEqualityAndHashingKeyOnPathPlusSearch() {
        let lhs = ScrollRestorationKey(path: "/a", search: "?q=1")
        let rhs = ScrollRestorationKey(path: "/a", search: "?q=1")
        let other = ScrollRestorationKey(path: "/a", search: "?q=2")
        XCTAssertEqual(lhs, rhs)
        XCTAssertEqual(lhs.hashValue, rhs.hashValue)
        XCTAssertNotEqual(lhs, other)
    }
}

// MARK: - ScrollNavigationAction (web useNavigationType)

final class ScrollNavigationActionTests: XCTestCase {
    func testParsesCanonicalValues() {
        XCTAssertEqual(ScrollNavigationAction(rawNavigationType: "POP"), .pop)
        XCTAssertEqual(ScrollNavigationAction(rawNavigationType: "PUSH"), .push)
        XCTAssertEqual(ScrollNavigationAction(rawNavigationType: "REPLACE"), .replace)
    }

    func testParseIsCaseAndWhitespaceInsensitive() {
        XCTAssertEqual(ScrollNavigationAction(rawNavigationType: "pop"), .pop)
        XCTAssertEqual(ScrollNavigationAction(rawNavigationType: "  Push "), .push)
        XCTAssertEqual(ScrollNavigationAction(rawNavigationType: "Replace"), .replace)
    }

    func testUnknownValueReturnsNil() {
        XCTAssertNil(ScrollNavigationAction(rawNavigationType: ""))
        XCTAssertNil(ScrollNavigationAction(rawNavigationType: "FORWARD"))
    }

    func testOnlyPopRestoresSavedOffset() {
        XCTAssertTrue(ScrollNavigationAction.pop.restoresSavedOffset)
        XCTAssertFalse(ScrollNavigationAction.push.restoresSavedOffset)
        XCTAssertFalse(ScrollNavigationAction.replace.restoresSavedOffset)
    }
}

// MARK: - SessionScrollPositionStore (web sessionStorage)

@MainActor
final class SessionScrollPositionStoreTests: XCTestCase {
    private let key = ScrollRestorationKey(path: "/drives")

    func testIsAvailable() {
        XCTAssertTrue(SessionScrollPositionStore().isAvailable)
    }

    func testRoundTrip() {
        let store = SessionScrollPositionStore()
        store.setOffset(842.5, forKey: key)
        XCTAssertEqual(store.offset(forKey: key), 842.5)
    }

    func testMissingKeyReturnsNil() {
        XCTAssertNil(SessionScrollPositionStore().offset(forKey: key))
    }

    func testNonFiniteWritesAreDropped() {
        let store = SessionScrollPositionStore()
        store.setOffset(.nan, forKey: key)
        XCTAssertNil(store.offset(forKey: key), "NaN must never be restored (web Number.isFinite guard)")
        store.setOffset(.infinity, forKey: key)
        XCTAssertNil(store.offset(forKey: key), "Infinity must never be restored")
    }

    func testClearRemovesEverything() {
        let store = SessionScrollPositionStore()
        store.setOffset(10, forKey: key)
        store.clear()
        XCTAssertNil(store.offset(forKey: key))
    }

    func testLastWriteWins() {
        let store = SessionScrollPositionStore()
        store.setOffset(10, forKey: key)
        store.setOffset(20, forKey: key)
        XCTAssertEqual(store.offset(forKey: key), 20)
    }
}

// MARK: - UnavailableScrollPositionStore (web private-mode degrade)

@MainActor
final class UnavailableScrollPositionStoreTests: XCTestCase {
    func testIsNotAvailable() {
        XCTAssertFalse(UnavailableScrollPositionStore().isAvailable)
    }

    func testReadsAlwaysNilAndWritesAreNoOps() {
        let store = UnavailableScrollPositionStore()
        let key = ScrollRestorationKey(path: "/x")
        store.setOffset(123, forKey: key)
        XCTAssertNil(store.offset(forKey: key), "a disabled store can never restore (web try/catch degrade)")
    }
}

// MARK: - ScrollSaveThrottle (web requestAnimationFrame coalescing)

final class ScrollSaveThrottleTests: XCTestCase {
    func testFirstCallIsAccepted() {
        var throttle = ScrollSaveThrottle(minInterval: 0.016)
        XCTAssertTrue(throttle.accept(now: 0))
    }

    func testCallWithinIntervalIsDropped() {
        var throttle = ScrollSaveThrottle(minInterval: 0.016)
        _ = throttle.accept(now: 0)
        XCTAssertFalse(throttle.accept(now: 0.010))
    }

    func testCallAfterIntervalIsAccepted() {
        var throttle = ScrollSaveThrottle(minInterval: 0.016)
        _ = throttle.accept(now: 0)
        _ = throttle.accept(now: 0.010)
        XCTAssertTrue(throttle.accept(now: 0.020), "0.020 - 0 >= 0.016 → accept; drops never advance window")
    }

    func testResetReArmsImmediateAcceptance() {
        var throttle = ScrollSaveThrottle(minInterval: 0.016)
        _ = throttle.accept(now: 0.100)
        XCTAssertFalse(throttle.accept(now: 0.101))
        throttle.reset()
        XCTAssertTrue(throttle.accept(now: 0.101), "reset re-arms the final flush (web cleanup write)")
    }
}
