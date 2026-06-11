//
//  BulkActionsToolbar.ModelTests.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  State-holder coverage for `BulkActionsToolbarModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / active), the per-action in-flight spinner (set during the await,
//  cleared after), the confirm flow (web `useConfirm`: show dialog → confirm runs / cancel doesn't),
//  the `disabled` + already-in-flight guards, the Clear delegation, the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live), the
//  pending-confirm pruning when an action vanishes, and the live source's snapshot re-emit. Driven
//  through the in-memory seams — no network.
//

import XCTest
@testable import TeslaSync

private let selection: [BulkSelectionID] = [.int(1), .int(2), .int(3)]

private func activeInput(
    _ actions: [BulkActionDescriptor],
    onClear: @escaping @Sendable () -> Void = {}
) -> BulkActionsInput {
    BulkActionsInput(selection: selection, total: 27, actions: actions, onClear: onClear)
}

// MARK: - Model (state-holder)

@MainActor
final class BulkActionsToolbarModelTests: XCTestCase {
    private func makeModel(
        _ input: BulkActionsInput,
        telemetry: BulkActionsToolbarTelemetry = OSLogBulkActionsToolbarTelemetry()
    ) -> (BulkActionsToolbarModel, InMemoryBulkActionsToolbarSource) {
        let source = InMemoryBulkActionsToolbarSource(initial: input)
        let model = BulkActionsToolbarModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyBulkActionsTelemetry()
        let (model, source) = makeModel(activeInput([]), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .active)
        XCTAssertEqual(model.resolved.count, 3)
        XCTAssertEqual(spy.surfaces, [BulkActionsToolbar.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(BulkActionsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptySelectionProjectsEmpty() {
        let (model, _) = makeModel(BulkActionsInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(BulkActionsInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesFromLoadingToActive() {
        let (model, source) = makeModel(BulkActionsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(activeInput([]))
        XCTAssertEqual(model.phase, .active)
        XCTAssertEqual(model.resolved.count, 3)
    }

    func testRunActionWithoutConfirmTogglesPendingAndPassesSelection() async {
        let recorder = GatedRun()
        let action = BulkActionDescriptor(id: "export", label: "Export") { ids in await recorder.run(ids) }
        let (model, _) = makeModel(activeInput([action]))
        model.start()

        let task = Task { await model.runAction("export") }
        await recorder.waitUntilStarted()
        XCTAssertEqual(model.resolved.actions.first?.isPending, true)
        XCTAssertNil(model.pendingConfirm)
        recorder.release()
        await task.value

        XCTAssertEqual(model.resolved.actions.first?.isPending, false)
        XCTAssertEqual(recorder.calls.count, 1)
        XCTAssertEqual(recorder.calls.first, selection)
    }

    func testRunActionIgnoredWhileInFlight() async {
        let recorder = GatedRun()
        let action = BulkActionDescriptor(id: "export", label: "Export") { ids in await recorder.run(ids) }
        let (model, _) = makeModel(activeInput([action]))
        model.start()

        let task = Task { await model.runAction("export") }
        await recorder.waitUntilStarted()
        await model.runAction("export") // second call while in-flight is a no-op
        recorder.release()
        await task.value

        XCTAssertEqual(recorder.calls.count, 1)
    }

    func testDisabledActionDoesNotRun() async {
        let recorder = GatedRun()
        let action = BulkActionDescriptor(
            id: "export",
            label: "Export",
            isDisabled: true
        ) { ids in await recorder.run(ids) }
        let (model, _) = makeModel(activeInput([action]))
        model.start()
        await model.runAction("export")
        XCTAssertTrue(recorder.calls.isEmpty)
        XCTAssertNil(model.pendingConfirm)
    }

    func testConfirmActionShowsDialogBeforeRunning() async {
        let recorder = GatedRun()
        let confirm = BulkActionConfirm(title: "Delete?", message: "Gone for good.", confirmLabel: "Delete")
        let action = BulkActionDescriptor(
            id: "delete",
            label: "Delete",
            variant: .danger,
            confirm: confirm
        ) { ids in await recorder.run(ids) }
        let (model, _) = makeModel(activeInput([action]))
        model.start()

        await model.runAction("delete")
        XCTAssertEqual(model.pendingConfirm?.actionID, "delete")
        XCTAssertEqual(model.pendingConfirm?.title, "Delete?")
        XCTAssertEqual(model.pendingConfirm?.message, "Gone for good.")
        XCTAssertEqual(model.pendingConfirm?.confirmLabel, "Delete")
        XCTAssertEqual(model.pendingConfirm?.isDestructive, true)
        XCTAssertTrue(recorder.calls.isEmpty)
    }

    func testConfirmPendingRunsTheAction() async {
        let recorder = GatedRun(gated: false)
        let confirm = BulkActionConfirm(title: "Delete?", message: "Gone for good.")
        let action = BulkActionDescriptor(
            id: "delete",
            label: "Delete",
            confirm: confirm
        ) { ids in await recorder.run(ids) }
        let (model, _) = makeModel(activeInput([action]))
        model.start()

        await model.runAction("delete")
        await model.confirmPending()
        XCTAssertNil(model.pendingConfirm)
        XCTAssertEqual(recorder.calls.count, 1)
    }

    func testCancelPendingDoesNotRun() async {
        let recorder = GatedRun(gated: false)
        let confirm = BulkActionConfirm(title: "Delete?", message: "Gone for good.")
        let action = BulkActionDescriptor(
            id: "delete",
            label: "Delete",
            confirm: confirm
        ) { ids in await recorder.run(ids) }
        let (model, _) = makeModel(activeInput([action]))
        model.start()

        await model.runAction("delete")
        model.cancelPending()
        XCTAssertNil(model.pendingConfirm)
        XCTAssertTrue(recorder.calls.isEmpty)
    }

    func testConfirmUsesDefaultLabelWhenUnset() async {
        let confirm = BulkActionConfirm(title: "Delete?", message: "Gone for good.")
        let action = BulkActionDescriptor(id: "delete", label: "Delete", confirm: confirm) { _ in }
        let (model, _) = makeModel(activeInput([action]))
        model.start()
        await model.runAction("delete")
        XCTAssertEqual(model.pendingConfirm?.confirmLabel, "Confirm")
        XCTAssertEqual(model.pendingConfirm?.isDestructive, false)
    }

    func testPendingConfirmPrunedWhenActionVanishes() async {
        let confirm = BulkActionConfirm(title: "Delete?", message: "Gone for good.")
        let action = BulkActionDescriptor(id: "delete", label: "Delete", confirm: confirm) { _ in }
        let (model, source) = makeModel(activeInput([action]))
        model.start()
        await model.runAction("delete")
        XCTAssertNotNil(model.pendingConfirm)
        source.push(activeInput([])) // the action is gone after a refresh
        XCTAssertNil(model.pendingConfirm)
    }

    func testClearInvokesOnClear() {
        let spy = ClearSpy()
        let (model, _) = makeModel(activeInput([], onClear: { spy.bump() }))
        model.start()
        model.clear()
        XCTAssertEqual(spy.count, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(activeInput([]))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(BulkActionsInput(selection: selection, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(BulkActionsInput(selection: selection, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(activeInput([]))
        model.start()
        source.push(BulkActionsInput(selection: selection, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(BulkActionsInput(selection: selection, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(BulkActionsInput(selection: selection, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsActiveAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(activeInput([]))
        model.start()
        source.push(BulkActionsInput(selection: selection, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .active)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(activeInput([]))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(activeInput([]))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(BulkActionsToolbar.surfaceSlug, "BulkActionsToolbar")
    }
}

// MARK: - Live source (production selection bridge)

@MainActor
final class LiveBulkActionsToolbarSourceTests: XCTestCase {
    func testStartEmitsInitialSnapshot() {
        let source = LiveBulkActionsToolbarSource()
        var snapshots: [BulkActionsInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.selection.isEmpty, true)
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testUpdateReEmitsTheNewSnapshot() {
        let source = LiveBulkActionsToolbarSource()
        var latest: BulkActionsInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(BulkActionsInput(selection: [.int(9)], total: 4))
        XCTAssertEqual(latest?.selection.count, 1)
        XCTAssertEqual(latest?.total, 4)
    }

    func testRefreshReEmitsCurrentSnapshot() {
        let source = LiveBulkActionsToolbarSource(snapshot: BulkActionsInput(selection: [.int(1)]))
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - Test doubles

/// A `run` closure double that records the selection passed to each invocation and, when `gated`,
/// suspends inside the run so the model's in-flight spinner can be observed mid-flight. `@MainActor`
/// so it is `Sendable` for the `@Sendable` action closure that wraps it.
@MainActor
private final class GatedRun {
    private(set) var calls: [[BulkSelectionID]] = []
    private let gated: Bool
    private var startedContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    init(gated: Bool = true) {
        self.gated = gated
    }

    func run(_ ids: [BulkSelectionID]) async {
        calls.append(ids)
        startedContinuation?.resume()
        startedContinuation = nil
        guard gated else { return }
        await withCheckedContinuation { releaseContinuation = $0 }
    }

    /// Suspends until the next `run(_:)` has begun (and, when gated, is parked on the release gate).
    func waitUntilStarted() async {
        await withCheckedContinuation { startedContinuation = $0 }
    }

    /// Resumes a gated, in-flight `run(_:)`.
    func release() {
        releaseContinuation?.resume()
        releaseContinuation = nil
    }
}

/// Records `onClear` invocations. Lock-guarded so it satisfies the `@Sendable` closure under Swift 6
/// strict concurrency.
private final class ClearSpy: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = 0

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func bump() {
        lock.lock()
        storage += 1
        lock.unlock()
    }
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyBulkActionsTelemetry: BulkActionsToolbarTelemetry, @unchecked Sendable {
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
