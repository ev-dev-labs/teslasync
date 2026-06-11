//
//  ServiceStatus.ModelTests.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  State-holder coverage for `ServiceStatusModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the 60-second poll driven by the manual poller (the web
//  `refetchInterval` parity — each fire re-requests the snapshot), the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live),
//  offline keeping the cached rollup, the manual refresh, and the controlled source. Driven through
//  the in-memory + manual seams — no network, no real time.
//

import XCTest
@testable import TeslaSync

@MainActor
final class ServiceStatusModelTests: XCTestCase {
    private func makeModel(
        _ input: ServiceStatusInput,
        poller: ServiceStatusPoller = ManualServiceStatusPoller(),
        telemetry: ServiceStatusTelemetry = OSLogServiceStatusTelemetry()
    ) -> (ServiceStatusModel, InMemoryServiceStatusSource) {
        let source = InMemoryServiceStatusSource(initial: input)
        let model = ServiceStatusModel(source: source, poller: poller, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyServiceStatusTelemetry()
        let (model, source) = makeModel(
            ServiceStatusInput(status: SystemStatusSnapshot(overall: "healthy")),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.level, .healthy)
        XCTAssertEqual(spy.surfaces, [ServiceStatus.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStartBeginsPolling() {
        let poller = ManualServiceStatusPoller()
        let (model, _) = makeModel(
            ServiceStatusInput(status: SystemStatusSnapshot(overall: "healthy")),
            poller: poller
        )
        model.start()
        XCTAssertTrue(poller.isRunning)
        XCTAssertEqual(poller.interval, ServiceStatusModel.refetchInterval)
    }

    func testPollFireRequestsTheSnapshot() {
        let poller = ManualServiceStatusPoller()
        let (model, source) = makeModel(
            ServiceStatusInput(status: SystemStatusSnapshot(overall: "healthy")),
            poller: poller
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        poller.fire()
        poller.fire()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(ServiceStatusInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoStatusProjectsEmpty() {
        let (model, _) = makeModel(ServiceStatusInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(ServiceStatusInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(ServiceStatusInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ServiceStatusInput(status: SystemStatusSnapshot(overall: "degraded")))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.level, .degraded)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let status = SystemStatusSnapshot(overall: "healthy")
        let (model, source) = makeModel(ServiceStatusInput(status: status))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ServiceStatusInput(status: status, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(ServiceStatusInput(status: status, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let status = SystemStatusSnapshot(overall: "healthy")
        let (model, source) = makeModel(ServiceStatusInput(status: status))
        model.start()
        source.push(ServiceStatusInput(status: status, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ServiceStatusInput(status: status, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(ServiceStatusInput(status: status, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedDataAndDoesNotAutoRefresh() {
        let status = SystemStatusSnapshot(overall: "degraded")
        let (model, source) = makeModel(ServiceStatusInput(status: status))
        model.start()
        source.push(ServiceStatusInput(status: status, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.level, .degraded)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(
            ServiceStatusInput(status: SystemStatusSnapshot(overall: "healthy"))
        )
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsPollerAndReArms() {
        let poller = ManualServiceStatusPoller()
        let (model, source) = makeModel(
            ServiceStatusInput(status: SystemStatusSnapshot(overall: "healthy")),
            poller: poller
        )
        model.start()
        XCTAssertTrue(poller.isRunning)
        model.stop()
        XCTAssertFalse(poller.isRunning)
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ServiceStatus.surfaceSlug, "ServiceStatus")
    }

    func testRefetchIntervalIsSixtySeconds() {
        XCTAssertEqual(ServiceStatusModel.refetchInterval, 60)
    }
}

// MARK: - Controlled source (production parity of the web query data)

@MainActor
final class StaticServiceStatusSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticServiceStatusSource(
            status: SystemStatusSnapshot(overall: "healthy"),
            connection: .live
        )
        var inputs: [ServiceStatusInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.status?.overall, "healthy")
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticServiceStatusSource(status: SystemStatusSnapshot(overall: "healthy"))
        var inputs: [ServiceStatusInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(ServiceStatusInput(
            status: SystemStatusSnapshot(overall: "down"),
            connection: .offline
        ))
        XCTAssertEqual(inputs.last?.status?.overall, "down")
        XCTAssertEqual(inputs.last?.connection, .offline)
    }
}

// MARK: - Poller (manual test double)

@MainActor
final class ManualServiceStatusPollerTests: XCTestCase {
    func testFireInvokesScheduledTick() {
        let poller = ManualServiceStatusPoller()
        var ticks = 0
        poller.start(interval: 60) { ticks += 1 }
        poller.fire()
        poller.fire()
        XCTAssertEqual(ticks, 2)
        XCTAssertEqual(poller.startCount, 1)
        XCTAssertTrue(poller.isRunning)
    }

    func testStopPreventsFurtherTicks() {
        let poller = ManualServiceStatusPoller()
        var ticks = 0
        poller.start(interval: 60) { ticks += 1 }
        poller.stop()
        poller.fire()
        XCTAssertEqual(ticks, 0)
        XCTAssertFalse(poller.isRunning)
        XCTAssertEqual(poller.stopCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyServiceStatusTelemetry: ServiceStatusTelemetry, @unchecked Sendable {
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
