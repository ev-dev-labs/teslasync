//
//  FavoritesBar.ModelTests.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  State-holder coverage for `FavoritesBarModel`, split from FavoritesBar.Tests.swift for
//  the lint length budget. Drives the model through `InMemoryFavoritesSource` and the
//  spies defined alongside the adapter tests (same XCTest target): phase resolution, the
//  P1/S11 `view.opened` telemetry (once), the favorited-command derivation, the execute +
//  optimistic toggle-favorite intents, the stale auto-refresh, offline behavior, and
//  adopting the parent's pushed favorites + registry. No network, no bundle.
//

import XCTest
@testable import TeslaSync

@MainActor final class FavoritesBarModelTests: XCTestCase {
    private struct Harness {
        let model: FavoritesBarModel
        let source: InMemoryFavoritesSource
        let telemetry: SpyFavoritesTelemetry
        let sink: SpyFavoritesActionSink
    }

    private func commands() -> [FavoriteCommand] {
        [
            FavoriteCommand(
                id: "wake",
                command: "wake_up",
                labelKey: "k.wake",
                labelFallback: "Wake",
                systemImage: "sun.max"
            ),
            FavoriteCommand(
                id: "lock",
                command: "door_lock",
                labelKey: "k.lock",
                labelFallback: "Lock",
                systemImage: "lock"
            )
        ]
    }

    private func makeHarness(initial: FavoritesBarUpdate?) -> Harness {
        let telemetry = SpyFavoritesTelemetry()
        let sink = SpyFavoritesActionSink()
        let source = InMemoryFavoritesSource(initial: initial)
        let model = FavoritesBarModel(source: source, telemetry: telemetry, actionSink: sink)
        return Harness(model: model, source: source, telemetry: telemetry, sink: sink)
    }

    private func loaded(
        connection: FavoritesConnection = .live,
        favorites: [String] = ["wake", "lock"]
    ) -> FavoritesBarUpdate {
        FavoritesBarUpdate(
            status: .loaded,
            favorites: favorites,
            commands: commands(),
            connection: connection
        )
    }

    // MARK: Lifecycle + phase

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces, ["FavoritesBar"])
        XCTAssertEqual(harness.source.startCount, 1)
        XCTAssertEqual(harness.model.phase, .content)
        XCTAssertEqual(harness.model.favoriteCommands.map(\.id), ["wake", "lock"])
    }

    func testPhasesAcrossStatuses() {
        let content = makeHarness(initial: loaded())
        content.model.start()
        XCTAssertEqual(content.model.phase, .content)

        let empty = makeHarness(initial: FavoritesBarUpdate(status: .loaded))
        empty.model.start()
        XCTAssertEqual(empty.model.phase, .empty)

        let loading = makeHarness(initial: FavoritesBarUpdate(status: .loading))
        loading.model.start()
        XCTAssertEqual(loading.model.phase, .loading)

        let failed = makeHarness(initial: FavoritesBarUpdate(status: .failed("boom")))
        failed.model.start()
        XCTAssertEqual(failed.model.phase, .error("boom"))
    }

    // MARK: Tile intents

    func testExecuteForwardsToSink() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        let command = harness.model.favoriteCommands[0]
        harness.model.execute(command)
        XCTAssertEqual(harness.sink.executed, ["wake"])
    }

    func testToggleFavoriteOptimisticallyUnpinsAndForwards() throws {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        let lock = harness.model.favoriteCommands.first { $0.id == "lock" }
        try harness.model.toggleFavorite(XCTUnwrap(lock))
        XCTAssertEqual(harness.model.favoriteCommands.map(\.id), ["wake"])
        XCTAssertEqual(harness.model.phase, .content)
        XCTAssertEqual(harness.sink.toggled, ["lock"])
    }

    func testTogglingLastFavoriteCollapsesToEmpty() throws {
        let harness = makeHarness(initial: loaded(favorites: ["lock"]))
        harness.model.start()
        let lock = harness.model.favoriteCommands.first { $0.id == "lock" }
        try harness.model.toggleFavorite(XCTUnwrap(lock))
        XCTAssertTrue(harness.model.favoriteCommands.isEmpty)
        XCTAssertEqual(harness.model.phase, .empty)
    }

    // MARK: Freshness

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(loaded(connection: .live))
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineKeepsCachedFavoritesAndDoesNotRefresh() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(connection: .offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
        XCTAssertEqual(harness.model.connection, .offline)
        XCTAssertEqual(harness.model.phase, .content)
    }

    func testApplyAdoptsParentPushedFavoritesAndRegistry() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(favorites: ["lock"]))
        XCTAssertEqual(harness.model.favoriteCommands.map(\.id), ["lock"])
        XCTAssertEqual(harness.model.favoriteCount, 1)
    }

    func testStopAllowsTelemetryToReArm() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.stop()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces.count, 2)
        XCTAssertEqual(harness.source.stopCount, 1)
    }
}
