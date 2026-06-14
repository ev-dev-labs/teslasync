//
//  OnboardingWizard.Tests.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The state-holder + seam + view-composition + facade half of the coverage (the pure projector + value
//  types live in OnboardingWizard.AdapterTests.swift). These run in the TeslaSync(/-macOS) XCTest targets:
//    • OnboardingWizardModel — the first-run gate (already onboarded → stays dismissed), the delayed reveal
//      (timer + the once-only `view.opened`), the `handleNext` advance-then-finish, Skip / close (persist +
//      hide), the cross-scene peer dismissal (hide WITHOUT re-persisting), and `stop()` cancelling a pending
//      reveal.
//    • UserDefaultsOnboardingWizardStore — the persisted flag round-trips and the peer broadcast dismisses a
//      sibling store while the posting store ignores its own echo.
//    • Views — the public surface + subviews compose in both real branches.
//    • Strings — the prose + a11y copy resolves through the P1/S10 facade with the web fallbacks.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - OnboardingWizardModel (visibility + step state)

@MainActor
final class OnboardingWizardModelTests: XCTestCase {
    private func makeModel(
        hasOnboarded: Bool = false,
        telemetry: OnboardingWizardTelemetry = OSLogOnboardingWizardTelemetry(),
        revealDelay: Duration = .milliseconds(1500)
    ) -> (OnboardingWizardModel, InMemoryOnboardingWizardStore) {
        let store = InMemoryOnboardingWizardStore(hasOnboarded: hasOnboarded)
        let model = OnboardingWizardModel(store: store, telemetry: telemetry, revealDelay: revealDelay)
        return (model, store)
    }

    func testAlreadyOnboardedStaysDismissed() {
        let spy = SpyTelemetry()
        let (model, store) = makeModel(hasOnboarded: true, telemetry: spy)
        model.begin()
        XCTAssertFalse(model.isPresented)
        XCTAssertEqual(store.startCount, 1)
        // A late reveal must never resurrect a completed walkthrough.
        model.revealNow()
        XCTAssertFalse(model.isPresented)
        XCTAssertTrue(spy.surfaces.isEmpty)
    }

    func testFreshInstallDoesNotPresentBeforeRevealFires() {
        let (model, store) = makeModel(hasOnboarded: false)
        model.begin()
        XCTAssertFalse(model.isPresented, "the reveal is delayed (web setTimeout)")
        XCTAssertEqual(store.startCount, 1)
    }

    func testRevealNowPresentsAndEmitsViewOpenedOnce() {
        let spy = SpyTelemetry()
        let (model, _) = makeModel(telemetry: spy)
        model.begin()
        model.revealNow()
        XCTAssertTrue(model.isPresented)
        model.revealNow()
        XCTAssertEqual(spy.surfaces, [OnboardingWizardSurface.slug], "view.opened fires once per instance")
    }

    func testRevealTimerPresentsAfterDelay() async {
        let spy = SpyTelemetry()
        let (model, _) = makeModel(telemetry: spy, revealDelay: .milliseconds(5))
        model.begin()
        XCTAssertFalse(model.isPresented)
        try? await Task.sleep(for: .milliseconds(120))
        XCTAssertTrue(model.isPresented)
        XCTAssertEqual(spy.surfaces, [OnboardingWizardSurface.slug])
    }

    func testStopCancelsPendingReveal() async {
        let (model, store) = makeModel(revealDelay: .milliseconds(60))
        model.begin()
        model.stop()
        XCTAssertEqual(store.stopCount, 1)
        try? await Task.sleep(for: .milliseconds(140))
        XCTAssertFalse(model.isPresented, "a cancelled reveal never presents")
    }

    func testNextAdvancesThroughStepsThenCompletes() {
        let (model, store) = makeModel()
        model.begin()
        model.revealNow()
        XCTAssertEqual(model.currentStep, 0)
        model.next()
        XCTAssertEqual(model.currentStep, 1)
        model.next()
        model.next()
        XCTAssertEqual(model.currentStep, 3)
        XCTAssertTrue(model.isPresented)
        model.next() // last step → finish
        XCTAssertFalse(model.isPresented)
        XCTAssertEqual(store.markOnboardedCount, 1)
    }

    func testSkipPersistsAndHides() {
        let (model, store) = makeModel()
        model.begin()
        model.revealNow()
        model.skip()
        XCTAssertFalse(model.isPresented)
        XCTAssertEqual(store.markOnboardedCount, 1, "Skip is the web handleClose: persist + hide + broadcast")
    }

    func testPeerDismissalHidesWithoutRepersisting() {
        let (model, store) = makeModel()
        model.begin()
        model.revealNow()
        XCTAssertTrue(model.isPresented)
        store.simulatePeerDismissal()
        XCTAssertFalse(model.isPresented)
        XCTAssertEqual(store.markOnboardedCount, 0, "the peer already persisted; we only hide (web subscribe)")
    }

    func testCompletingIsIdempotent() {
        let (model, store) = makeModel()
        model.begin()
        model.revealNow()
        model.skip()
        model.skip()
        XCTAssertEqual(store.markOnboardedCount, 1)
    }
}

// MARK: - UserDefaultsOnboardingWizardStore (persistence + peer bus)

