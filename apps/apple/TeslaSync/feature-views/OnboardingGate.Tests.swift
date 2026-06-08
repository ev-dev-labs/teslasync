//
//  OnboardingGate.Tests.swift
//  TeslaSync — P4 feature view · 0194 · OnboardingGate (Apple)
//
//  Unit coverage for the OnboardingGate surface:
//    • Allow-list (web `ALLOW_PREFIXES` + `isAllowed`) — exact, child, and the
//      trailing-slash share-link rule.
//    • Evaluator (web gate effect) — every branch + the complete→skip→allow→redirect
//      precedence.
//    • Projection — inputs → anchors / error / progress.
//    • State holder — OnboardingGateModel phase resolution across loading / empty /
//      error / content, the P1/S11 view.opened telemetry, and the navigation seam
//      that drives `navigate('/onboarding')` (fired once per entry into redirect).
//    • Accessibility — the VoiceOver label content for each verdict + anchor.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryOnboardingGateSource`, and the
//  telemetry / navigator are spies.
//

import XCTest
@testable import TeslaSync

// MARK: - Allow-list (web ALLOW_PREFIXES + isAllowed)

@MainActor
final class OnboardingAllowListTests: XCTestCase {
    private let list = OnboardingAllowList.default

    func testExactPrefixMatches() {
        XCTAssertTrue(list.isAllowed("/onboarding"))
        XCTAssertTrue(list.isAllowed("/tesla-account"))
        XCTAssertTrue(list.isAllowed("/settings"))
        XCTAssertTrue(list.isAllowed("/watch"))
        XCTAssertTrue(list.isAllowed("/login"))
    }

    func testNestedChildPathsMatch() {
        XCTAssertTrue(list.isAllowed("/onboarding/welcome"))
        XCTAssertTrue(list.isAllowed("/settings/profile"))
        XCTAssertTrue(list.isAllowed("/watch/face"))
    }

    func testTrailingSlashShareLinkMatchesByPrefix() {
        XCTAssertTrue(list.isAllowed("/s/abc123"))
        // The bare "/s" (no slash) is NOT a share link and is not allow-listed.
        XCTAssertFalse(list.isAllowed("/s"))
    }

    func testNonAllowedPathsAreGated() {
        XCTAssertFalse(list.isAllowed("/"))
        XCTAssertFalse(list.isAllowed("/dashboard"))
        XCTAssertFalse(list.isAllowed("/vehicles/1/access"))
        // A look-alike that shares a prefix but is neither the exact path nor a child.
        XCTAssertFalse(list.isAllowed("/onboardingx"))
        XCTAssertFalse(list.isAllowed("/settings-backup"))
    }
}

// MARK: - Evaluator (web gate effect)

@MainActor
final class GateEvaluatorTests: XCTestCase {
    private let incomplete = OnboardingStatus(
        teslaConnected: true,
        vehicleCount: 1,
        dataFlowing: false,
        isComplete: false
    )
    private let complete = OnboardingStatus(teslaConnected: true, vehicleCount: 2, dataFlowing: true, isComplete: true)

    func testLoadingHolds() {
        XCTAssertEqual(GateEvaluator.evaluate(feed: .loading, isSkipped: false, path: "/"), .hold(.loading))
    }

    func testFailedHolds() {
        XCTAssertEqual(
            GateEvaluator.evaluate(feed: .failed(message: "boom"), isSkipped: false, path: "/"),
            .hold(.error)
        )
    }

    func testEmptyHolds() {
        XCTAssertEqual(GateEvaluator.evaluate(feed: .empty, isSkipped: false, path: "/"), .hold(.noData))
    }

    func testCompletePasses() {
        XCTAssertEqual(
            GateEvaluator.evaluate(feed: .loaded(complete), isSkipped: false, path: "/"),
            .pass(.complete)
        )
    }

    func testSkippedPasses() {
        XCTAssertEqual(
            GateEvaluator.evaluate(feed: .loaded(incomplete), isSkipped: true, path: "/"),
            .pass(.skipped)
        )
    }

    func testAllowListedPasses() {
        XCTAssertEqual(
            GateEvaluator.evaluate(feed: .loaded(incomplete), isSkipped: false, path: "/settings"),
            .pass(.allowListed)
        )
    }

    func testOtherwiseRedirects() {
        XCTAssertEqual(
            GateEvaluator.evaluate(feed: .loaded(incomplete), isSkipped: false, path: "/"),
            .redirect(path: "/onboarding")
        )
    }

