//
//  RequiresAuth.ModelTests.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  State-holder coverage for `RequiresAuthModel` (split from RequiresAuth.Tests.swift for the lint
//  file-length budget): the P1/S11 `view.opened` telemetry (once + idempotent), the gate/render
//  transitions across loading / loaded-locked / loaded-content / failed (incl. the cached-snapshot
//  survival when a reload fails), the title/body copy reacting to the resolved snapshot + provider
//  hint, the stale one-shot auto-refresh (re-armed on return to live), offline keeping the resolved
//  render, refresh/stop forwarding, the stable per-capability test-id, and the VoiceOver copy — plus
//  the in-memory source's emit / lifecycle counts. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Telemetry spy

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyRequiresAuthTelemetry: RequiresAuthTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

// MARK: - Model (state holder)

@MainActor
final class RequiresAuthModelTests: XCTestCase {
    private func makeModel(
        capability: RequiresAuthCapability = .totpEnrollment,
        feature: String = "TOTP enrollment",
        source: InMemoryRequiresAuthSource,
        telemetry: SpyRequiresAuthTelemetry = SpyRequiresAuthTelemetry()
    ) -> RequiresAuthModel {
        RequiresAuthModel(
            capability: capability,
            feature: feature,
            source: source,
            telemetry: telemetry,
            localize: { _, fallback in fallback }
        )
    }

    private func forwardAuthOn() -> AuthModeSnapshot {
        AuthModeSnapshot(mode: .forwardAuth, providerHint: "authentik", capabilities: .allEnabled)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyRequiresAuthTelemetry()
        let source = InMemoryRequiresAuthSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["RequiresAuth"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenLockedThenUnlockedTransitions() {
        let source = InMemoryRequiresAuthSource(initial: RequiresAuthUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.render, .loading)
        XCTAssertEqual(model.gate, .locked)

        source.push(RequiresAuthUpdate(status: .loaded, snapshot: .open))
        XCTAssertEqual(model.render, .locked)
        XCTAssertEqual(model.gate, .locked)

        source.push(RequiresAuthUpdate(status: .loaded, snapshot: forwardAuthOn()))
        XCTAssertEqual(model.render, .content)
        XCTAssertEqual(model.gate, .unlocked)
    }

    func testFailedFirstLoadRendersErrorThenRecovers() {
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .failed("503"), snapshot: nil)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.render, .error("503"))

        source.push(RequiresAuthUpdate(status: .loaded, snapshot: .open))
        XCTAssertEqual(model.render, .locked)
    }

    func testTitleAndBodyReflectTheResolvedSnapshot() {
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .loaded, snapshot: .open)
        )
        let model = makeModel(capability: .sessionList, feature: "Active sessions", source: source)
        model.start()
        XCTAssertEqual(model.title, "Active sessions requires authentication mode")
        XCTAssertTrue(model.body.contains("Authentik, Authelia, oauth2-proxy, Keycloak"))
        XCTAssertEqual(model.testID, "requires-auth-empty-session_list")

        // A provider hint flips the body template to the verbatim hint form.
        source.push(RequiresAuthUpdate(
            status: .loaded,
            snapshot: AuthModeSnapshot(mode: .forwardAuth, providerHint: "Authelia", capabilities: .allDisabled)
        ))
        XCTAssertTrue(model.body.contains("(Authelia)"))
        XCTAssertFalse(model.body.contains("Authentik, Authelia, oauth2-proxy, Keycloak"))
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .loaded, snapshot: .open)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RequiresAuthUpdate(status: .loaded, snapshot: .open, connection: .stale))
        source.push(RequiresAuthUpdate(status: .loaded, snapshot: .open, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(RequiresAuthUpdate(status: .loaded, snapshot: .open, connection: .live))
        source.push(RequiresAuthUpdate(status: .loaded, snapshot: .open, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsTheResolvedRenderAndDoesNotRefresh() {
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .loaded, snapshot: forwardAuthOn())
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.render, .content)

        source.push(RequiresAuthUpdate(status: .loaded, snapshot: forwardAuthOn(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.render, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshAndStopForwardToTheSource() {
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .loaded, snapshot: .open)
        )
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testAccessibilityLabelsResolve() {
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .loaded, snapshot: .open)
        )
        let model = makeModel(capability: .impersonation, feature: "Impersonation", source: source)
        model.start()
        XCTAssertTrue(
            model.lockNoticeAccessibilityLabel.hasPrefix("Impersonation requires authentication mode. ")
        )
        XCTAssertEqual(model.loadingAccessibilityLabel, "Checking access…")
        XCTAssertEqual(model.errorAccessibilityLabel(message: "503"), "Couldn't check access. 503")
    }
}

// MARK: - In-memory source

@MainActor
final class RequiresAuthSourceTests: XCTestCase {
    func testStartEmitsInitialAndCountsLifecycle() {
        var received: [RequiresAuthUpdate] = []
        let source = InMemoryRequiresAuthSource(
            initial: RequiresAuthUpdate(status: .loaded, snapshot: .open)
        )
        source.onUpdate = { received.append($0) }
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received.first?.snapshot, .open)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testPushForwardsToTheObserver() {
        var received: [RequiresAuthUpdate] = []
        let source = InMemoryRequiresAuthSource()
        source.onUpdate = { received.append($0) }
        source.start()
        source.push(RequiresAuthUpdate(status: .failed("x"), snapshot: nil))
        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received.first?.status, .failed("x"))
    }
}
