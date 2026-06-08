import XCTest
@testable import TeslaSync

/// The live-data store: foreground-only lifecycle, cache/live merge, staleness,
/// `Last-Event-ID` resume, and the single 401-refresh + retry policy. Driven by a
/// scripted `AsyncStream` provider so every transition is deterministic.
@MainActor final class LiveDataStoreTests: XCTestCase {
    private typealias Provider = ScriptedLiveStreamProvider<LiveFleetEvent>
    private typealias Store = LiveDataStore<LiveDemoSnapshot, LiveFleetEvent>

    private func makeStore(
        _ provider: Provider,
        auth: (any AuthChallengeHandling)? = nil
    ) -> Store {
        Store(
            target: .vehicle(id: 1),
            provider: provider.makeProvider(),
            auth: auth,
            isEmpty: { $0.updateCount == 0 },
            sleep: { _ in },
            reduce: LiveDemoSnapshot.reduce
        )
    }

    // MARK: Lifecycle gating

    func testConnectsOnlyWhenSceneActiveAndVisible() async {
        let provider = Provider(episodes: [.init([.connection(.open)], finishes: false)])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.setScenePhaseActive(true)
        await liveWaitUntil(timeout: 0.2) { provider.openCount > 0 }
        XCTAssertEqual(provider.openCount, 0, "Scene active but no visible view must not connect")

        store.setViewVisible(true)
        await liveWaitUntil { store.phase == .open }
        XCTAssertEqual(provider.openCount, 1)
        XCTAssertTrue(store.isActive)
    }

    func testOpenDeliversContentAndGoesLive() async {
        let provider = Provider(episodes: [
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "e1", value: 80)], finishes: false)
        ])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.value?.updateCount == 1 }
        XCTAssertEqual(store.value?.lastValue, "80")
        XCTAssertEqual(store.phase, .open)
        XCTAssertTrue(store.status.isLive)
        XCTAssertEqual(store.presentation, .fresh)
        XCTAssertEqual(store.lastEventID, "e1")
    }

    // MARK: Staleness

    func testStaleTransitionFlagsStaleAndKeepsContent() async {
        let provider = Provider(episodes: [
            .init([
                .connection(.open),
                LiveTestEvents.vehicleUpdate(id: "e1", value: 55),
                .connection(.stale)
            ], finishes: false)
        ])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.phase == .stale }
        XCTAssertTrue(store.isStale)
        XCTAssertEqual(store.value?.updateCount, 1, "Stale must keep last-known values visible")
        XCTAssertEqual(store.presentation, .stale)
        XCTAssertFalse(store.status.isLive)
    }

    // MARK: Errors / reconnect

    func testNonRetryableErrorWithoutContentShowsError() async {
        let provider = Provider(episodes: [
            .init([.connection(.open), .failed(.decode(message: "bad"))], finishes: true)
        ])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.error != nil }
        XCTAssertEqual(store.error, .decode(message: "bad"))
        XCTAssertEqual(store.phase, .closed)
        XCTAssertEqual(store.presentation, .error)
    }

    func testRetryableErrorReconnects() async {
        let provider = Provider(episodes: [
            .init([.failed(.network(message: "drop"))], finishes: true),
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "e2", value: 60)], finishes: false)
        ])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.value?.updateCount == 1 }
        XCTAssertEqual(provider.openCount, 2, "A retryable failure must trigger a reconnect")
        XCTAssertEqual(store.phase, .open)
        XCTAssertNil(store.error)
    }

    // MARK: 401 refresh + retry-once

    func testUnauthorizedRefreshesAndRetriesOnce() async {
        let provider = Provider(episodes: [
            .init([.failed(.auth(message: "expired"))], finishes: true),
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "e3", value: 42)], finishes: false)
        ])
        let auth = RecordingAuthChallenge(recovers: true)
        let store = makeStore(provider, auth: auth)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.value?.updateCount == 1 }
        XCTAssertEqual(auth.callCount, 1, "401 must delegate to a single refresh")
        XCTAssertEqual(provider.openCount, 2)
        XCTAssertEqual(store.phase, .open)
        XCTAssertNil(store.error)
    }

    func testUnauthorizedFailureSurfacesError() async {
        let provider = Provider(episodes: [
            .init([.failed(.auth(message: "expired"))], finishes: true)
        ])
        let auth = RecordingAuthChallenge(recovers: false)
        let store = makeStore(provider, auth: auth)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.error != nil }
        XCTAssertEqual(auth.callCount, 1)
        XCTAssertEqual(store.error, .auth(message: "expired"))
        XCTAssertEqual(store.phase, .closed)
    }

    func testUnauthorizedRetriesOnlyOnce() async {
        let provider = Provider(episodes: [
            .init([.failed(.auth(message: "expired"))], finishes: true),
            .init([.failed(.auth(message: "again"))], finishes: true)
        ])
        let auth = RecordingAuthChallenge(recovers: true)
        let store = makeStore(provider, auth: auth)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.error != nil }
        XCTAssertEqual(auth.callCount, 1, "A second consecutive 401 must not loop the refresh")
        XCTAssertEqual(store.error, .auth(message: "again"))
        XCTAssertEqual(provider.openCount, 2)
    }

    // MARK: Background / foreground + resume

    func testBackgroundForegroundResumesWithLastEventID() async {
        let provider = Provider(episodes: [
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "evt-1", value: 70)], finishes: false),
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "evt-2", value: 71)], finishes: false)
        ])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.lastEventID == "evt-1" }

        store.setScenePhaseActive(false)
        XCTAssertFalse(store.isActive, "Backgrounding must tear the stream down")
        XCTAssertEqual(store.phase, .closed)

        store.setScenePhaseActive(true)
        await liveWaitUntil { provider.openCount == 2 }
        XCTAssertEqual(provider.opens.last?.resumeToken, "evt-1", "Foreground must resume with Last-Event-ID")
    }

    func testDeactivateStopsProcessing() async {
        let provider = Provider(episodes: [
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "e1", value: 33)], finishes: false)
        ])
        let store = makeStore(provider)

        store.activate()
        await liveWaitUntil { store.value?.updateCount == 1 }

        store.deactivate()
        XCTAssertFalse(store.isActive)
        XCTAssertEqual(store.phase, .closed)

        provider.push(LiveTestEvents.vehicleUpdate(id: "e2", value: 99))
        await liveWaitUntil(timeout: 0.2) { store.value?.updateCount == 2 }
        XCTAssertEqual(store.value?.updateCount, 1, "A deactivated store must ignore further events")
    }

    // MARK: Manual refresh + cache handoff

    func testManualRefreshRestartsStreamWithResumeToken() async {
        let provider = Provider(episodes: [
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "a", value: 10)], finishes: false),
            .init([.connection(.open), LiveTestEvents.vehicleUpdate(id: "b", value: 11)], finishes: false)
        ])
        let store = makeStore(provider)
        defer { store.deactivate() }

        store.activate()
        await liveWaitUntil { store.lastEventID == "a" }

        store.refresh()
        await liveWaitUntil { provider.openCount == 2 }
        XCTAssertEqual(provider.opens.last?.resumeToken, "a")
    }

    func testReseedFromRestSeedsContentAndFreshness() {
        let provider = Provider(episodes: [])
        let store = makeStore(provider)

        let when = Date(timeIntervalSince1970: 1000)
        store.reseed(value: LiveDemoSnapshot(updateCount: 3, lastField: "soc", lastValue: "90"), at: when)
        XCTAssertEqual(store.value?.updateCount, 3)
        XCTAssertEqual(store.fetchedAt, when)
        XCTAssertTrue(store.hasContent)
    }
}
