//
//  InstallPrompt.ModelTests.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  State-holder coverage for `InstallPromptModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across every state (loading / empty / error / data), the
//  install action (web `handleInstall` — accepted marks installed, declined / unavailable leaves the
//  prompt), dismissal delegation (web `handleDismiss`), the connection axis (live / stale / offline)
//  with the one-shot stale auto-refresh (re-armed on return to live), offline keeping the cached
//  result, the installability probe (production runtime check + the seeded double), the dismissal
//  store (the `UserDefaults` + 14-day-window contract), and the cross-scene broadcast (controlled +
//  `NotificationCenter`, including the ignore-own-post rule). Driven through the in-memory + static
//  seams — no device probe, no real persistence, no global notifications.
//

import XCTest
@testable import TeslaSync

@MainActor
final class InstallPromptModelTests: XCTestCase {
    private func makeModel(
        _ input: InstallPromptInput,
        telemetry: InstallPromptTelemetry = OSLogInstallPromptTelemetry(),
        onInstall: (@MainActor () -> Bool)? = nil
    ) -> (InstallPromptModel, InMemoryInstallPromptSource) {
        let source = InMemoryInstallPromptSource(initial: input)
        let model = InstallPromptModel(source: source, telemetry: telemetry, onInstall: onInstall)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyInstallPromptTelemetry()
        let (model, source) = makeModel(InstallPromptInput(canInstall: true), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [InstallPromptModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInstalledProjectsEmptyInstalled() {
        let (model, _) = makeModel(InstallPromptInput(canInstall: true, isInstalled: true))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .installed)
    }

    func testDismissedProjectsEmptyDismissed() {
        let (model, _) = makeModel(InstallPromptInput(canInstall: true, dismissed: true))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .dismissed)
    }

    func testNotInstallableProjectsEmptyUnavailable() {
        let (model, _) = makeModel(InstallPromptInput(canInstall: false))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .unavailable)
    }

