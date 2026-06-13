//
//  TeslaReauthBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  Adapter + projection + model coverage for the TeslaReauthBanner surface:
//    • Copy — the four web strings (`tesla.reauth.title` / `tesla.reauth.body` / `tesla.reauth.cta` /
//      `common.dismiss`) resolved through the injected facade.
//    • Accessibility — the collapsed "{title}. {body}" VoiceOver banner label.
//    • Projection — every render branch across error / loading / empty (unknown, connected, dismissed) /
//      data, with the error branch taking precedence over an expired grant.
//    • Model — start telemetry, snapshot application, the reconnect deep-link, the dismiss (no drain),
//      the recovery-edge mutation replay (once), the dismiss stickiness within an episode plus the
//      re-show on a new expiry after recovery, and the stale auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real signal, so each
//  assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source. The string resolver is the identity-fallback so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: TeslaReauthResolve = { _, fallback in fallback }

// MARK: - Copy (web `tesla.reauth.*` + `common.dismiss`)

final class TeslaReauthCopyTests: XCTestCase {
    func testRenderResolvesTheFourWebStrings() {
        let copy = TeslaReauthCopy.render(strings: fallbackStrings)
        XCTAssertEqual(copy.title, "Tesla account disconnected")
        XCTAssertEqual(copy.body, "Reconnect to resume live data and commands.")
        XCTAssertEqual(copy.cta, "Reconnect")
        XCTAssertEqual(copy.dismiss, "Dismiss")
    }

    func testRenderUsesTheInjectedResolver() {
        let resolver: TeslaReauthResolve = { key, _ in "[\(key)]" }
        let copy = TeslaReauthCopy.render(strings: resolver)
        XCTAssertEqual(copy.title, "[tesla.reauth.title]")
        XCTAssertEqual(copy.cta, "[tesla.reauth.cta]")
        XCTAssertEqual(copy.dismiss, "[common.dismiss]")
    }
}

// MARK: - Accessibility

final class TeslaReauthAccessibilityTests: XCTestCase {
    func testBannerLabelComposesTitleAndBody() {
        let copy = TeslaReauthCopy(
            title: "Tesla account disconnected",
            body: "Reconnect to resume live data and commands.",
            cta: "Reconnect",
            dismiss: "Dismiss"
        )
        XCTAssertEqual(
            TeslaReauthAccessibility.bannerLabel(copy: copy),
            "Tesla account disconnected. Reconnect to resume live data and commands."
        )
    }

