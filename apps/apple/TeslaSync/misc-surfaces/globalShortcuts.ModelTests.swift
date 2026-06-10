//
//  globalShortcuts.ModelTests.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  State-holder coverage for `GlobalShortcutsModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the connection axis (live / stale / offline) with
//  the one-shot stale auto-refresh (re-armed on return to live), offline keeping the
//  cached registry, the manual refresh / stop-and-restart wiring, and the canonical
//  source seeding the full registry. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

private let fallbackResolve: GlobalShortcutsResolve = { _, fallback in fallback }

@MainActor
final class GlobalShortcutsModelTests: XCTestCase {
    private var canonical: [GlobalShortcutDefinition] {
        GlobalShortcutsCatalog.canonicalDefinitions(resolve: fallbackResolve)
    }

    private func makeModel(
        _ input: GlobalShortcutsInput,
        telemetry: GlobalShortcutsTelemetry = OSLogGlobalShortcutsTelemetry()
    ) -> (GlobalShortcutsModel, InMemoryGlobalShortcutsSource) {
        let source = InMemoryGlobalShortcutsSource(initial: input)
        let model = GlobalShortcutsModel(source: source, telemetry: telemetry, strings: fallbackResolve)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyGlobalShortcutsTelemetry()
        let (model, source) = makeModel(GlobalShortcutsInput(definitions: canonical), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.groups.count, 3)
        XCTAssertEqual(model.resolved.totalCount, 21)
        XCTAssertEqual(spy.surfaces, [GlobalShortcuts.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(GlobalShortcutsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoDefinitionsProjectsEmpty() {
        let (model, _) = makeModel(GlobalShortcutsInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(GlobalShortcutsInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(GlobalShortcutsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(GlobalShortcutsInput(definitions: canonical))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.totalCount, 21)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(GlobalShortcutsInput(definitions: canonical))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(GlobalShortcutsInput(definitions: canonical, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(GlobalShortcutsInput(definitions: canonical, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(GlobalShortcutsInput(definitions: canonical))
        model.start()
        source.push(GlobalShortcutsInput(definitions: canonical, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(GlobalShortcutsInput(definitions: canonical, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(GlobalShortcutsInput(definitions: canonical, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedRegistryAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(GlobalShortcutsInput(definitions: canonical))
        model.start()
        source.push(GlobalShortcutsInput(definitions: canonical, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(GlobalShortcutsInput(definitions: canonical))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(GlobalShortcutsInput(definitions: canonical))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(GlobalShortcuts.surfaceSlug, "globalShortcuts")
    }
}

// MARK: - Canonical source (production seeding parity)

@MainActor
final class CanonicalGlobalShortcutsSourceTests: XCTestCase {
    func testStartEmitsTheFullCanonicalRegistry() {
        let source = CanonicalGlobalShortcutsSource(strings: fallbackResolve)
        var received: GlobalShortcutsInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(received?.definitions.count, 21)
        XCTAssertEqual(received?.connection, .live)
    }

    func testRefreshReEmitsTheRegistry() {
        let source = CanonicalGlobalShortcutsSource(strings: fallbackResolve)
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded
/// so it satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyGlobalShortcutsTelemetry: GlobalShortcutsTelemetry, @unchecked Sendable {
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
