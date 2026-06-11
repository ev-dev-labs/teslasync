//
//  CookieConsentBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  State-holder coverage for `CookieConsentModel` plus its seams and projection:
//    • Telemetry — the P1/S11 `view.opened` event (once + idempotent).
//    • Visibility — the web `return null` guard driven by the policy flag + the stored decision.
//    • Reporter mirroring — the web `useEffect([requireConsent])` pushed into the reporter sink on
//      every policy change.
//    • Decisions — Accept / Decline persist to the store AND dismiss the banner; the external Settings →
//      Privacy reset re-surfaces it.
//    • Disclosure — the inline Manage / Hide toggle.
//    • Freshness — the one-shot stale auto-refresh (re-armed on return to fresh), offline keeping the
//      cached flag, and the manual refresh delegation.
//    • Projection — the status chip is suppressed unless the banner is presented.
//  Driven through the in-memory seams — no network, no real store. Runs in the TeslaSync(/-macOS)
//  XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Projection (render branches + P4 leaf contract)

final class CookieConsentProjectionTests: XCTestCase {
    func testPresentedWhenRequiredAndUndecided() {
        let resolved = CookieConsentProjection.resolve(
            requireConsent: true,
            decision: .unknown,
            showDetails: false,
            status: .loaded,
            freshness: .fresh
        )
        XCTAssertEqual(resolved.visibility, .presented)
        XCTAssertNil(resolved.statusChip)
    }

    func testDormantSuppressesStatusChipEvenWhenStale() {
        // Not required → dormant → no chip, even though the policy is stale.
        let resolved = CookieConsentProjection.resolve(
            requireConsent: false,
            decision: .unknown,
            showDetails: false,
            status: .loaded,
            freshness: .stale
        )
        XCTAssertEqual(resolved.visibility, .dormant)
        XCTAssertNil(resolved.statusChip)
    }

    func testPresentedKeepsStatusChipWhenStale() {
        let resolved = CookieConsentProjection.resolve(
            requireConsent: true,
            decision: .unknown,
            showDetails: true,
            status: .loaded,
            freshness: .stale
        )
        XCTAssertEqual(resolved.visibility, .presented)
        XCTAssertEqual(resolved.statusChip?.tone, .stale)
        XCTAssertTrue(resolved.showDetails)
    }
}

// MARK: - Test harness (bundles the model + its in-memory seams; avoids a large tuple)

@MainActor
private struct ConsentHarness {
    let model: CookieConsentModel
    let policy: InMemoryConsentPolicySource
    let store: InMemoryConsentDecisionStore

    init(
        requireConsent: Bool = true,
        decision: ConsentDecision = .unknown,
        status: ConsentPolicyStatus = .loaded,
        freshness: ConsentPolicyFreshness = .fresh,
        telemetry: CookieConsentTelemetry = OSLogCookieConsentTelemetry(),
        reporters: ReporterConsentSink = NoopReporterConsentSink()
    ) {
        policy = InMemoryConsentPolicySource(
            initial: ConsentPolicyUpdate(status: status, freshness: freshness, requireConsent: requireConsent)
        )
        store = InMemoryConsentDecisionStore(initial: decision)
        model = CookieConsentModel(policy: policy, store: store, reporters: reporters, telemetry: telemetry)
    }
}

// MARK: - Model (state-holder)

@MainActor
final class CookieConsentModelTests: XCTestCase {
    func testStartEmitsTelemetryOnceAndSubscribes() {
        let spy = SpyCookieConsentTelemetry()
        let env = ConsentHarness(telemetry: spy)
        env.model.start()
        env.model.start()
        XCTAssertEqual(spy.surfaces, [CookieConsentDiagnostics.surface])
        XCTAssertEqual(env.policy.startCount, 1)
        XCTAssertEqual(env.store.startCount, 1)
        XCTAssertTrue(env.model.isPresented)
    }

    func testRequiredAndUnknownIsPresented() {
        let env = ConsentHarness(requireConsent: true, decision: .unknown)
        env.model.start()
        XCTAssertEqual(env.model.visibility, .presented)
    }

    func testNotRequiredIsDormant() {
        let env = ConsentHarness(requireConsent: false, decision: .unknown)
        env.model.start()
        XCTAssertEqual(env.model.visibility, .dormant)
        XCTAssertFalse(env.model.isPresented)
    }

    func testAlreadyDecidedIsDormant() {
        for decision in [ConsentDecision.accepted, .declined] {
            let env = ConsentHarness(requireConsent: true, decision: decision)
            env.model.start()
            XCTAssertEqual(env.model.visibility, .dormant)
        }
    }

    func testReporterMirrorsPolicyFlagOnEachChange() {
        let sink = RecordingReporterConsentSink()
        let env = ConsentHarness(requireConsent: true, reporters: sink)
        env.model.start()
        XCTAssertEqual(sink.values, [true])
        env.policy.push(ConsentPolicyUpdate(status: .loaded, requireConsent: false))
        XCTAssertEqual(sink.values, [true, false])
    }

    func testAcceptRecordsDecisionAndDismisses() {
        let env = ConsentHarness()
        env.model.start()
        XCTAssertTrue(env.model.isPresented)
        env.model.choose(.accept)
        XCTAssertEqual(env.store.setCalls, [.accepted])
        XCTAssertEqual(env.model.resolved.decision, .accepted)
        XCTAssertEqual(env.model.visibility, .dormant)
    }

