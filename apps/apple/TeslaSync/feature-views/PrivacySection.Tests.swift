//
//  PrivacySection.Tests.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  Unit coverage for the `PrivacyModel` state holder, driven by the in-memory seams:
//    • phase resolution across loading / ready + the cached-flag fallback on failure,
//    • the recent-pages clear flow + the ConfirmDialog silence machinery,
//    • the consent mutations + their toasts,
//    • the stale one-shot auto-refresh + offline no-refresh,
//    • the P1/S11 `view.opened` telemetry + seam wiring.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store. The pure adapter is covered by PrivacySection.AdapterTests.swift.
//

import XCTest
@testable import TeslaSync

// MARK: - Harness

/// The bound model plus its in-memory seams, so each test can assert both the model's
/// projected state and the seam interactions without a multi-member tuple.
@MainActor
private struct PrivacyHarness {
    let model: PrivacyModel
    let environment: InMemoryPrivacyEnvironmentSource
    let recentPages: InMemoryRecentPagesStore
    let consentStore: InMemoryConsentStore
    let silenceStore: PrivacySectionInMemoryConfirmSilenceStore
}

@MainActor
private func makePrivacyHarness(
    initial: PrivacyEnvironmentUpdate? = PrivacyEnvironmentUpdate(status: .loaded),
    recent: Int = 0,
    consent: PrivacyConsentState = .unknown,
    silenced: Bool = false,
    telemetry: PrivacyTelemetry = OSLogPrivacyTelemetry(),
    start: Bool = true
) -> PrivacyHarness {
    let environment = InMemoryPrivacyEnvironmentSource(initial: initial)
    let recentPages = InMemoryRecentPagesStore(count: recent)
    let consentStore = InMemoryConsentStore(state: consent)
    let silenceStore = PrivacySectionInMemoryConfirmSilenceStore(silenced: silenced ? [PrivacyModel.confirmSilenceKey] : [])
    let model = PrivacyModel(
        environment: environment,
        recentPages: recentPages,
        consentStore: consentStore,
        silenceStore: silenceStore,
        telemetry: telemetry,
        localize: { _, fallback in fallback }
    )
    if start { model.start() }
    return PrivacyHarness(
        model: model,
        environment: environment,
        recentPages: recentPages,
        consentStore: consentStore,
        silenceStore: silenceStore
    )
}

// MARK: - Phases + freshness + telemetry

@MainActor
final class PrivacyModelLifecycleTests: XCTestCase {
    func testStartsInLoadingUntilPolicyResolves() {
        let harness = makePrivacyHarness(initial: PrivacyEnvironmentUpdate(status: .loading))
        XCTAssertEqual(harness.model.phase, .loading)

        harness.environment.push(PrivacyEnvironmentUpdate(status: .loaded, requireConsent: true))
        XCTAssertEqual(harness.model.phase, .ready)
        XCTAssertTrue(harness.model.requireConsent)
    }

    func testFailedPolicyRevealsSectionWithCachedFlag() {
        let harness = makePrivacyHarness(
            initial: PrivacyEnvironmentUpdate(status: .failed("net"), requireConsent: false)
        )
        XCTAssertEqual(harness.model.phase, .ready)
        XCTAssertEqual(harness.model.status, .failed("net"))
        XCTAssertFalse(harness.model.requireConsent)
    }

    func testStartSeedsRecentCountAndConsentFromStores() {
        let harness = makePrivacyHarness(recent: 9, consent: .declined)
        XCTAssertEqual(harness.model.recentCount, 9)
        XCTAssertEqual(harness.model.consent, .declined)
    }

    func testStartEmitsViewOpenedOnceAndWiresSources() {
        let spy = SpyPrivacyTelemetry()
        let harness = makePrivacyHarness(telemetry: spy)
        harness.model.start()
        XCTAssertEqual(spy.surfaces, [PrivacyDiagnostics.surface])
        XCTAssertEqual(harness.environment.startCount, 1)
    }

    func testStaleTriggersExactlyOneAutoRefreshPerEpisode() {
        let harness = makePrivacyHarness()
        XCTAssertEqual(harness.environment.refreshCount, 0)

        harness.environment.push(PrivacyEnvironmentUpdate(status: .loaded, freshness: .stale))
        harness.environment.push(PrivacyEnvironmentUpdate(status: .loaded, freshness: .stale))
        XCTAssertEqual(harness.environment.refreshCount, 1)

        harness.environment.push(PrivacyEnvironmentUpdate(status: .loaded, freshness: .fresh))
        harness.environment.push(PrivacyEnvironmentUpdate(status: .loaded, freshness: .stale))
        XCTAssertEqual(harness.environment.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let harness = makePrivacyHarness()
        harness.environment.push(
            PrivacyEnvironmentUpdate(status: .loaded, freshness: .offline, requireConsent: true)
        )
        XCTAssertEqual(harness.environment.refreshCount, 0)
        XCTAssertEqual(harness.model.freshness, .offline)
        XCTAssertTrue(harness.model.requireConsent)
    }

    func testRefreshDelegatesToEnvironment() {
        let harness = makePrivacyHarness()
        harness.model.refresh()
        harness.model.refresh()
        XCTAssertEqual(harness.environment.refreshCount, 2)
    }
}

// MARK: - Recent-pages clear flow + silence machinery

@MainActor
final class PrivacyClearFlowTests: XCTestCase {
    func testRequestWithEntriesPresentsConfirmation() {
        let harness = makePrivacyHarness(recent: 5)
        harness.model.requestClearRecentPages()
        XCTAssertTrue(harness.model.confirmPresented)
        XCTAssertFalse(harness.model.dontAskAgain)
        XCTAssertEqual(harness.recentPages.clearCount, 0)
    }