    func testCompleteTakesPrecedenceOverEverything() {
        // is_complete short-circuits before skip / allow-list (web order).
        let decision = GateEvaluator.evaluate(feed: .loaded(complete), isSkipped: false, path: "/dashboard")
        XCTAssertEqual(decision, .pass(.complete))
    }

    func testSkipTakesPrecedenceOverAllowList() {
        let decision = GateEvaluator.evaluate(feed: .loaded(incomplete), isSkipped: true, path: "/settings")
        XCTAssertEqual(decision, .pass(.skipped))
    }

    func testRedirectTargetIsOnboarding() {
        let decision = GateEvaluator.evaluate(feed: .loaded(incomplete), isSkipped: false, path: "/battery")
        XCTAssertTrue(decision.isRedirect)
        XCTAssertEqual(decision, .redirect(path: OnboardingGateRoute.onboarding))
    }
}

// MARK: - Projection (inputs → anchors / error / progress)

@MainActor
final class OnboardingGateProjectionTests: XCTestCase {
    func testLoadedProducesThreeAnchorsAndProgress() {
        let status = OnboardingStatus(teslaConnected: true, vehicleCount: 1, dataFlowing: false, isComplete: false)
        let projection = OnboardingGateProjectionBuilder.build(feed: .loaded(status), isSkipped: false, path: "/")
        XCTAssertTrue(projection.isResolved)
        XCTAssertEqual(projection.anchors.count, 3)
        XCTAssertEqual(projection.completedAnchorCount, 2)
        XCTAssertNil(projection.errorMessage)
        XCTAssertEqual(projection.anchors.map(\.kind), [.tesla, .vehicle, .telemetry])
        XCTAssertEqual(projection.anchors.map(\.done), [true, true, false])
    }

    func testFailedProducesNoAnchorsAndCarriesMessage() {
        let projection = OnboardingGateProjectionBuilder.build(
            feed: .failed(message: "net"),
            isSkipped: false,
            path: "/"
        )
        XCTAssertFalse(projection.isResolved)
        XCTAssertTrue(projection.anchors.isEmpty)
        XCTAssertEqual(projection.errorMessage, "net")
        XCTAssertEqual(projection.decision, .hold(.error))
    }

    func testLoadingAndEmptyProduceNoAnchors() {
        XCTAssertTrue(OnboardingGateProjectionBuilder.build(feed: .loading, isSkipped: false, path: "/").anchors
            .isEmpty)
        XCTAssertTrue(OnboardingGateProjectionBuilder.build(feed: .empty, isSkipped: false, path: "/").anchors.isEmpty)
    }

    func testAnchorsReflectStatusFlags() {
        let status = OnboardingStatus(teslaConnected: false, vehicleCount: 0, dataFlowing: true, isComplete: false)
        let anchors = status.anchors
        XCTAssertEqual(anchors.map(\.done), [false, false, true])
        XCTAssertFalse(status.hasVehicle)
    }
}

// MARK: - State holder: phases + telemetry + navigation seam

@MainActor
final class OnboardingGateModelTests: XCTestCase {
    private let incomplete = OnboardingStatus(
        teslaConnected: true,
        vehicleCount: 1,
        dataFlowing: false,
        isComplete: false
    )
    private let complete = OnboardingStatus(teslaConnected: true, vehicleCount: 2, dataFlowing: true, isComplete: true)

    private func makeModel(
        _ update: OnboardingGateUpdate,
        telemetry: any OnboardingGateTelemetry = OSLogOnboardingGateTelemetry(),
        navigator: any OnboardingGateNavigator = LoggingOnboardingGateNavigator()
    ) -> (OnboardingGateModel, InMemoryOnboardingGateSource) {
        let source = InMemoryOnboardingGateSource(initial: update)
        let model = OnboardingGateModel(source: source, telemetry: telemetry, navigator: navigator)
        return (model, source)
    }