    func testDeclineRecordsDecisionAndDismisses() {
        let env = ConsentHarness()
        env.model.start()
        env.model.choose(.decline)
        XCTAssertEqual(env.store.setCalls, [.declined])
        XCTAssertEqual(env.model.visibility, .dormant)
    }

    func testExternalResetReSurfacesBanner() {
        let env = ConsentHarness()
        env.model.start()
        env.model.choose(.accept)
        XCTAssertEqual(env.model.visibility, .dormant)
        // A Settings → Privacy reset (web `subscribeConsent` → 'unknown') flips the banner back on.
        env.store.external(.unknown)
        XCTAssertEqual(env.model.visibility, .presented)
    }

    func testToggleDetailsFlips() {
        let env = ConsentHarness()
        env.model.start()
        XCTAssertFalse(env.model.showDetails)
        env.model.toggleDetails()
        XCTAssertTrue(env.model.showDetails)
        XCTAssertTrue(env.model.resolved.showDetails)
        env.model.toggleDetails()
        XCTAssertFalse(env.model.showDetails)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let env = ConsentHarness(freshness: .fresh)
        env.model.start()
        XCTAssertEqual(env.policy.refreshCount, 0)
        env.policy.push(ConsentPolicyUpdate(status: .loaded, freshness: .stale, requireConsent: true))
        XCTAssertEqual(env.policy.refreshCount, 1)
        // A second stale snapshot must NOT re-trigger the one-shot refresh.
        env.policy.push(ConsentPolicyUpdate(status: .loaded, freshness: .stale, requireConsent: true))
        XCTAssertEqual(env.policy.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToFresh() {
        let env = ConsentHarness(freshness: .fresh)
        env.model.start()
        env.policy.push(ConsentPolicyUpdate(status: .loaded, freshness: .stale, requireConsent: true))
        XCTAssertEqual(env.policy.refreshCount, 1)
        env.policy.push(ConsentPolicyUpdate(status: .loaded, freshness: .fresh, requireConsent: true))
        env.policy.push(ConsentPolicyUpdate(status: .loaded, freshness: .stale, requireConsent: true))
        XCTAssertEqual(env.policy.refreshCount, 2)
    }

    func testOfflineKeepsCachedAndDoesNotAutoRefresh() {
        let env = ConsentHarness(freshness: .fresh)
        env.model.start()
        env.policy.push(ConsentPolicyUpdate(status: .loaded, freshness: .offline, requireConsent: true))
        XCTAssertEqual(env.policy.refreshCount, 0)
        XCTAssertEqual(env.model.visibility, .presented)
        XCTAssertEqual(env.model.resolved.statusChip?.tone, .offline)
    }

    func testManualRefreshDelegatesToPolicy() {
        let env = ConsentHarness()
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.policy.refreshCount, 1)
    }

    func testStopHaltsBothSeamsAndReArms() {
        let env = ConsentHarness()
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.policy.stopCount, 1)
        XCTAssertEqual(env.store.stopCount, 1)
        env.model.start()
        XCTAssertEqual(env.policy.startCount, 2)
        XCTAssertEqual(env.store.startCount, 2)
    }

    func testFailedWithCachedRequireConsentStaysPresentedWithErrorChip() {
        let env = ConsentHarness()
        env.model.start()
        env.policy.push(ConsentPolicyUpdate(status: .failed("timeout"), freshness: .fresh, requireConsent: true))
        XCTAssertEqual(env.model.visibility, .presented)
        XCTAssertEqual(env.model.resolved.statusChip?.tone, .error)
        XCTAssertEqual(env.model.resolved.statusChip?.showsRetry, true)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(CookieConsentBanner.surfaceSlug, "CookieConsentBanner")
        XCTAssertEqual(CookieConsentDiagnostics.surface, "CookieConsentBanner")
    }
}

// MARK: - Seams (production parity of the policy + decision feeds)

@MainActor
final class CookieConsentSourceTests: XCTestCase {
    func testPolicySourceReEmitsOnRefresh() {
        let source = InMemoryConsentPolicySource(
            initial: ConsentPolicyUpdate(status: .loaded, requireConsent: true)
        )
        var updates: [ConsentPolicyUpdate] = []
        source.onUpdate = { updates.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(updates.count, 2)
        XCTAssertEqual(updates.last?.requireConsent, true)
    }

    func testDecisionStoreRecordsSetAndEchoes() {
        let store = InMemoryConsentDecisionStore(initial: .unknown)
        var changes: [ConsentDecision] = []
        store.onChange = { changes.append($0) }
        store.start()
        store.set(.accepted)
        XCTAssertEqual(store.setCalls, [.accepted])
        XCTAssertEqual(changes, [.unknown, .accepted])
    }

    func testDecisionStoreExternalChangeEchoesWithoutRecordingSet() {
        let store = InMemoryConsentDecisionStore(initial: .accepted)
        var changes: [ConsentDecision] = []
        store.onChange = { changes.append($0) }
        store.external(.unknown)
        XCTAssertEqual(changes, [.unknown])
        XCTAssertTrue(store.setCalls.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyCookieConsentTelemetry: CookieConsentTelemetry, @unchecked Sendable {
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
