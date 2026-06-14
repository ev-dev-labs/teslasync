//
//  NavigationGuardProvider.CoordinatorTests.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  @MainActor async tests for the `NavigationGuardCoordinator` (P1/S8 state holder) — the live wiring
//  the pure-core tests can't reach: the `confirmIfDirty` / `confirmBack` async flow, the in-flight
//  prompt re-use across racing callers (web `pendingPromiseRef`), the "Don't ask again" silence
//  persistence, registration / unregistration, the vended context + the NOOP context, and the once-only
//  `view.opened` telemetry.
//

import XCTest
@testable import TeslaSync

/// Records `view.opened` emissions for the telemetry assertion.
private final class SpyNavigationGuardTelemetry: NavigationGuardTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opens: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opens }
    }

    func viewOpened(surface: String) {
        lock.withLock { opens.append(surface) }
    }
}

/// Main-actor result holder so racing `Task`s can record outcomes without capturing a mutable local.
@MainActor
private final class GuardResults {
    var values: [String: Bool] = [:]
}

@MainActor
final class NavigationGuardCoordinatorTests: XCTestCase {
    private let echoFallback: NavigationGuardResolve = { _, fallback in fallback }

    private func makeCoordinator(
        silence: InMemoryNavigationGuardSilence = InMemoryNavigationGuardSilence(),
        telemetry: NavigationGuardTelemetry = SpyNavigationGuardTelemetry()
    ) -> NavigationGuardCoordinator {
        NavigationGuardCoordinator(
            silence: silence,
            telemetry: telemetry,
            localize: echoFallback,
            silenceKey: "unsaved-navigation"
        )
    }

    private func dirtyEntry(id: String = "form", message: String? = nil) -> NavigationGuardEntry {
        NavigationGuardEntry(id: id, isDirty: { true }, message: { message })
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyNavigationGuardTelemetry()
        let coord = makeCoordinator(telemetry: spy)
        coord.start()
        coord.start()
        XCTAssertEqual(spy.openedSurfaces, ["NavigationGuardProvider"])
    }

    func testStopAllowsReopen() {
        let spy = SpyNavigationGuardTelemetry()
        let coord = makeCoordinator(telemetry: spy)
        coord.start()
        coord.stop()
        coord.start()
        XCTAssertEqual(spy.openedSurfaces.count, 2)
    }

    // MARK: confirmIfDirty — proceed

    func testConfirmIfDirtyProceedsWhenNoGuards() async {
        let coord = makeCoordinator()
        let result = await coord.confirmIfDirty()
        XCTAssertTrue(result)
        XCTAssertEqual(coord.state.phase, .idle)
    }

    func testConfirmIfDirtyProceedsWhenAllClean() async {
        let coord = makeCoordinator()
        coord.register(NavigationGuardEntry(id: "clean", isDirty: { false }))
        let result = await coord.confirmIfDirty()
        XCTAssertTrue(result)
        XCTAssertEqual(coord.state.phase, .idle)
    }

    // MARK: confirmIfDirty — prompt + resolve

    func testConfirmIfDirtyPromptsThenDiscard() async {
        let coord = makeCoordinator()
        coord.register(dirtyEntry(message: "Discard the alert rule?"))

        let results = GuardResults()
        let task = Task { @MainActor in
            results.values["r"] = await coord.confirmIfDirty()
        }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        XCTAssertEqual(coord.state.phase, .confirming)
        XCTAssertEqual(coord.state.request?.copy.message, "Discard the alert rule?")

        coord.confirmDiscard()
        _ = await task.value
        XCTAssertEqual(results.values["r"], true)
        XCTAssertEqual(coord.state.phase, .idle)
    }

    func testConfirmIfDirtyPromptsThenKeepEditing() async {
        let coord = makeCoordinator()
        coord.register(dirtyEntry(message: "Discard?"))

        let results = GuardResults()
        let task = Task { @MainActor in
            results.values["r"] = await coord.confirmIfDirty()
        }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        coord.keepEditing()
        _ = await task.value
        XCTAssertEqual(results.values["r"], false)
        XCTAssertEqual(coord.state.phase, .idle)
    }

    func testGenericMessageWhenGuardHasNoMessage() async {
        let coord = makeCoordinator()
        coord.register(dirtyEntry(message: nil))

        let results = GuardResults()
        let task = Task { @MainActor in
            results.values["r"] = await coord.confirmIfDirty()
        }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        XCTAssertEqual(coord.state.request?.copy.message, "You have unsaved changes. Discard them?")
        coord.keepEditing()
        _ = await task.value
        XCTAssertEqual(results.values["r"], false)
    }

    // MARK: In-flight re-use (web `pendingPromiseRef`)