    func testLoadingShowsLoadingPhase() {
        let (model, _) = makeModel(OnboardingGateUpdate(feed: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyShowsEmptyPhase() {
        let (model, _) = makeModel(OnboardingGateUpdate(feed: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedShowsErrorPhaseWithMessage() {
        let (model, _) = makeModel(OnboardingGateUpdate(feed: .failed(message: "503")))
        model.start()
        XCTAssertEqual(model.phase, .error("503"))
    }

    func testRedirectShowsContentAndNavigatesOnce() {
        let nav = SpyOnboardingGateNavigator()
        let (model, _) = makeModel(
            OnboardingGateUpdate(feed: .loaded(incomplete), isSkipped: false, path: "/"),
            navigator: nav
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(nav.calls.count, 1)
        XCTAssertEqual(nav.calls.first?.path, "/onboarding")
        XCTAssertEqual(nav.calls.first?.replace, true)
    }

    func testCompleteDoesNotNavigate() {
        let nav = SpyOnboardingGateNavigator()
        let (model, _) = makeModel(OnboardingGateUpdate(feed: .loaded(complete), path: "/dashboard"), navigator: nav)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(nav.calls.isEmpty)
    }

    func testAllowListedDoesNotNavigate() {
        let nav = SpyOnboardingGateNavigator()
        let (model, _) = makeModel(OnboardingGateUpdate(feed: .loaded(incomplete), path: "/settings"), navigator: nav)
        model.start()
        XCTAssertTrue(nav.calls.isEmpty)
    }

    func testRedirectFiresOnceThenReFiresAfterLeaving() {
        let nav = SpyOnboardingGateNavigator()
        let (model, source) = makeModel(OnboardingGateUpdate(feed: .loaded(incomplete), path: "/"), navigator: nav)
        model.start()
        // Same redirect verdict again must NOT re-navigate.
        source.push(OnboardingGateUpdate(feed: .loaded(incomplete), path: "/"))
        XCTAssertEqual(nav.calls.count, 1)
        // Leaving the redirect verdict (pass) then returning must navigate again.
        source.push(OnboardingGateUpdate(feed: .loaded(complete), path: "/"))
        source.push(OnboardingGateUpdate(feed: .loaded(incomplete), path: "/"))
        XCTAssertEqual(nav.calls.count, 2)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyOnboardingGateTelemetry()
        let (model, source) = makeModel(OnboardingGateUpdate(feed: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [OnboardingGateView.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(OnboardingGateUpdate(feed: .failed(message: "x")))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testGoToOnboardingNavigates() {
        let nav = SpyOnboardingGateNavigator()
        let (model, _) = makeModel(OnboardingGateUpdate(feed: .loaded(complete), path: "/"), navigator: nav)
        model.start()
        model.goToOnboarding()
        XCTAssertEqual(nav.calls.last?.path, "/onboarding")
        XCTAssertEqual(nav.calls.last?.replace, true)
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(OnboardingGateUpdate(feed: .loading))
        model.start()
        source.push(OnboardingGateUpdate(feed: .loaded(incomplete), path: "/settings", connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
    }
}

// MARK: - Accessibility label content

@MainActor
final class OnboardingGateAccessibilityTests: XCTestCase {
    private let incomplete = OnboardingStatus(
        teslaConnected: true,
        vehicleCount: 1,
        dataFlowing: false,
        isComplete: false
    )

    func testPanelLabelForRedirectMentionsSetup() {
        let projection = OnboardingGateProjectionBuilder.build(feed: .loaded(incomplete), isSkipped: false, path: "/")
        let label = OnboardingGateAccessibility.panelLabel(for: projection)
        XCTAssertTrue(label.contains("Taking you to setup"))
    }

    func testPanelLabelForErrorIncludesMessage() {
        let projection = OnboardingGateProjectionBuilder.build(
            feed: .failed(message: "HTTP 500"),
            isSkipped: false,
            path: "/"
        )
        let label = OnboardingGateAccessibility.panelLabel(for: projection)
        XCTAssertTrue(label.contains("Couldn't verify setup"))
        XCTAssertTrue(label.contains("HTTP 500"))
    }

    func testAnchorLabelTogglesWithState() {
        XCTAssertEqual(
            OnboardingGateAccessibility.anchorLabel(OnboardingAnchor(kind: .vehicle, done: true)),
            "Vehicles synced, completed"
        )
        XCTAssertEqual(
            OnboardingGateAccessibility.anchorLabel(OnboardingAnchor(kind: .telemetry, done: false)),
            "Telemetry flowing, pending"
        )
    }

    func testAnchorTitlePerKind() {
        XCTAssertEqual(OnboardingGateAccessibility.anchorTitle(.tesla), "Tesla account connected")
        XCTAssertEqual(OnboardingGateAccessibility.anchorTitle(.vehicle), "Vehicles synced")
        XCTAssertEqual(OnboardingGateAccessibility.anchorTitle(.telemetry), "Telemetry flowing")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyOnboardingGateTelemetry: OnboardingGateTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records `navigate(to:replace:)` calls so the redirect contract can be asserted.
@MainActor
private final class SpyOnboardingGateNavigator: OnboardingGateNavigator {
    private(set) var calls: [(path: String, replace: Bool)] = []
    func navigate(to path: String, replace: Bool) {
        calls.append((path: path, replace: replace))
    }
}