    func testBannerLabelCollapsesWhitespace() {
        let copy = TeslaReauthCopy(title: "Tesla  account", body: "Reconnect  now", cta: "x", dismiss: "y")
        XCTAssertEqual(TeslaReauthAccessibility.bannerLabel(copy: copy), "Tesla account. Reconnect now")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class TeslaReauthProjectionTests: XCTestCase {
    private func resolve(_ input: TeslaReauthInput, dismissed: Bool = false) -> TeslaReauthResolved {
        TeslaReauthProjection.resolve(input: input, dismissed: dismissed, strings: fallbackStrings)
    }

    func testErrorIsErrorPhase() {
        let resolved = resolve(TeslaReauthInput(errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.copy)
    }

    func testErrorTakesPrecedenceOverExpired() {
        let resolved = resolve(TeslaReauthInput(status: .expired, errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testUnknownWhileLoadingIsLoading() {
        XCTAssertEqual(resolve(TeslaReauthInput(status: .unknown, isLoading: true)).phase, .loading)
    }

    func testUnknownAtRestIsEmpty() {
        XCTAssertEqual(resolve(TeslaReauthInput(status: .unknown)).phase, .empty)
    }

    func testConnectedIsEmpty() {
        let resolved = resolve(TeslaReauthInput(status: .connected))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.copy)
    }

    func testExpiredRendersDataWithCopy() {
        let resolved = resolve(TeslaReauthInput(status: .expired))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.copy?.title, "Tesla account disconnected")
        XCTAssertEqual(resolved.copy?.body, "Reconnect to resume live data and commands.")
        XCTAssertEqual(resolved.copy?.cta, "Reconnect")
        XCTAssertEqual(resolved.copy?.dismiss, "Dismiss")
    }

    func testExpiredButDismissedIsEmpty() {
        let resolved = resolve(TeslaReauthInput(status: .expired), dismissed: true)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.copy)
    }
}

// MARK: - Model (state holder + reconnect / dismiss / recovery + auto-refresh)

private final class SpyTeslaReauthTelemetry: TeslaReauthBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
private final class CallFlag {
    private(set) var count = 0
    func fire() {
        count += 1
    }
}

@MainActor
final class TeslaReauthBannerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryTeslaReauthSource,
        telemetry: TeslaReauthBannerTelemetry = SpyTeslaReauthTelemetry(),
        onReconnect: (@MainActor () -> Void)? = nil,
        onRecovered: (@MainActor () -> Void)? = nil
    ) -> TeslaReauthBannerModel {
        TeslaReauthBannerModel(
            source: source,
            telemetry: telemetry,
            onReconnect: onReconnect,
            onRecovered: onRecovered
        )
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryTeslaReauthSource(initial: TeslaReauthInput(status: .connected))
        let telemetry = SpyTeslaReauthTelemetry()
        let model = makeModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["TeslaReauthBanner"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testExpiredSnapshotDrivesDataPhase() {
        let source = InMemoryTeslaReauthSource()
        let model = makeModel(source: source)
        model.start()

        source.push(TeslaReauthInput(status: .expired))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(model.copy?.title, "Tesla account disconnected")
    }

    func testReconnectInvokesHandlerAndKeepsBannerVisible() {
        let source = InMemoryTeslaReauthSource(initial: TeslaReauthInput(status: .expired))
        let reconnected = CallFlag()
        let model = makeModel(source: source, onReconnect: { reconnected.fire() })
        model.start()
        XCTAssertEqual(model.phase, .data)

        model.reconnect()

        XCTAssertEqual(reconnected.count, 1)
        XCTAssertEqual(model.phase, .data) // web: reconnect navigates, the banner stays until recovery
    }

    func testDismissHidesBannerWithoutDraining() {
        let source = InMemoryTeslaReauthSource(initial: TeslaReauthInput(status: .expired))
        let recovered = CallFlag()
        let model = makeModel(source: source, onRecovered: { recovered.fire() })
        model.start()
        XCTAssertEqual(model.phase, .data)

        model.dismiss()

        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(recovered.count, 0) // dismiss must NOT drain the queued mutations
    }

    func testRecoveryEdgeDrainsQueuedMutationsOnce() {
        let source = InMemoryTeslaReauthSource(initial: TeslaReauthInput(status: .expired))
        let recovered = CallFlag()
        let model = makeModel(source: source, onRecovered: { recovered.fire() })
        model.start()
        XCTAssertEqual(model.phase, .data)

        source.push(TeslaReauthInput(status: .connected))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(recovered.count, 1)

        // A second connected snapshot does not re-drain.
        source.push(TeslaReauthInput(status: .connected))
        XCTAssertEqual(recovered.count, 1)
    }

    func testDismissIsStickyWithinTheSameExpiryEpisode() {
        let source = InMemoryTeslaReauthSource(initial: TeslaReauthInput(status: .expired))
        let model = makeModel(source: source, onReconnect: {})
        model.start()
        model.dismiss()
        XCTAssertEqual(model.phase, .empty)

        // A re-emit of the same expired snapshot (e.g. a freshness refresh) must not resurrect it.
        source.push(TeslaReauthInput(status: .expired))
        XCTAssertEqual(model.phase, .empty)
    }

    func testNewExpiryAfterRecoveryReshowsBanner() {
        let source = InMemoryTeslaReauthSource(initial: TeslaReauthInput(status: .expired))
        let model = makeModel(source: source)
        model.start()
        model.dismiss()
        XCTAssertEqual(model.phase, .empty)

        source.push(TeslaReauthInput(status: .connected)) // recovery ends the episode
        source.push(TeslaReauthInput(status: .expired)) // a fresh expiry re-shows
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryTeslaReauthSource()
        let model = makeModel(source: source)
        model.start()

        source.push(TeslaReauthInput(status: .expired, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(TeslaReauthInput(status: .expired, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryTeslaReauthSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
