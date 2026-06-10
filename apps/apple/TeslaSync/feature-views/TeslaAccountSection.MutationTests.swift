//
//  TeslaAccountSection.MutationTests.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  Unit coverage for the `TeslaAccountModel` mutations, driven by the in-memory + controllable seams:
//  Connect (→ open URL), Refresh, Sync, Disconnect, and the toast lifecycle — incl. the in-flight busy
//  state, the cache flush, the synced-count line, and the success/failure toasts. Phase / lifecycle /
//  recovery coverage lives in TeslaAccountSection.Tests.swift; the pure adapter in
//  TeslaAccountSection.AdapterTests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? .current
private let fixedNow = Date(timeIntervalSince1970: 1_750_000_000)

private func iso(daysFromNow days: Double) -> String {
    let date = fixedNow.addingTimeInterval(days * 24 * 60 * 60)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

private func connected(
    connection: TeslaAccountConnection = .live,
    daysFromNow: Double = 42
) -> TeslaAccountStatusInput {
    TeslaAccountStatusInput(
        authenticated: true,
        expiresAtRaw: iso(daysFromNow: daysFromNow),
        now: fixedNow,
        connection: connection
    )
}

// MARK: - Harness

@MainActor
private struct Harness {
    let model: TeslaAccountModel
    let source: InMemoryTeslaAccountStatusSource
    let actions: InMemoryTeslaAccountActions
    let opener: SpyTeslaAccountURLOpener
    let telemetry: SpyTeslaAccountTelemetry
}

@MainActor
private func makeHarness(
    initial: TeslaAccountStatusInput? = nil,
    actions: InMemoryTeslaAccountActions = InMemoryTeslaAccountActions(),
    onAuthRecovered: @escaping @MainActor () -> Void = {},
    start: Bool = true
) -> Harness {
    let source = InMemoryTeslaAccountStatusSource(initial: initial)
    let opener = SpyTeslaAccountURLOpener()
    let telemetry = SpyTeslaAccountTelemetry()
    let model = TeslaAccountModel(
        source: source,
        actions: actions,
        opener: opener,
        telemetry: telemetry,
        localize: { _, fallback in fallback },
        locale: enUS,
        timeZone: utc,
        onAuthRecovered: onAuthRecovered
    )
    if start { model.start() }
    return Harness(model: model, source: source, actions: actions, opener: opener, telemetry: telemetry)
}

@MainActor
private struct ControllableHarness {
    let model: TeslaAccountModel
    let source: InMemoryTeslaAccountStatusSource
    let actions: ControllableTeslaAccountActions
    let opener: SpyTeslaAccountURLOpener
}

@MainActor
private func makeControllableHarness(
    initial: TeslaAccountStatusInput? = nil
) -> ControllableHarness {
    let source = InMemoryTeslaAccountStatusSource(initial: initial)
    let actions = ControllableTeslaAccountActions()
    let opener = SpyTeslaAccountURLOpener()
    let model = TeslaAccountModel(
        source: source,
        actions: actions,
        opener: opener,
        localize: { _, fallback in fallback },
        locale: enUS,
        timeZone: utc
    )
    model.start()
    return ControllableHarness(model: model, source: source, actions: actions, opener: opener)
}

@MainActor
private func waitUntil(_ condition: () -> Bool) async {
    for _ in 0 ..< 50 where !condition() {
        await Task.yield()
    }
}

// MARK: - Projection phases + presentation

// MARK: - Connect (web `useAuthURL` → open URL)

@MainActor final class TeslaAccountConnectTests: XCTestCase {
    func testConnectSuccessOpensURL() async {
        let url = URL(string: "https://auth.tesla.com/oauth2/v3/authorize?state=x") ?? TeslaAccountDefaults.authURL
        let harness = makeHarness(
            initial: connected(),
            actions: InMemoryTeslaAccountActions(authURLResult: .success(url))
        )
        await harness.model.connect()
        XCTAssertEqual(harness.opener.opened, [url])
        XCTAssertFalse(harness.model.isConnecting)
        XCTAssertNil(harness.model.toast)
    }

    func testConnectFailureToasts() async {
        let harness = makeHarness(
            initial: connected(),
            actions: InMemoryTeslaAccountActions(authURLResult: .failure(.failed(message: "no url")))
        )
        await harness.model.connect()
        XCTAssertTrue(harness.opener.opened.isEmpty)
        XCTAssertEqual(harness.model.toast?.kind, .error)
        XCTAssertEqual(harness.model.toast?.detail, "no url")
    }

    func testConnectInFlightBusyThenOpens() async {
        let harness = makeControllableHarness(initial: connected())
        let url = TeslaAccountDefaults.authURL
        let task = Task { await harness.model.connect() }
        await waitUntil { harness.model.isConnecting }
        XCTAssertTrue(harness.model.isConnecting)

        harness.actions.completeAuthURL(url)
        await task.value
        XCTAssertEqual(harness.opener.opened, [url])
        XCTAssertFalse(harness.model.isConnecting)
    }
}

// MARK: - Refresh token (web `useRefreshAuth`)

@MainActor final class TeslaAccountRefreshTests: XCTestCase {
    func testRefreshSuccessTogglesToastAndInvalidates() async {
        let actions = InMemoryTeslaAccountActions(refreshResult: .success(()))
        let harness = makeHarness(initial: connected(), actions: actions)
        await harness.model.refreshToken()
        XCTAssertEqual(actions.refreshCount, 1)
        XCTAssertEqual(actions.invalidateCount, 1)
        XCTAssertEqual(harness.model.toast?.kind, .success)
        XCTAssertEqual(harness.model.toast?.title, "Token refreshed")
        XCTAssertFalse(harness.model.isRefreshing)
    }

    func testRefreshFailureToastsDetail() async {
        let actions = InMemoryTeslaAccountActions(refreshResult: .failure(.failed(message: "REFRESH_DENIED")))
        let harness = makeHarness(initial: connected(), actions: actions)
        await harness.model.refreshToken()
        XCTAssertEqual(harness.model.toast?.kind, .error)
        XCTAssertEqual(harness.model.toast?.title, "Token refresh failed")
        XCTAssertEqual(harness.model.toast?.detail, "REFRESH_DENIED")
        XCTAssertEqual(actions.invalidateCount, 0)
    }

    func testRefreshOfflineToastsOfflineDetail() async {
        let actions = InMemoryTeslaAccountActions(refreshResult: .failure(.offline))
        let harness = makeHarness(initial: connected(), actions: actions)
        await harness.model.refreshToken()
        XCTAssertEqual(
            harness.model.toast?.detail,
            "You appear to be offline. Check your connection and try again."
        )
    }
}

// MARK: - Sync vehicles (web `useSyncVehicles`)

@MainActor final class TeslaAccountSyncTests: XCTestCase {
    func testSyncSuccessSetsCountWithoutToast() async {
        let actions = InMemoryTeslaAccountActions(syncResult: .success(3))
        let harness = makeHarness(initial: connected(), actions: actions)
        await harness.model.syncVehicles()
        XCTAssertEqual(harness.model.syncedCount, 3)
        XCTAssertNil(harness.model.toast)
        XCTAssertEqual(actions.syncCount, 1)
    }

    func testSyncFailureToastsAndLeavesNoCount() async {
        let actions = InMemoryTeslaAccountActions(syncResult: .failure(.failed(message: "SYNC_BAD")))
        let harness = makeHarness(initial: connected(), actions: actions)
        await harness.model.syncVehicles()
        XCTAssertNil(harness.model.syncedCount)
        XCTAssertEqual(harness.model.toast?.kind, .error)
        XCTAssertEqual(harness.model.toast?.title, "Vehicle sync failed")
        XCTAssertEqual(harness.model.toast?.detail, "SYNC_BAD")
    }

    func testSyncInFlightBusyThenCount() async {
        let harness = makeControllableHarness(initial: connected())
        let task = Task { await harness.model.syncVehicles() }
        await waitUntil { harness.model.isSyncing }
        XCTAssertTrue(harness.model.isSyncing)

        harness.actions.completeSync(5)
        await task.value
        XCTAssertEqual(harness.model.syncedCount, 5)
        XCTAssertFalse(harness.model.isSyncing)
    }
}

// MARK: - Disconnect (web `useConfirm` → `useDisconnectAuth`)

@MainActor final class TeslaAccountDisconnectTests: XCTestCase {
    func testRequestAndCancel() {
        let harness = makeHarness(initial: connected())
        harness.model.requestDisconnect()
        XCTAssertTrue(harness.model.disconnectPresented)
        harness.model.cancelDisconnect()
        XCTAssertFalse(harness.model.disconnectPresented)
    }

    func testConfirmSuccessInvalidatesAndToasts() async {
        let actions = InMemoryTeslaAccountActions(disconnectResult: .success(()))
        let harness = makeHarness(initial: connected(), actions: actions)
        harness.model.requestDisconnect()
        await harness.model.confirmDisconnect()
        XCTAssertFalse(harness.model.disconnectPresented)
        XCTAssertFalse(harness.model.isDisconnecting)
        XCTAssertEqual(actions.disconnectCount, 1)
        XCTAssertEqual(actions.invalidateCount, 1)
        XCTAssertEqual(harness.model.toast?.kind, .success)
        XCTAssertEqual(harness.model.toast?.title, "Tesla account disconnected")
    }

    func testConfirmOfflineToasts() async {
        let actions = InMemoryTeslaAccountActions(disconnectResult: .failure(.offline))
        let harness = makeHarness(initial: connected(), actions: actions)
        harness.model.requestDisconnect()
        await harness.model.confirmDisconnect()
        XCTAssertEqual(harness.model.toast?.kind, .error)
        XCTAssertEqual(harness.model.toast?.title, "Disconnect failed")
        XCTAssertEqual(
            harness.model.toast?.detail,
            "You appear to be offline. Check your connection and try again."
        )
        XCTAssertEqual(actions.invalidateCount, 0)
    }

    func testConfirmInFlightBusyThenSuccess() async {
        let harness = makeControllableHarness(initial: connected())
        harness.model.requestDisconnect()
        let task = Task { await harness.model.confirmDisconnect() }
        await waitUntil { harness.model.isDisconnecting }
        XCTAssertTrue(harness.model.isDisconnecting)
        XCTAssertTrue(harness.model.disconnectPresented)

        harness.actions.completeDisconnect()
        await task.value
        XCTAssertFalse(harness.model.isDisconnecting)
        XCTAssertFalse(harness.model.disconnectPresented)
        XCTAssertEqual(harness.model.toast?.kind, .success)
        XCTAssertEqual(harness.actions.invalidateCount, 1)
    }
}

// MARK: - Toast

@MainActor final class TeslaAccountToastTests: XCTestCase {
    func testDismissToastClearsIt() async {
        let harness = makeHarness(initial: connected())
        await harness.model.refreshToken()
        XCTAssertNotNil(harness.model.toast)
        harness.model.dismissToast()
        XCTAssertNil(harness.model.toast)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTeslaAccountTelemetry: TeslaAccountTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the URLs handed to the opener so the Connect / Re-authorize path can be asserted.
@MainActor
private final class SpyTeslaAccountURLOpener: TeslaAccountURLOpening {
    private(set) var opened: [URL] = []
    func open(_ url: URL) {
        opened.append(url)
    }
}
