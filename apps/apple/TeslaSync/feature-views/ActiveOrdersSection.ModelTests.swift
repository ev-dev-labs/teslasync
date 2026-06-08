//
//  ActiveOrdersSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  State-holder coverage for `ActiveOrdersModel`: phase across loading / loaded /
//  the two empty variants / failed, the P1/S11 `view.opened` telemetry (once), the
//  manual-refresh toast (web mutation onSuccess / onError), the in-flight guard, the
//  silent retry + stale auto-refresh, and offline keeping cached orders. Driven
//  through in-memory sources; no network, no bundle. Fixtures live in `.Tests`.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: ActiveOrdersModel

@MainActor
final class ActiveOrdersModelTests: XCTestCase {
    private func makeModel(
        initial: OrdersUpdate?,
        telemetry: ActiveOrdersTelemetry = SpyOrdersTelemetry(),
        toast: ActiveOrdersToast = SpyOrdersToast(),
        nextOutcome: OrdersRefreshOutcome = .success
    ) -> (ActiveOrdersModel, InMemoryActiveOrdersSource) {
        let source = InMemoryActiveOrdersSource(initial: initial, nextOutcome: nextOutcome)
        let model = ActiveOrdersModel(source: source, telemetry: telemetry, toast: toast)
        return (model, source)
    }

    func testLoadedContentProjectsRowsAndFetchedAt() {
        let fetched = Date(timeIntervalSince1970: 1_775_000_000)
        let (model, source) = makeModel(initial: OrdersUpdate(
            status: .loaded,
            orders: [OrdersFixture.inProduction, OrdersFixture.readyForDelivery],
            fetchedAt: fetched
        ))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.orderCount, 2)
        XCTAssertEqual(model.fetchedAt, fetched)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyWithSyncResolvesEmptyFetched() {
        let (model, _) = makeModel(initial: OrdersUpdate(
            status: .loaded,
            orders: [],
            fetchedAt: Date(timeIntervalSince1970: 1_775_000_000)
        ))
        model.start()
        XCTAssertEqual(model.phase, .emptyFetched)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadedEmptyWithoutSyncResolvesEmptyNoData() {
        let (model, _) = makeModel(initial: OrdersUpdate(status: .loaded, orders: [], fetchedAt: nil))
        model.start()
        XCTAssertEqual(model.phase, .emptyNoData)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: OrdersUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: OrdersUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyOrdersTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ActiveOrdersSurface.slug])
    }

    func testRefreshSuccessShowsToast() {
        let toast = SpyOrdersToast()
        let (model, source) = makeModel(initial: nil, toast: toast, nextOutcome: .success)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(toast.successes, ["Orders refreshed"])
        XCTAssertTrue(toast.errors.isEmpty)
        XCTAssertFalse(model.refreshing)
    }

    func testRefreshFailureShowsErrorToast() {
        let toast = SpyOrdersToast()
        let (model, _) = makeModel(initial: nil, toast: toast, nextOutcome: .failure("network down"))
        model.start()
        model.refresh()
        XCTAssertEqual(toast.errors.count, 1)
        XCTAssertEqual(toast.errors.first?.title, "Failed to refresh orders")
        XCTAssertEqual(toast.errors.first?.detail, "network down")
        XCTAssertTrue(toast.successes.isEmpty)
    }

    func testRefreshIsGuardedWhileInFlight() {
        let toast = SpyOrdersToast()
        let source = ManualOrdersSource()
        let model = ActiveOrdersModel(source: source, telemetry: SpyOrdersTelemetry(), toast: toast)
        model.start()
        model.refresh()
        XCTAssertTrue(model.refreshing)
        XCTAssertEqual(source.refreshCount, 1)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1, "a second refresh while in flight must be ignored")
        source.complete(.success)
        XCTAssertFalse(model.refreshing)
        XCTAssertEqual(toast.successes.count, 1)
    }

    func testRetryIsSilentRefresh() {
        let toast = SpyOrdersToast()
        let (model, source) = makeModel(initial: OrdersUpdate(status: .failed("x")), toast: toast)
        model.start()
        model.retry()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertTrue(toast.successes.isEmpty)
        XCTAssertTrue(toast.errors.isEmpty)
        XCTAssertFalse(model.refreshing)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let orders = [OrdersFixture.inProduction]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(OrdersUpdate(status: .loaded, orders: orders, connection: .stale))
        source.push(OrdersUpdate(status: .loaded, orders: orders, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let orders = [OrdersFixture.inProduction]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(OrdersUpdate(status: .loaded, orders: orders, connection: .stale))
        source.push(OrdersUpdate(status: .loaded, orders: orders, connection: .live))
        source.push(OrdersUpdate(status: .loaded, orders: orders, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedOrdersWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(OrdersUpdate(
            status: .loaded,
            orders: [OrdersFixture.readyForDelivery],
            fetchedAt: Date(timeIntervalSince1970: 1_775_000_000),
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Test doubles

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyOrdersTelemetry: ActiveOrdersTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the toasts a model presents. Single-threaded test use only.
final class SpyOrdersToast: ActiveOrdersToast, @unchecked Sendable {
    private(set) var successes: [String] = []
    private(set) var errors: [(title: String, detail: String)] = []

    func success(_ message: String) {
        successes.append(message)
    }

    func error(_ title: String, _ detail: String) {
        errors.append((title: title, detail: detail))
    }
}

/// A source whose refresh completion is held until the test invokes `complete`,
/// so the in-flight guard + completion path can be exercised deterministically.
@MainActor
final class ManualOrdersSource: ActiveOrdersSource {
    var onUpdate: (@MainActor (OrdersUpdate) -> Void)?
    private(set) var refreshCount = 0
    private var pending: (@MainActor (OrdersRefreshOutcome) -> Void)?

    func start() {}
    func stop() {}

    func refresh(completion: @escaping @MainActor (OrdersRefreshOutcome) -> Void) {
        refreshCount += 1
        pending = completion
    }

    func complete(_ outcome: OrdersRefreshOutcome) {
        pending?(outcome)
        pending = nil
    }
}