    func testInFlightPromptReuseAcrossRacingCallers() async {
        let coord = makeCoordinator()
        coord.register(dirtyEntry(message: "Shared prompt"))

        let results = GuardResults()
        let first = Task { @MainActor in results.values["a"] = await coord.confirmIfDirty() }
        while coord.pendingCount == 0 {
            await Task.yield()
        }
        let second = Task { @MainActor in results.values["b"] = await coord.confirmBack() }
        while coord.pendingCount < 2 {
            await Task.yield()
        }

        // Both callers share the single in-flight prompt — no dialog stacking.
        XCTAssertEqual(coord.pendingCount, 2)

        coord.confirmDiscard()
        _ = await first.value
        _ = await second.value
        XCTAssertEqual(results.values["a"], true)
        XCTAssertEqual(results.values["b"], true)
        XCTAssertEqual(coord.pendingCount, 0)
    }

    // MARK: Silence (web ConfirmDialog "Don't ask again")

    func testSilencedActionAutoProceedsWithoutPrompt() async {
        let silence = InMemoryNavigationGuardSilence(silenced: ["unsaved-navigation"])
        let coord = makeCoordinator(silence: silence)
        coord.register(dirtyEntry(message: "should not show"))

        let result = await coord.confirmIfDirty()
        XCTAssertTrue(result)
        XCTAssertEqual(coord.state.phase, .idle)
    }

    func testDiscardWithDontAskAgainPersistsSilence() async {
        let silence = InMemoryNavigationGuardSilence()
        let coord = makeCoordinator(silence: silence)
        coord.register(dirtyEntry(message: "Discard?"))

        let results = GuardResults()
        let task = Task { @MainActor in results.values["r"] = await coord.confirmIfDirty() }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        coord.setDontAskAgain(true)
        coord.confirmDiscard()
        _ = await task.value

        XCTAssertEqual(results.values["r"], true)
        XCTAssertEqual(silence.silenceCalls, ["unsaved-navigation"])
        XCTAssertFalse(coord.dontAskAgain)
    }

    func testKeepEditingDoesNotSilence() async {
        let silence = InMemoryNavigationGuardSilence()
        let coord = makeCoordinator(silence: silence)
        coord.register(dirtyEntry(message: "Discard?"))

        let results = GuardResults()
        let task = Task { @MainActor in results.values["r"] = await coord.confirmIfDirty() }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        coord.setDontAskAgain(true)
        coord.keepEditing()
        _ = await task.value

        XCTAssertEqual(results.values["r"], false)
        XCTAssertTrue(silence.silenceCalls.isEmpty)
    }

    // MARK: Registration lifecycle

    func testUnregisterStopsGuarding() async {
        let coord = makeCoordinator()
        let token = coord.register(dirtyEntry(message: "Discard?"))
        token.cancel()
        let result = await coord.confirmIfDirty()
        XCTAssertTrue(result)
        XCTAssertEqual(coord.state.phase, .idle)
    }

    // MARK: confirmBack (web `popstate`)

    func testConfirmBackPromptsWhenDirty() async {
        let coord = makeCoordinator()
        coord.register(dirtyEntry(message: "Leaving via back"))

        let results = GuardResults()
        let task = Task { @MainActor in results.values["r"] = await coord.confirmBack() }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        XCTAssertEqual(coord.state.phase, .confirming)
        coord.confirmDiscard()
        _ = await task.value
        XCTAssertEqual(results.values["r"], true)
    }

    // MARK: Connectivity axis

    func testSetConnectionUpdatesActiveConfirmRequest() async {
        let coord = makeCoordinator()
        coord.register(dirtyEntry(message: "Discard?"))

        let results = GuardResults()
        let task = Task { @MainActor in results.values["r"] = await coord.confirmIfDirty() }
        while coord.pendingCount == 0 {
            await Task.yield()
        }

        XCTAssertEqual(coord.state.request?.connection, .live)
        coord.setConnection(.stale)
        XCTAssertEqual(coord.state.request?.connection, .stale)

        coord.keepEditing()
        _ = await task.value
        XCTAssertEqual(coord.state.connection, .stale)
    }

    // MARK: Context vending + NOOP

    func testCoordinatorIsVendedContext() async {
        let coord = makeCoordinator()
        let context: any NavigationGuardContext = coord
        context.register(dirtyEntry(message: "via protocol"))

        let results = GuardResults()
        let task = Task { @MainActor in results.values["r"] = await context.confirmIfDirty() }
        while coord.pendingCount == 0 {
            await Task.yield()
        }
        coord.keepEditing()
        _ = await task.value
        XCTAssertEqual(results.values["r"], false)
    }

    func testNoopContextProceedsAndRegistersInert() async {
        let noop = NoopNavigationGuardContext()
        let token = noop.register(NavigationGuardEntry(id: "x", isDirty: { true }))
        token.cancel()
        let result = await noop.confirmIfDirty()
        XCTAssertTrue(result)
    }
}
