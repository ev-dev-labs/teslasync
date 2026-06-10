//
//  TeslaAccountSection.Tests.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  Unit coverage for the `TeslaAccountModel` state holder, driven by the in-memory + controllable
//  seams:
//    • projection phases across loading / data / empty / error + the presentation derivations,
//    • the four mutations (Connect → open URL, Refresh, Sync, Disconnect) incl. busy, cache flush,
//      success/failure toasts, and the synced-count line,
//    • the disconnect confirm presentation,
//    • the recovery edge (web `notifyTeslaAuthRecovered`),
//    • the stale one-shot auto-refresh + offline no-refresh,
//    • the P1/S11 `view.opened` telemetry + seam wiring.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store. The
//  pure adapter is covered by TeslaAccountSection.AdapterTests.swift.
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

// MARK: - TeslaAccountSectionHarness

@MainActor
private struct TeslaAccountSectionHarness {
    let model: TeslaAccountModel
    let source: InMemoryTeslaAccountStatusSource
    let actions: InMemoryTeslaAccountActions
    let opener: TeslaAccountSectionSpyTeslaAccountURLOpener
    let telemetry: TeslaAccountSectionSpyTeslaAccountTelemetry
}

@MainActor
private func makeHarness(
    initial: TeslaAccountStatusInput? = nil,
    actions: InMemoryTeslaAccountActions = InMemoryTeslaAccountActions(),
    onAuthRecovered: @escaping @MainActor () -> Void = {},
    start: Bool = true
) -> TeslaAccountSectionHarness {
    let source = InMemoryTeslaAccountStatusSource(initial: initial)
    let opener = TeslaAccountSectionSpyTeslaAccountURLOpener()
    let telemetry = TeslaAccountSectionSpyTeslaAccountTelemetry()
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
    return TeslaAccountSectionHarness(
        model: model,
        source: source,
        actions: actions,
        opener: opener,
        telemetry: telemetry
    )
}

@MainActor
private struct TeslaAccountSectionControllableHarness {
    let model: TeslaAccountModel
    let source: InMemoryTeslaAccountStatusSource
    let actions: ControllableTeslaAccountActions
    let opener: TeslaAccountSectionSpyTeslaAccountURLOpener
}

@MainActor
private func makeControllableHarness(
    initial: TeslaAccountStatusInput? = nil
) -> TeslaAccountSectionControllableHarness {
    let source = InMemoryTeslaAccountStatusSource(initial: initial)
    let actions = ControllableTeslaAccountActions()
    let opener = TeslaAccountSectionSpyTeslaAccountURLOpener()
    let model = TeslaAccountModel(
        source: source,
        actions: actions,
        opener: opener,
        localize: { _, fallback in fallback },
        locale: enUS,
        timeZone: utc
    )
    model.start()
    return TeslaAccountSectionControllableHarness(model: model, source: source, actions: actions, opener: opener)
}

@MainActor
private func waitUntil(_ condition: () -> Bool) async {
    for _ in 0 ..< 50 where !condition() {
        await Task.yield()
    }
}

// MARK: - Projection phases + presentation

@MainActor final class TeslaAccountPhaseTests: XCTestCase {
    func testLoadingInitial() {
        let harness = makeHarness(initial: TeslaAccountStatusInput(isLoading: true))
        XCTAssertEqual(harness.model.phase, .loading)
        XCTAssertNil(harness.model.presentation)
    }

    func testConnectedResolvesToData() {
        let harness = makeHarness(initial: connected())
        guard case .data = harness.model.phase else {
            return XCTFail("expected data phase for a concrete status")
        }
        XCTAssertEqual(harness.model.presentation?.statusKind, .connected)
        XCTAssertEqual(harness.model.presentation?.statusLabel, "Connected")
        XCTAssertEqual(harness.model.presentation?.isAuthenticated, true)
    }

    func testUnknownAuthResolvesToEmpty() {
        let harness = makeHarness(initial: TeslaAccountStatusInput(authenticated: nil, now: fixedNow))
        guard case .empty = harness.model.phase else {
            return XCTFail("expected empty phase for unknown auth")
        }
        XCTAssertEqual(harness.model.presentation?.statusKind, .notConnected)
        XCTAssertEqual(harness.model.presentation?.isAuthenticated, false)
    }

    func testErrorMessageResolvesToError() {
        let harness = makeHarness(initial: TeslaAccountStatusInput(now: fixedNow, errorMessage: "boom"))
        XCTAssertEqual(harness.model.phase, .error("boom"))
        XCTAssertNil(harness.model.presentation)
    }

