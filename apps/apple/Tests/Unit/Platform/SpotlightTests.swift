import CoreSpotlight
import XCTest
@testable import TeslaSync

/// Spy index recording what the Spotlight indexer asks it to do. A lock-guarded
/// class (not an actor) so the non-`Sendable` `CSSearchableItem`s never cross an
/// isolation boundary — matching the production struct's nonisolated shape.
private final class SpyIndex: SearchableIndexing, @unchecked Sendable {
    private let lock = NSLock()
    private var _indexed: [CSSearchableItem] = []
    private var _deletedDomains: [String] = []

    var indexed: [CSSearchableItem] {
        lock.lock(); defer { lock.unlock() }; return _indexed
    }

    var deletedDomains: [String] {
        lock.lock(); defer { lock.unlock() }; return _deletedDomains
    }

    func index(_ items: [CSSearchableItem]) async throws {
        addIndexed(items)
    }

    func deleteAll(withDomainIdentifiers domainIdentifiers: [String]) async throws {
        addDeleted(domainIdentifiers)
    }

    private func addIndexed(_ items: [CSSearchableItem]) {
        lock.lock(); _indexed += items; lock.unlock()
    }

    private func addDeleted(_ domains: [String]) {
        lock.lock(); _deletedDomains += domains; lock.unlock()
    }
}

/// Tests Spotlight route indexing (privacy-gated) and the recent-routes store.
@MainActor
final class SpotlightTests: XCTestCase {
    func testItemCarriesRouteIdentity() {
        let item = SpotlightIndexer.item(for: .charging)
        XCTAssertEqual(item.uniqueIdentifier, "charging")
        XCTAssertEqual(item.domainIdentifier, SpotlightIndexer.domain)
    }

    func testIndexableRoutesExcludeShells() {
        let routes = SpotlightIndexer.indexableRoutes
        XCTAssertFalse(routes.contains(.onboarding))
        XCTAssertFalse(routes.contains(.search))
        XCTAssertFalse(routes.contains(.explore))
        XCTAssertTrue(routes.contains(.charging))
    }

    func testReindexEnabledIndexesItems() async {
        let spy = SpyIndex()
        let indexer = SpotlightIndexer(index: spy)
        await indexer.reindex(routes: [.charging, .energy], enabled: true)
        XCTAssertEqual(spy.indexed.count, 2)
        XCTAssertTrue(spy.deletedDomains.isEmpty)
    }

    func testReindexDisabledDeletesDomain() async {
        let spy = SpyIndex()
        let indexer = SpotlightIndexer(index: spy)
        await indexer.reindex(routes: [.charging], enabled: false)
        XCTAssertTrue(spy.indexed.isEmpty)
        XCTAssertEqual(spy.deletedDomains, [SpotlightIndexer.domain])
    }

    func testRouteFromSearchableItemActivity() {
        let activity = NSUserActivity(activityType: CSSearchableItemActionType)
        activity.userInfo = [CSSearchableItemActivityIdentifier: "charging"]
        XCTAssertEqual(SpotlightIndexer.route(fromSearchableItemActivity: activity), .charging)
    }

    func testRouteFromWrongActivityTypeIsNil() {
        let activity = NSUserActivity(activityType: "other")
        activity.userInfo = [CSSearchableItemActivityIdentifier: "charging"]
        XCTAssertNil(SpotlightIndexer.route(fromSearchableItemActivity: activity))
    }

    // MARK: Recent routes

    private func freshRecents(max: Int = 3) -> RecentRoutesStore {
        RecentRoutesStore(maxCount: max, defaults: UserDefaults(suiteName: "test.recents.\(UUID().uuidString)")!)
    }

    func testRecordOrdersMostRecentFirst() {
        let store = freshRecents()
        store.record(.dashboard)
        store.record(.charging)
        XCTAssertEqual(store.recents, [.charging, .dashboard])
    }

    func testRecordDeduplicatesToFront() {
        let store = freshRecents()
        store.record(.dashboard)
        store.record(.charging)
        store.record(.dashboard)
        XCTAssertEqual(store.recents, [.dashboard, .charging])
    }

    func testRecordRespectsCap() {
        let store = freshRecents(max: 2)
        store.record(.dashboard)
        store.record(.charging)
        store.record(.energy)
        XCTAssertEqual(store.recents, [.energy, .charging])
    }

    func testRecordDisabledIsNoOp() {
        let store = freshRecents()
        store.record(.dashboard, enabled: false)
        XCTAssertTrue(store.recents.isEmpty)
    }

    func testClearEmptiesRecents() {
        let store = freshRecents()
        store.record(.dashboard)
        store.clear()
        XCTAssertTrue(store.recents.isEmpty)
    }
}
