//
//  NewVersionBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  State-holder coverage for ``NewVersionBannerModel``: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across every state (loading / empty / error / available), the
//  per-version dismissal (persisted to the store, hiding only the current version) and its
//  reset-on-new-version (web effect), the forwarded "Reload" handler (web `window.location.reload()`),
//  the connection axis with the one-shot stale auto-refresh (re-armed on return to live) and offline
//  keeping the cached version, plus the view composition + the strings facade. The seams + the polling
//  source live in NewVersionBanner.PollingTests.swift. Driven through the in-memory seams — no network,
//  no real time.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class NewVersionBannerModelTests: XCTestCase {
    private func makeModel(
        _ snapshot: NewVersionWatcherSnapshot,
        store: NewVersionDismissalStore = InMemoryNewVersionDismissalStore(),
        telemetry: NewVersionBannerTelemetry = OSLogNewVersionBannerTelemetry(),
        onReload: (@MainActor () -> Void)? = nil,
        onLater: (@MainActor () -> Void)? = nil
    ) -> (NewVersionBannerModel, InMemoryNewVersionBannerSource) {
        let source = InMemoryNewVersionBannerSource(initial: snapshot)
        let model = NewVersionBannerModel(
            source: source,
            dismissalStore: store,
            telemetry: telemetry,
            onReload: onReload,
            onLater: onLater
        )
        return (model, source)
    }

    private func available() -> NewVersionWatcherSnapshot {
        NewVersionWatcherSnapshot(bootVersion: "2026.6.1", latestVersion: "2026.6.2")
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyNewVersionBannerTelemetry()
        let (model, source) = makeModel(available(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .available)
        XCTAssertEqual(model.resolved.data?.latestVersion, "2026.6.2")
        XCTAssertEqual(spy.surfaces, [NewVersionBannerSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyNewVersionBannerTelemetry()
        let (model, _) = makeModel(available(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [NewVersionBannerSurface.slug])
    }

    func testLoadingPhase() {
        let (model, _) = makeModel(NewVersionWatcherSnapshot(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testUpToDateProjectsEmpty() {
        let (model, _) = makeModel(NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.0"))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorPhase() {
        let (model, _) = makeModel(NewVersionWatcherSnapshot(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushFromLoadingToAvailable() {
        let (model, source) = makeModel(NewVersionWatcherSnapshot(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(available())
        XCTAssertEqual(model.phase, .available)
    }

    func testDismissPersistsAndHidesForCurrentVersion() {
        let store = InMemoryNewVersionDismissalStore()
        let (model, _) = makeModel(available(), store: store)
        model.start()
        XCTAssertEqual(model.phase, .available)
        model.dismiss()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(store.dismissedVersion, "2026.6.2")
    }

    func testDismissIsNoOpWithoutLatestVersion() {
        let store = InMemoryNewVersionDismissalStore()
        let (model, _) = makeModel(NewVersionWatcherSnapshot(isLoading: true), store: store)
        model.start()
        model.dismiss()
        XCTAssertNil(store.dismissedVersion)
    }

    func testDismissInvokesOnLater() {
        var later = 0
        let (model, _) = makeModel(available(), onLater: { later += 1 })
        model.start()
        model.dismiss()
        XCTAssertEqual(later, 1)
    }

    func testDismissalSeededFromStoreSuppressesBanner() {
        let store = InMemoryNewVersionDismissalStore(dismissedVersion: "2026.6.2")
        let (model, _) = makeModel(available(), store: store)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testDismissalResetsWhenLatestAdvances() {
        let store = InMemoryNewVersionDismissalStore(dismissedVersion: "2026.6.2")
        let (model, source) = makeModel(available(), store: store)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        source.push(NewVersionWatcherSnapshot(bootVersion: "2026.6.1", latestVersion: "2026.6.3"))
        XCTAssertEqual(model.phase, .available)
        XCTAssertNil(store.dismissedVersion)
    }

    func testReloadForwardsToHandler() {
        var reloaded = 0
        let (model, _) = makeModel(available(), onReload: { reloaded += 1 })
        model.start()
        model.reload()
        XCTAssertEqual(reloaded, 1)
    }

    func testReloadIsNoOpWithoutHandler() {
        let (model, _) = makeModel(available())
        model.start()
        model.reload()
        XCTAssertEqual(model.phase, .available)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(available())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1", latestVersion: "2026.6.2", connection: .stale
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1", latestVersion: "2026.6.2", connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(available())
        model.start()
        source.push(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1", latestVersion: "2026.6.2", connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(available())
        XCTAssertEqual(model.connection, .live)
        source.push(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1", latestVersion: "2026.6.2", connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedAvailabilityAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(available())
        model.start()
        source.push(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1", latestVersion: "2026.6.2", connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .available)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(available())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsAndReArms() {
        let (model, source) = makeModel(available())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class NewVersionBannerViewTests: XCTestCase {
    private func model(_ snapshot: NewVersionWatcherSnapshot) -> NewVersionBannerModel {
        NewVersionBannerModel(source: InMemoryNewVersionBannerSource(initial: snapshot))
    }

    func testSurfaceComposesForEveryPhase() {
        _ = NewVersionBanner(model: model(NewVersionWatcherSnapshot(isLoading: true)))
        _ = NewVersionBanner(model: model(NewVersionWatcherSnapshot(bootVersion: "1", latestVersion: "1")))
        _ = NewVersionBanner(model: model(NewVersionWatcherSnapshot(errorMessage: "x")))
        _ = NewVersionBanner(model: model(NewVersionWatcherSnapshot(bootVersion: "1", latestVersion: "2")))
    }

    func testProductionInitComposes() {
        _ = NewVersionBanner(
            probe: ScriptedVersionProbe([.version("1.0")]),
            poller: ManualNewVersionPoller(),
            onReload: {}
        )
    }

    func testCardLoadingEmptyErrorAndChipCompose() {
        _ = NewVersionBannerCard(
            data: NewVersionBannerData(latestVersion: "2", bootVersion: "1"),
            onReload: {},
            onLater: {}
        )
        _ = NewVersionBannerLoadingView()
        _ = NewVersionBannerUpToDateView()
        _ = NewVersionBannerErrorView(message: "x") {}
        for connection in NewVersionConnection.allCases {
            _ = NewVersionBannerFreshnessChip(connection: connection, onRefresh: {})
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class NewVersionBannerStringsTests: XCTestCase {
    func testWebKeyFallbacks() {
        XCTAssertEqual(
            NewVersionBannerStrings.string("app.newVersion.message", "A new version of TeslaSync is available."),
            "A new version of TeslaSync is available."
        )
        XCTAssertEqual(NewVersionBannerStrings.string("app.newVersion.later", "Later"), "Later")
        XCTAssertEqual(NewVersionBannerStrings.string("app.newVersion.reload", "Reload"), "Reload")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyNewVersionBannerTelemetry: NewVersionBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
