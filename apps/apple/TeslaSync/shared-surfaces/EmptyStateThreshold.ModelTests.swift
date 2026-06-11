//
//  EmptyStateThreshold.ModelTests.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  State-holder coverage for `EmptyStateThresholdModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent, re-armed by `stop()`), the phase transitions across every state
//  (loading / empty / error / threshold), the CTA-capability derivation from the supplied handler,
//  the connection axis (live / stale / offline) with the one-shot stale auto-refresh (re-armed on
//  return to live), offline keeping the card without auto-refreshing, the handler-forwarded CTA, and
//  the controlled source. Driven through the in-memory seams — no network, no real time.
//

import XCTest
@testable import TeslaSync

private func sampleGate(current: Int = 5, threshold: Int = 30) -> EmptyStateThresholdGate {
    EmptyStateThresholdGate(
        currentCount: current,
        threshold: threshold,
        sectionLabel: .verbatim("Cost Heatmap"),
        itemNoun: .verbatim("sessions"),
        actionLabel: .verbatim("Adjust filters")
    )
}

// MARK: - Model (state-holder)

@MainActor
final class EmptyStateThresholdModelTests: XCTestCase {
    private func makeModel(
        _ input: EmptyStateThresholdInput,
        telemetry: EmptyStateThresholdTelemetry = OSLogEmptyStateThresholdTelemetry(),
        onAction: (@MainActor () -> Void)? = nil
    ) -> (EmptyStateThresholdModel, InMemoryEmptyStateThresholdSource) {
        let source = InMemoryEmptyStateThresholdSource(initial: input)
        let model = EmptyStateThresholdModel(source: source, telemetry: telemetry, onAction: onAction)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyEmptyStateThresholdTelemetry()
        let (model, source) = makeModel(EmptyStateThresholdInput(gate: sampleGate()), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .threshold)
        XCTAssertEqual(model.resolved.content?.sectionLabel, .verbatim("Cost Heatmap"))
        XCTAssertEqual(spy.surfaces, [EmptyStateThreshold.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCanActDerivedFromHandler() {
        let (withHandler, _) = makeModel(EmptyStateThresholdInput(), onAction: {})
        XCTAssertTrue(withHandler.canAct)
        let (withoutHandler, _) = makeModel(EmptyStateThresholdInput())
        XCTAssertFalse(withoutHandler.canAct)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(EmptyStateThresholdInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoGateProjectsEmpty() {
        let (model, _) = makeModel(EmptyStateThresholdInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.resolved.content)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(EmptyStateThresholdInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToThreshold() {
        let (model, source) = makeModel(EmptyStateThresholdInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(EmptyStateThresholdInput(gate: sampleGate()))
        XCTAssertEqual(model.phase, .threshold)
        XCTAssertEqual(model.resolved.content?.showAction, false)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(EmptyStateThresholdInput(gate: sampleGate()))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(EmptyStateThresholdInput(gate: sampleGate(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(EmptyStateThresholdInput(gate: sampleGate(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(EmptyStateThresholdInput(gate: sampleGate()))
        model.start()
        source.push(EmptyStateThresholdInput(gate: sampleGate(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(EmptyStateThresholdInput(gate: sampleGate(), connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(EmptyStateThresholdInput(gate: sampleGate(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCardAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(EmptyStateThresholdInput(gate: sampleGate()))
        model.start()
        source.push(EmptyStateThresholdInput(gate: sampleGate(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .threshold)
        XCTAssertNotNil(model.resolved.content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(EmptyStateThresholdInput(gate: sampleGate()))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopReArmsStartAndTelemetry() {
        let spy = SpyEmptyStateThresholdTelemetry()
        let (model, source) = makeModel(EmptyStateThresholdInput(), telemetry: spy)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(EmptyStateThreshold.surfaceSlug, "EmptyStateThreshold")
    }
}

// MARK: - Actions (web `action`)

@MainActor
final class EmptyStateThresholdActionTests: XCTestCase {
    func testActionForwardsToHandler() {
        var acted = 0
        let source = InMemoryEmptyStateThresholdSource(initial: EmptyStateThresholdInput(gate: sampleGate()))
        let model = EmptyStateThresholdModel(source: source, onAction: { acted += 1 })
        model.start()
        model.performAction()
        XCTAssertEqual(acted, 1)
    }

    func testActionIsNoOpWhenNoHandlerSupplied() {
        let source = InMemoryEmptyStateThresholdSource(initial: EmptyStateThresholdInput(gate: sampleGate()))
        let model = EmptyStateThresholdModel(source: source)
        model.start()
        model.performAction()
        XCTAssertFalse(model.canAct)
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticEmptyStateThresholdSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticEmptyStateThresholdSource(gate: sampleGate())
        var inputs: [EmptyStateThresholdInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.gate, sampleGate())
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticEmptyStateThresholdSource(gate: sampleGate())
        var inputs: [EmptyStateThresholdInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(EmptyStateThresholdInput(connection: .offline))
        XCTAssertEqual(inputs.last?.connection, .offline)
        XCTAssertNil(inputs.last?.gate)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyEmptyStateThresholdTelemetry: EmptyStateThresholdTelemetry, @unchecked Sendable {
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
