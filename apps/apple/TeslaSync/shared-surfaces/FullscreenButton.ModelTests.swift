//
//  FullscreenButton.ModelTests.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  Telemetry + toggle-flow coverage split out of `…Tests.swift` (one concern per file): the P1/S11
//  `view.opened` emission seam (emitted exactly once on first appearance; never double-counted), the
//  stable diagnostics slug, and the `FullscreenButtonModel` behaviour — the web `toggle` flow
//  reproduced verbatim: request our target when nothing is fullscreen, exit when ours (or a
//  descendant) holds it, release a foreign lock then request ours, no-op a detached target, and leave
//  the state un-flipped when the platform denies the request (web `catch`). Also covers the support
//  gate (the `testHookSupported` override winning over the platform probe) and the externally-sourced
//  state (the `fullscreenchange` parity — an Esc-out / sibling / system revoke reflected without a
//  tap). Driven by spies + the in-memory presenter; no network, no store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class FullscreenButtonDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyFullscreenButtonTelemetry()
        let emitted = FullscreenButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [FullscreenButtonMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyFullscreenButtonTelemetry()
        var emitted = FullscreenButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = FullscreenButtonDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [FullscreenButtonMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyFullscreenButtonTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [FullscreenButtonMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(FullscreenButtonMeta.surfaceSlug, "FullscreenButton")
        XCTAssertEqual(FullscreenButton.surfaceSlug, "FullscreenButton")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogFullscreenButtonTelemetry().viewOpened(surface: FullscreenButtonMeta.surfaceSlug)
    }
}

// MARK: - Support gate (web `testHookSupported ?? probeSupport()`)

@MainActor final class FullscreenButtonSupportTests: XCTestCase {
    func testIsSupportedReadsPresenterWhenNoOverride() {
        XCTAssertTrue(makeModel(presenter: InMemoryFullscreenPresenter(isFullscreenSupported: true)).isSupported)
        XCTAssertFalse(makeModel(presenter: InMemoryFullscreenPresenter(isFullscreenSupported: false)).isSupported)
    }

    func testSupportOverrideWinsOverPresenter() {
        XCTAssertFalse(
            makeModel(
                presenter: InMemoryFullscreenPresenter(isFullscreenSupported: true),
                supportOverride: false
            ).isSupported,
            "testHookSupported=false hides the button even when the platform supports it (web parity)"
        )
        XCTAssertTrue(
            makeModel(
                presenter: InMemoryFullscreenPresenter(isFullscreenSupported: false),
                supportOverride: true
            ).isSupported,
            "testHookSupported=true shows the button even when the platform disables it (web parity)"
        )
    }
}

// MARK: - Live state (web `fullscreenchange`-sourced `isFs`)

@MainActor final class FullscreenButtonStateTests: XCTestCase {
    func testIsFullscreenReflectsPresenterActiveTarget() {
        let presenter = InMemoryFullscreenPresenter()
        let model = makeModel(targetID: "a", presenter: presenter)
        XCTAssertFalse(model.isFullscreen)
        presenter.setActiveExternally("a")
        XCTAssertTrue(model.isFullscreen, "the button reflects the live element without a tap (web sync)")
    }

    func testIsFullscreenReflectsDescendant() {
        let presenter = InMemoryFullscreenPresenter(activeTargetID: "card.svg")
        let model = makeModel(targetID: "card", descendantIDs: ["card.svg"], presenter: presenter)
        XCTAssertTrue(model.isFullscreen, "a descendant being fullscreen reports the button as active")
    }

    func testIsFullscreenFalseForDetachedTarget() {
        let presenter = InMemoryFullscreenPresenter(activeTargetID: "a")
        let model = makeModel(targetID: nil, presenter: presenter)
        XCTAssertFalse(model.isFullscreen, "a detached target is never active (web empty-ref)")
    }

    func testExternalEscOutFlipsBackToResting() {
        let presenter = InMemoryFullscreenPresenter(activeTargetID: "a")
        let model = makeModel(targetID: "a", presenter: presenter)
        XCTAssertTrue(model.isFullscreen)
        presenter.setActiveExternally(nil)
        XCTAssertFalse(model.isFullscreen, "an Esc-out / system revoke flips the button back (web parity)")
    }

    func testResolvedLabelTracksState() {
        let presenter = InMemoryFullscreenPresenter()
        let model = makeModel(targetID: "a", presenter: presenter)
        XCTAssertEqual(model.resolvedLabel, "Enter fullscreen")
        presenter.setActiveExternally("a")
        XCTAssertEqual(model.resolvedLabel, "Exit fullscreen")
    }

    func testResolvedLabelUsesOverrides() {
        let presenter = InMemoryFullscreenPresenter()
        let model = makeModel(
            targetID: "a",
            presenter: presenter,
            enterLabelOverride: "Expand chart",
            exitLabelOverride: "Collapse chart"
        )
        XCTAssertEqual(model.resolvedLabel, "Expand chart")
        presenter.setActiveExternally("a")
        XCTAssertEqual(model.resolvedLabel, "Collapse chart")
    }
}

// MARK: - Model toggle flow (web toggle())

@MainActor final class FullscreenButtonModelTests: XCTestCase {
    func testToggleEntersWhenNothingActive() {
        let presenter = InMemoryFullscreenPresenter()
        let model = makeModel(targetID: "a", presenter: presenter)
        model.toggle()
        XCTAssertEqual(presenter.requestCount, 1)
        XCTAssertEqual(presenter.lastRequestedTarget, "a")
        XCTAssertEqual(presenter.exitCount, 0)
        XCTAssertEqual(presenter.activeTargetID, "a")
        XCTAssertTrue(model.isFullscreen)
    }

    func testToggleExitsWhenOursActive() {
        let presenter = InMemoryFullscreenPresenter(activeTargetID: "a")
        let model = makeModel(targetID: "a", presenter: presenter)
        XCTAssertTrue(model.isFullscreen)
        model.toggle()
        XCTAssertEqual(presenter.exitCount, 1)
        XCTAssertEqual(presenter.requestCount, 0)
        XCTAssertNil(presenter.activeTargetID)
        XCTAssertFalse(model.isFullscreen)
    }

    func testToggleExitsWhenDescendantActive() {
        let presenter = InMemoryFullscreenPresenter(activeTargetID: "card.svg")
        let model = makeModel(targetID: "card", descendantIDs: ["card.svg"], presenter: presenter)
        model.toggle()
        XCTAssertEqual(presenter.exitCount, 1)
        XCTAssertEqual(presenter.requestCount, 0)
    }

    func testToggleReleasesForeignLockThenRequestsOurs() {
        let presenter = InMemoryFullscreenPresenter(activeTargetID: "other")
        let model = makeModel(targetID: "a", presenter: presenter)
        model.toggle()
        XCTAssertEqual(presenter.exitCount, 1, "the foreign lock is released first (web exit-then-request)")
        XCTAssertEqual(presenter.requestCount, 1)
        XCTAssertEqual(presenter.lastRequestedTarget, "a")
        XCTAssertEqual(presenter.activeTargetID, "a")
    }

    func testToggleNoopWhenTargetNil() {
        let presenter = InMemoryFullscreenPresenter()
        let model = makeModel(targetID: nil, presenter: presenter)
        model.toggle()
        XCTAssertEqual(presenter.requestCount, 0, "a detached target no-ops the toggle (web `if (!target)`)")
        XCTAssertEqual(presenter.exitCount, 0)
    }

    func testToggleRejectionLeavesStateUnflipped() {
        let presenter = InMemoryFullscreenPresenter(rejectsRequests: true)
        let model = makeModel(targetID: "a", presenter: presenter)
        model.toggle()
        XCTAssertEqual(presenter.requestCount, 1, "the request was attempted")
        XCTAssertNil(presenter.activeTargetID, "a denied request leaves the live element unchanged (web `catch`)")
        XCTAssertFalse(model.isFullscreen, "the button does not flip on a rejected request")
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    targetID: String? = "a",
    descendantIDs: Set<String> = [],
    presenter: any FullscreenPresenting = InMemoryFullscreenPresenter(),
    supportOverride: Bool? = nil,
    enterLabelOverride: String? = nil,
    exitLabelOverride: String? = nil,
    telemetry: any FullscreenButtonTelemetry = OSLogFullscreenButtonTelemetry()
) -> FullscreenButtonModel {
    FullscreenButtonModel(
        targetID: targetID,
        descendantIDs: descendantIDs,
        presenter: presenter,
        supportOverride: supportOverride,
        enterLabelOverride: enterLabelOverride,
        exitLabelOverride: exitLabelOverride,
        telemetry: telemetry
    )
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyFullscreenButtonTelemetry: FullscreenButtonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
