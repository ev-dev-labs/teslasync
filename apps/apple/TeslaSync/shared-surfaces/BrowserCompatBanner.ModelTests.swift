//
//  BrowserCompatBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  State-holder coverage for `BrowserCompatBannerModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state (loading / empty / error /
//  data), dismissal persistence (web `dismissCompatWarning()`), the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live), offline
//  keeping the cached result, the capability probe (production filter logic + the seeded
//  `testHookMissing` double), and the dismissal store (the `UserDefaults` contract). Driven through the
//  in-memory + static seams — no device probe, no real persistence.
//

import XCTest
@testable import TeslaSync

@MainActor
final class BrowserCompatBannerModelTests: XCTestCase {
    private let sampleMissing = [BrowserCompatCapabilities.swiftCharts, BrowserCompatCapabilities.mapKit]

    private func makeModel(
        _ input: BrowserCompatInput,
        telemetry: BrowserCompatBannerTelemetry = OSLogBrowserCompatBannerTelemetry()
    ) -> (BrowserCompatBannerModel, InMemoryBrowserCompatBannerSource) {
        let source = InMemoryBrowserCompatBannerSource(initial: input)
        let model = BrowserCompatBannerModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyBrowserCompatTelemetry()
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.missing, sampleMissing)
        XCTAssertEqual(spy.surfaces, [BrowserCompatBannerModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testNoMissingProjectsEmptyCompatible() {
        let (model, _) = makeModel(BrowserCompatInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .compatible)
    }

    func testDismissedWithMissingProjectsEmptyAcknowledged() {
        let (model, _) = makeModel(BrowserCompatInput(missing: sampleMissing, dismissed: true))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .acknowledged)
    }

    func testLoadingThenPushToData() {
        let (model, source) = makeModel(BrowserCompatInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(BrowserCompatInput(missing: sampleMissing))
        XCTAssertEqual(model.phase, .data)
    }

    func testErrorInputProjectsError() {
        let (model, _) = makeModel(BrowserCompatInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDismissDelegatesToSource() {
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing))
        model.start()
        model.dismiss()
        XCTAssertEqual(source.dismissCount, 1)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(BrowserCompatInput(missing: sampleMissing, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(BrowserCompatInput(missing: sampleMissing, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing))
        model.start()
        source.push(BrowserCompatInput(missing: sampleMissing, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(BrowserCompatInput(missing: sampleMissing, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(BrowserCompatInput(missing: sampleMissing, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsDataAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing))
        model.start()
        source.push(BrowserCompatInput(missing: sampleMissing, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopReArms() {
        let (model, source) = makeModel(BrowserCompatInput(missing: sampleMissing))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(BrowserCompatBannerModel.surfaceSlug, "BrowserCompatBanner")
    }
}

// MARK: - Default source (production — probe + persisted dismissal)

@MainActor
final class DefaultBrowserCompatBannerSourceTests: XCTestCase {
    func testStartEmitsProbeResultAndDismissalState() {
        let probe = StaticCapabilityProbe(missing: [BrowserCompatCapabilities.mapKit])
        let store = InMemoryDismissalStore(isDismissed: false)
        let source = DefaultBrowserCompatBannerSource(probe: probe, store: store)
        var inputs: [BrowserCompatInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.missing, [BrowserCompatCapabilities.mapKit])
        XCTAssertEqual(inputs.last?.dismissed, false)
    }

    func testDismissPersistsAndReEmits() {
        let probe = StaticCapabilityProbe(missing: [BrowserCompatCapabilities.mapKit])
        let store = InMemoryDismissalStore(isDismissed: false)
        let source = DefaultBrowserCompatBannerSource(probe: probe, store: store)
        var inputs: [BrowserCompatInput] = []
        source.onUpdate = { inputs.append($0) }
        source.dismiss()
        XCTAssertEqual(store.setCount, 1)
        XCTAssertTrue(store.isDismissed)
        XCTAssertEqual(inputs.last?.dismissed, true)
    }

    func testSupportedRuntimeReportsNoMissingCapabilities() {
        // The production probe on this (supported iOS 18 / macOS 15) runtime finds nothing missing —
        // the native parity of the web banner staying hidden on a modern browser.
        let source = DefaultBrowserCompatBannerSource()
        var inputs: [BrowserCompatInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.missing, [])
    }
}

// MARK: - Capability probe (web `detectMissingFeatures()` + `testHookMissing`)

@MainActor
final class CapabilityProbeTests: XCTestCase {
    func testStaticProbeReturnsSeededMissing() {
        let probe = StaticCapabilityProbe(missing: BrowserCompatCapabilities.all)
        XCTAssertEqual(probe.detectMissing(), BrowserCompatCapabilities.all)
    }

    func testDefaultProbeCollectsUnsatisfiedChecks() {
        let checks = [
            CapabilityCheck(capability: BrowserCompatCapabilities.swiftCharts) { true },
            CapabilityCheck(capability: BrowserCompatCapabilities.mapKit) { false },
            CapabilityCheck(capability: BrowserCompatCapabilities.widgets) { false }
        ]
        let probe = DefaultCapabilityProbe(checks: checks)
        XCTAssertEqual(
            probe.detectMissing(),
            [BrowserCompatCapabilities.mapKit, BrowserCompatCapabilities.widgets]
        )
    }

    func testDefaultProbeReturnsEmptyWhenAllSatisfied() {
        let checks = [
            CapabilityCheck(capability: BrowserCompatCapabilities.swiftCharts) { true },
            CapabilityCheck(capability: BrowserCompatCapabilities.mapKit) { true }
        ]
        XCTAssertEqual(DefaultCapabilityProbe(checks: checks).detectMissing(), [])
    }
}

// MARK: - Dismissal store (web `teslasync:compat-warning-dismissed:v1`)

@MainActor
final class DismissalStoreTests: XCTestCase {
    func testUserDefaultsStoreRoundTripsTheWebContract() throws {
        let suiteName = "compat.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserDefaultsDismissalStore(defaults: defaults)
        XCTAssertFalse(store.isDismissed)

        store.setDismissed(true)
        XCTAssertTrue(store.isDismissed)
        XCTAssertEqual(defaults.string(forKey: UserDefaultsDismissalStore.storageKey), "1")

        store.setDismissed(false)
        XCTAssertFalse(store.isDismissed)
        XCTAssertNil(defaults.string(forKey: UserDefaultsDismissalStore.storageKey))
    }

    func testStorageKeyMatchesWebSourceVerbatim() {
        XCTAssertEqual(UserDefaultsDismissalStore.storageKey, "teslasync:compat-warning-dismissed:v1")
    }

    func testInMemoryStoreCountsWrites() {
        let store = InMemoryDismissalStore(isDismissed: false)
        store.setDismissed(true)
        XCTAssertTrue(store.isDismissed)
        XCTAssertEqual(store.setCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyBrowserCompatTelemetry: BrowserCompatBannerTelemetry, @unchecked Sendable {
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