    func testRequestWithNoEntriesIsNoOp() {
        let harness = makePrivacyHarness(recent: 0)
        harness.model.requestClearRecentPages()
        XCTAssertFalse(harness.model.confirmPresented)
        XCTAssertEqual(harness.recentPages.clearCount, 0)
    }

    func testSilencedRequestClearsImmediatelyWithoutSheet() {
        let harness = makePrivacyHarness(recent: 5, silenced: true)
        harness.model.requestClearRecentPages()
        XCTAssertFalse(harness.model.confirmPresented)
        XCTAssertEqual(harness.recentPages.clearCount, 1)
        XCTAssertEqual(harness.model.recentCount, 0)
        XCTAssertEqual(harness.model.toast?.message, "Recent pages cleared")
    }

    func testConfirmClearsAndToasts() {
        let harness = makePrivacyHarness(recent: 5)
        harness.model.requestClearRecentPages()
        harness.model.confirmClearRecentPages()
        XCTAssertFalse(harness.model.confirmPresented)
        XCTAssertEqual(harness.recentPages.clearCount, 1)
        XCTAssertEqual(harness.model.recentCount, 0)
        XCTAssertEqual(harness.model.toast?.message, "Recent pages cleared")
        XCTAssertFalse(harness.silenceStore.isSilenced(PrivacyModel.confirmSilenceKey))
    }

    func testConfirmWithDontAskAgainPersistsSilence() {
        let harness = makePrivacyHarness(recent: 5)
        harness.model.requestClearRecentPages()
        harness.model.dontAskAgain = true
        harness.model.confirmClearRecentPages()
        XCTAssertTrue(harness.silenceStore.isSilenced(PrivacyModel.confirmSilenceKey))
        XCTAssertEqual(harness.recentPages.clearCount, 1)
    }

    func testCancelDismissesWithoutClearing() {
        let harness = makePrivacyHarness(recent: 5)
        harness.model.requestClearRecentPages()
        harness.model.cancelClearRecentPages()
        XCTAssertFalse(harness.model.confirmPresented)
        XCTAssertEqual(harness.recentPages.clearCount, 0)
        XCTAssertEqual(harness.model.recentCount, 5)
    }

    func testExternalRecentMutationUpdatesCount() {
        let harness = makePrivacyHarness(recent: 2)
        harness.recentPages.push(8)
        XCTAssertEqual(harness.model.recentCount, 8)
    }
}

// MARK: - Consent mutations + toasts

@MainActor
final class PrivacyConsentFlowTests: XCTestCase {
    func testAcceptSetsStateAndToasts() {
        let harness = makePrivacyHarness(consent: .unknown)
        harness.model.performConsent(.accept)
        XCTAssertEqual(harness.model.consent, .accepted)
        XCTAssertEqual(harness.consentStore.state, .accepted)
        XCTAssertEqual(harness.model.toast?.message, "Consent granted")
    }

    func testDeclineSetsStateAndToasts() {
        let harness = makePrivacyHarness(consent: .accepted)
        harness.model.performConsent(.decline)
        XCTAssertEqual(harness.model.consent, .declined)
        XCTAssertEqual(harness.consentStore.state, .declined)
        XCTAssertEqual(harness.model.toast?.message, "Consent withdrawn")
    }

    func testResetClearsStateAndToasts() {
        let harness = makePrivacyHarness(consent: .accepted)
        harness.model.performConsent(.reset)
        XCTAssertEqual(harness.model.consent, .unknown)
        XCTAssertEqual(harness.consentStore.state, .unknown)
        XCTAssertEqual(harness.model.toast?.message, "Consent reset — banner will reappear")
    }

    func testDismissToastClearsIt() {
        let harness = makePrivacyHarness(consent: .unknown)
        harness.model.performConsent(.accept)
        XCTAssertNotNil(harness.model.toast)
        harness.model.dismissToast()
        XCTAssertNil(harness.model.toast)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPrivacyTelemetry: PrivacyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