    func testLoadingThenPushToData() {
        let (model, source) = makeModel(InstallPromptInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(InstallPromptInput(canInstall: true))
        XCTAssertEqual(model.phase, .data)
    }

    func testErrorInputProjectsError() {
        let (model, _) = makeModel(InstallPromptInput(canInstall: true, errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testAcceptedInstallMarksInstalled() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true), onInstall: { true })
        model.start()
        model.install()
        XCTAssertEqual(source.markInstalledCount, 1)
    }

    func testDeclinedInstallDoesNotMarkInstalled() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true), onInstall: { false })
        model.start()
        model.install()
        XCTAssertEqual(source.markInstalledCount, 0)
    }

    func testInstallWithoutHandlerIsNoOp() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true), onInstall: nil)
        model.start()
        model.install()
        XCTAssertEqual(source.markInstalledCount, 0)
    }

    func testDismissDelegatesToSource() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true))
        model.start()
        model.dismiss()
        XCTAssertEqual(source.dismissCount, 1)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(InstallPromptInput(canInstall: true, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(InstallPromptInput(canInstall: true, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true))
        model.start()
        source.push(InstallPromptInput(canInstall: true, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(InstallPromptInput(canInstall: true, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(InstallPromptInput(canInstall: true, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsDataAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true))
        model.start()
        source.push(InstallPromptInput(canInstall: true, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopReArms() {
        let (model, source) = makeModel(InstallPromptInput(canInstall: true))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(InstallPromptModel.surfaceSlug, "InstallPrompt")
    }
}

// MARK: - Default source (production — probe + persisted dismissal + broadcast)

@MainActor
final class DefaultInstallPromptSourceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeSource(
        probe: InstallabilityProbe,
        store: InstallPromptDismissalStore,
        broadcast: InstallPromptBroadcast
    ) -> DefaultInstallPromptSource {
        DefaultInstallPromptSource(probe: probe, store: store, broadcast: broadcast, clock: { self.now })
    }

    func testStartEmitsProbeResultAndDismissalState() {
        let probe = StaticInstallabilityProbe(canInstall: true, isInstalled: false)
        let store = InMemoryInstallPromptDismissalStore()
        let broadcast = ControlledInstallPromptBroadcast()
        let source = makeSource(probe: probe, store: store, broadcast: broadcast)
        var inputs: [InstallPromptInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.canInstall, true)
        XCTAssertEqual(inputs.last?.isInstalled, false)
        XCTAssertEqual(inputs.last?.dismissed, false)
        XCTAssertEqual(broadcast.subscribeCount, 1)
    }

    func testDismissPersistsBroadcastsAndReEmits() {
        let probe = StaticInstallabilityProbe(canInstall: true)
        let store = InMemoryInstallPromptDismissalStore()
        let broadcast = ControlledInstallPromptBroadcast()
        let source = makeSource(probe: probe, store: store, broadcast: broadcast)
        var inputs: [InstallPromptInput] = []
        source.onUpdate = { inputs.append($0) }
        source.dismiss()
        XCTAssertEqual(store.markCount, 1)
        XCTAssertEqual(store.dismissedAt, now)
        XCTAssertEqual(broadcast.postCount, 1)
        XCTAssertEqual(inputs.last?.dismissed, true)
    }

    func testMarkInstalledReEmitsInstalled() {
        let probe = StaticInstallabilityProbe(canInstall: true, isInstalled: false)
        let store = InMemoryInstallPromptDismissalStore()
        let broadcast = ControlledInstallPromptBroadcast()
        let source = makeSource(probe: probe, store: store, broadcast: broadcast)
        var inputs: [InstallPromptInput] = []
        source.onUpdate = { inputs.append($0) }
        source.markInstalled()
        XCTAssertEqual(inputs.last?.isInstalled, true)
    }

    func testSiblingBroadcastReEmitsPersistedDismissal() {
        let probe = StaticInstallabilityProbe(canInstall: true)
        let store = InMemoryInstallPromptDismissalStore()
        let broadcast = ControlledInstallPromptBroadcast()
        let source = makeSource(probe: probe, store: store, broadcast: broadcast)
        var inputs: [InstallPromptInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.dismissed, false)
        // A sibling scene dismissed → it wrote the shared store; the broadcast nudges this scene.
        store.markDismissed(at: now)
        broadcast.deliver()
        XCTAssertEqual(inputs.last?.dismissed, true)
    }

    func testDismissalWithinWindowSuppresses() {
        let probe = StaticInstallabilityProbe(canInstall: true)
        let store = InMemoryInstallPromptDismissalStore(dismissedAt: now.addingTimeInterval(-86400))
        let source = makeSource(probe: probe, store: store, broadcast: ControlledInstallPromptBroadcast())
        var inputs: [InstallPromptInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.dismissed, true)
    }

    func testDismissalBeyondWindowDoesNotSuppress() {
        let probe = StaticInstallabilityProbe(canInstall: true)
        let aged = now.addingTimeInterval(-(InstallPromptConstants.dismissWindow + 86400))
        let store = InMemoryInstallPromptDismissalStore(dismissedAt: aged)
        let source = makeSource(probe: probe, store: store, broadcast: ControlledInstallPromptBroadcast())
        var inputs: [InstallPromptInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.dismissed, false)
    }

    func testStopUnsubscribes() {
        let broadcast = ControlledInstallPromptBroadcast()
        let source = makeSource(
            probe: StaticInstallabilityProbe(canInstall: true),
            store: InMemoryInstallPromptDismissalStore(),
            broadcast: broadcast
        )
        source.start()
        source.stop()
        XCTAssertEqual(broadcast.unsubscribeCount, 1)
    }

    func testSupportedRuntimeCanInstall() {
        // The production probe on this (supported iOS 18 / macOS 15) runtime can offer the affordance.
        XCTAssertTrue(DefaultInstallabilityProbe().canInstall())
    }
}

// MARK: - Installability probe (web `beforeinstallprompt` + `isStandaloneMode`)

@MainActor
final class InstallabilityProbeTests: XCTestCase {
    func testStaticProbeReturnsSeededSignals() {
        let probe = StaticInstallabilityProbe(canInstall: true, isInstalled: true)
        XCTAssertTrue(probe.canInstall())
        XCTAssertTrue(probe.isInstalled())
    }

    func testDefaultProbeHonoursInjectedInstalledSignal() {
        XCTAssertTrue(DefaultInstallabilityProbe(installed: true).isInstalled())
        XCTAssertFalse(DefaultInstallabilityProbe(installed: false).isInstalled())
    }
}

// MARK: - Dismissal store (web `teslasync-pwa-install-dismissed`)

@MainActor
final class InstallPromptDismissalStoreTests: XCTestCase {
    func testUserDefaultsStoreRoundTripsTheWebKey() throws {
        let suiteName = "installPrompt.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserDefaultsInstallPromptDismissalStore(defaults: defaults)
        XCTAssertNil(store.dismissedAt)

        let stamp = Date(timeIntervalSince1970: 1_700_000_000)
        store.markDismissed(at: stamp)
        XCTAssertEqual(store.dismissedAt?.timeIntervalSince1970 ?? 0, stamp.timeIntervalSince1970, accuracy: 0.001)

        store.clear()
        XCTAssertNil(store.dismissedAt)
    }

    func testStorageKeyMatchesWebSourceVerbatim() {
        XCTAssertEqual(UserDefaultsInstallPromptDismissalStore.storageKey, "teslasync-pwa-install-dismissed")
    }

    func testInMemoryStoreCountsWrites() {
        let store = InMemoryInstallPromptDismissalStore()
        store.markDismissed(at: Date(timeIntervalSince1970: 1))
        XCTAssertEqual(store.markCount, 1)
        store.clear()
        XCTAssertEqual(store.clearCount, 1)
        XCTAssertNil(store.dismissedAt)
    }
}

// MARK: - Cross-scene broadcast (web `broadcast`/`subscribe`)

@MainActor
final class InstallPromptBroadcastTests: XCTestCase {
    func testControlledBroadcastDeliversAndCounts() {
        let broadcast = ControlledInstallPromptBroadcast()
        var fired = 0
        broadcast.subscribe { fired += 1 }
        XCTAssertEqual(broadcast.subscribeCount, 1)
        broadcast.deliver()
        XCTAssertEqual(fired, 1)
        broadcast.postDismissed()
        XCTAssertEqual(broadcast.postCount, 1)
        broadcast.unsubscribe()
        XCTAssertEqual(broadcast.unsubscribeCount, 1)
        broadcast.deliver()
        XCTAssertEqual(fired, 1)
    }

    func testNotificationCenterBroadcastDeliversToSiblingAndIgnoresSelf() {
        let center = NotificationCenter()
        let receiver = NotificationCenterInstallPromptBroadcast(center: center)
        let poster = NotificationCenterInstallPromptBroadcast(center: center)
        var fired = 0
        receiver.subscribe { fired += 1 }

        poster.postDismissed() // sibling scene → receiver hides
        XCTAssertEqual(fired, 1)

        receiver.postDismissed() // own post → ignored (web cross-tab semantics)
        XCTAssertEqual(fired, 1)

        receiver.unsubscribe()
        poster.postDismissed() // after teardown → no delivery
        XCTAssertEqual(fired, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyInstallPromptTelemetry: InstallPromptTelemetry, @unchecked Sendable {
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