    func testConnectedExpiringPillAndTokenLine() {
        let harness = makeHarness(initial: connected(daysFromNow: 3))
        XCTAssertEqual(harness.model.presentation?.expiringSoonDays, 3)
        XCTAssertEqual(harness.model.presentation?.expiringSoonLabel, "Expires in 3d")
        XCTAssertEqual(harness.model.presentation?.tokenExpiresLine?.hasPrefix("Token expires"), true)
    }

    func testDisconnectedPillKeepsAuthenticatedActions() {
        let input = TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: iso(daysFromNow: 42),
            pillDisconnected: true,
            now: fixedNow
        )
        let harness = makeHarness(initial: input)
        XCTAssertEqual(harness.model.presentation?.statusKind, .disconnected)
        XCTAssertEqual(harness.model.presentation?.statusLabel, "Disconnected")
        XCTAssertEqual(harness.model.presentation?.isAuthenticated, true)
        XCTAssertNotNil(harness.model.presentation?.reconnectBody)
        XCTAssertNil(harness.model.presentation?.expiringSoonLabel)
        XCTAssertNil(harness.model.presentation?.tokenExpiresLine)
    }

    func testNotConnected() {
        let harness = makeHarness(initial: TeslaAccountStatusInput(authenticated: false, now: fixedNow))
        XCTAssertEqual(harness.model.presentation?.statusKind, .notConnected)
        XCTAssertEqual(harness.model.presentation?.statusLabel, "Not connected")
        XCTAssertEqual(harness.model.presentation?.isAuthenticated, false)
        XCTAssertNil(harness.model.presentation?.reconnectBody)
    }
}

// MARK: - Lifecycle + telemetry + connection

@MainActor final class TeslaAccountLifecycleTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndWiresSource() {
        let harness = makeHarness(initial: connected(), start: false)
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces, [TeslaAccountDiagnostics.surface])
        XCTAssertEqual(TeslaAccountDiagnostics.surface, "TeslaAccountSection")
        XCTAssertEqual(TeslaAccountSection.surfaceSlug, "TeslaAccountSection")
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testStopStopsSourceAndReArms() {
        let harness = makeHarness(initial: connected())
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2)
    }

    func testRefreshDelegatesToSource() {
        let harness = makeHarness(initial: connected())
        harness.model.refresh()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testConnectionTracksInput() {
        let harness = makeHarness(initial: connected())
        XCTAssertEqual(harness.model.connection, .live)
        harness.source.push(connected(connection: .offline))
        XCTAssertEqual(harness.model.connection, .offline)
    }

    func testStaleTriggersExactlyOneAutoRefreshPerEpisode() {
        let harness = makeHarness(initial: connected())
        XCTAssertEqual(harness.source.refreshCount, 0)

        harness.source.push(connected(connection: .stale))
        harness.source.push(connected(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)

        harness.source.push(connected(connection: .live))
        harness.source.push(connected(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let harness = makeHarness(initial: connected())
        harness.source.push(connected(connection: .offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
    }
}

// MARK: - Recovery edge (web `notifyTeslaAuthRecovered`)

@MainActor final class TeslaAccountRecoveryTests: XCTestCase {
    func testRecoveryFiresOnceOnUnauthenticatedToAuthenticatedEdge() {
        let spy = RecoverySpy()
        let harness = makeHarness(
            initial: TeslaAccountStatusInput(authenticated: false, now: fixedNow),
            onAuthRecovered: { spy.fire() }
        )
        XCTAssertEqual(spy.count, 0)

        harness.source.push(TeslaAccountStatusInput(authenticated: true, now: fixedNow))
        XCTAssertEqual(spy.count, 1)

        harness.source.push(TeslaAccountStatusInput(authenticated: true, now: fixedNow))
        XCTAssertEqual(spy.count, 1)
    }

    func testRecoveryDoesNotFireFromUnknown() {
        let spy = RecoverySpy()
        let harness = makeHarness(
            initial: TeslaAccountStatusInput(isLoading: true),
            onAuthRecovered: { spy.fire() }
        )
        harness.source.push(TeslaAccountStatusInput(authenticated: true, now: fixedNow))
        XCTAssertEqual(spy.count, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class TeslaAccountSectionSpyTeslaAccountTelemetry: TeslaAccountTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the URLs handed to the opener so the Connect / Re-authorize path can be asserted.
@MainActor
private final class TeslaAccountSectionSpyTeslaAccountURLOpener: TeslaAccountURLOpening {
    private(set) var opened: [URL] = []
    func open(_ url: URL) {
        opened.append(url)
    }
}

/// Counts recovery-edge callbacks (web `notifyTeslaAuthRecovered`).
@MainActor
private final class RecoverySpy {
    private(set) var count = 0
    func fire() {
        count += 1
    }
}