@MainActor
final class OnboardingWizardStoreTests: XCTestCase {
    private func makeDefaults() -> UserDefaults {
        let suite = "onboardingWizard.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    func testFlagRoundTrips() {
        let defaults = makeDefaults()
        let store = UserDefaultsOnboardingWizardStore(defaults: defaults, center: NotificationCenter())
        XCTAssertFalse(store.hasOnboarded)
        store.markOnboarded()
        XCTAssertTrue(store.hasOnboarded)
        XCTAssertTrue(defaults.bool(forKey: UserDefaultsOnboardingWizardStore.onboardedKey))
    }

    func testPeerBroadcastDismissesSiblingButNotSelf() {
        let center = NotificationCenter()
        let storeA = UserDefaultsOnboardingWizardStore(defaults: makeDefaults(), center: center)
        let storeB = UserDefaultsOnboardingWizardStore(defaults: makeDefaults(), center: center)
        var selfFired = false
        var peerFired = false
        storeA.onDismissedByPeer = { selfFired = true }
        storeB.onDismissedByPeer = { peerFired = true }
        storeA.start()
        storeB.start()

        storeA.markOnboarded()

        XCTAssertTrue(peerFired, "a sibling scene's broadcast dismisses the peer (web subscribe)")
        XCTAssertFalse(selfFired, "the posting scene ignores its own echo (web BroadcastChannel)")
        storeA.stop()
        storeB.stop()
    }

    func testStopHaltsPeerDelivery() {
        let center = NotificationCenter()
        let storeA = UserDefaultsOnboardingWizardStore(defaults: makeDefaults(), center: center)
        let storeB = UserDefaultsOnboardingWizardStore(defaults: makeDefaults(), center: center)
        var peerFired = false
        storeB.onDismissedByPeer = { peerFired = true }
        storeB.start()
        storeB.stop()

        storeA.markOnboarded()

        XCTAssertFalse(peerFired, "a stopped store no longer observes the bus")
    }
}

// MARK: - Views (both real branches compose)

@MainActor
final class OnboardingWizardViewTests: XCTestCase {
    func testSurfaceComposesFromDefaultAndInjectedModel() {
        _ = OnboardingWizard()
        let injected = OnboardingWizardModel(
            store: InMemoryOnboardingWizardStore(hasOnboarded: false),
            telemetry: SpyTelemetry(),
            initiallyPresented: true,
            initialStep: 2
        )
        _ = OnboardingWizard(model: injected)
        XCTAssertEqual(OnboardingWizard.surfaceSlug, "OnboardingWizard")
    }

    func testSubviewsComposeForEveryStep() {
        for step in 0 ..< OnboardingWizardStepCatalog.count {
            let projection = OnboardingWizardProjector.resolve(
                currentStep: step,
                resolve: { OnboardingWizardStrings.string($0, $1) }
            )
            _ = OnboardingWizardIndicatorRow(
                indicators: projection.indicators,
                accent: projection.accent.color,
                progressLabel: projection.progressLabel,
                reduceMotion: false
            )
            _ = OnboardingWizardIconTile(symbolName: projection.symbolName, accent: projection.accent.color)
            _ = OnboardingWizardStepContent(projection: projection)
            _ = OnboardingWizardActions(
                primaryAction: projection.primaryAction,
                accent: projection.accent.color,
                onSkip: {},
                onAdvance: {}
            )
        }
        _ = OnboardingWizardCloseButton(onClose: {})
        _ = OnboardingWizardBackdrop(onDismiss: {})
    }

    func testAccentResolvesToTokens() {
        XCTAssertEqual(OnboardingWizardAccent.primary.color, Color.TS.accent)
        XCTAssertEqual(OnboardingWizardAccent.success.color, Color.TS.statusSuccess)
        XCTAssertEqual(OnboardingWizardAccent.warning.color, Color.TS.statusWarning)
        XCTAssertEqual(OnboardingWizardAccent.highlight.color, Color.TS.chartSeriesPower)
    }

    func testMotionHonorsReduceMotion() {
        XCTAssertNil(OnboardingWizardMotion.presentation(reduce: true))
        XCTAssertNotNil(OnboardingWizardMotion.presentation(reduce: false))
        XCTAssertNil(OnboardingWizardMotion.indicator(reduce: true))
        XCTAssertNotNil(OnboardingWizardMotion.indicator(reduce: false))
    }
}

// MARK: - Strings facade + a11y labels (P1/S10)

final class OnboardingWizardStringsTests: XCTestCase {
    func testButtonFallbacks() {
        XCTAssertEqual(OnboardingWizardStrings.skip, "Skip")
        XCTAssertEqual(OnboardingWizardStrings.next, "Next")
        XCTAssertEqual(OnboardingWizardStrings.getStarted, "Get Started")
    }

    func testAccessibilityLabelsPresent() {
        // Every interactive element's a11y label resolves (close ✕, backdrop, dialog, dismiss hint).
        XCTAssertEqual(OnboardingWizardStrings.close, "Close")
        XCTAssertEqual(OnboardingWizardStrings.dialogLabel, "Welcome walkthrough")
        XCTAssertEqual(OnboardingWizardStrings.dismissHint, "Dismisses the walkthrough")
    }

    func testPrimaryActionLabelTracksRole() {
        XCTAssertEqual(OnboardingWizardStrings.primaryActionLabel(.advance), "Next")
        XCTAssertEqual(OnboardingWizardStrings.primaryActionLabel(.finish), "Get Started")
    }

    func testProgressLabelFormats() {
        let label = OnboardingWizardProjector.resolve(
            currentStep: 2,
            resolve: { OnboardingWizardStrings.string($0, $1) }
        ).progressLabel
        XCTAssertEqual(label, "Step 3 of 4")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: OnboardingWizardTelemetry, @unchecked Sendable {
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
