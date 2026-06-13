//
//  ImpersonationBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  State-holder coverage for `ImpersonationBannerModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across every state (loading / empty-inactive /
//  empty-unavailable / error / data), the end mutation delegating to the source, the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live), offline
//  keeping the cached session, and the countdown clock (active flag + the once-a-second recompute
//  against an injected clock). Driven through the in-memory source — no gateway, no real polling.
//

import XCTest
@testable import TeslaSync

@MainActor
final class ImpersonationBannerModelTests: XCTestCase {
    private let expires = Date(timeIntervalSince1970: 1_700_000_000)

    private func subject() -> ImpersonationBannerSubject {
        ImpersonationBannerSubject(target: "subject-aa10", originalAdmin: "admin-root", expiresAt: expires)
    }

    private func makeModel(
        _ input: ImpersonationBannerInput,
        telemetry: ImpersonationBannerTelemetry = OSLogImpersonationBannerTelemetry()
    ) -> (ImpersonationBannerModel, InMemoryImpersonationBannerSource) {
        let source = InMemoryImpersonationBannerSource(initial: input)
        let model = ImpersonationBannerModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyImpersonationBannerTelemetry()
        let (model, source) = makeModel(ImpersonationBannerInput(status: .active(subject())), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.target, "subject-aa10")
        XCTAssertEqual(spy.surfaces, [ImpersonationBannerModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
        model.stop()
    }

    func testInactiveProjectsEmptyInactive() {
        let (model, _) = makeModel(ImpersonationBannerInput(status: .inactive))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .inactive)
    }

    func testUnavailableProjectsEmptyUnavailable() {
        let (model, _) = makeModel(ImpersonationBannerInput(status: .unavailable))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.emptyKind, .unavailable)
    }

    func testLoadingThenPushToData() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .inactive, isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ImpersonationBannerInput(status: .active(subject())))
        XCTAssertEqual(model.phase, .data)
        model.stop()
    }

    func testErrorInputProjectsError() {
        let (model, _) = makeModel(ImpersonationBannerInput(status: .inactive, errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEndDelegatesToSource() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .active(subject())))
        model.start()
        model.endImpersonation()
        XCTAssertEqual(source.endCount, 1)
        model.stop()
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .inactive))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .active(subject())))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ImpersonationBannerInput(status: .active(subject()), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(ImpersonationBannerInput(status: .active(subject()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .active(subject())))
        model.start()
        source.push(ImpersonationBannerInput(status: .active(subject()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ImpersonationBannerInput(status: .active(subject()), connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(ImpersonationBannerInput(status: .active(subject()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        model.stop()
    }

    func testOfflineKeepsDataAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .active(subject())))
        model.start()
        source.push(ImpersonationBannerInput(status: .active(subject()), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
        model.stop()
    }

    func testCountdownActiveOnlyWhenActiveWithExpiry() {
        let (withExpiry, _) = makeModel(ImpersonationBannerInput(status: .active(subject())))
        withExpiry.start()
        XCTAssertTrue(withExpiry.countdownActive)
        withExpiry.stop()

        let noExpirySubject = ImpersonationBannerSubject(target: "x", originalAdmin: "y", expiresAt: nil)
        let (noExpiry, _) = makeModel(ImpersonationBannerInput(status: .active(noExpirySubject)))
        noExpiry.start()
        XCTAssertFalse(noExpiry.countdownActive)
        noExpiry.stop()

        let (inactive, _) = makeModel(ImpersonationBannerInput(status: .inactive))
        inactive.start()
        XCTAssertFalse(inactive.countdownActive)
    }

    func testCountdownTextRecomputesAgainstTheClock() {
        let clock = TestClock(Date(timeIntervalSince1970: 0))
        let activeSubject = ImpersonationBannerSubject(
            target: "bob", originalAdmin: "root", expiresAt: Date(timeIntervalSince1970: 125)
        )
        let source = InMemoryImpersonationBannerSource(
            initial: ImpersonationBannerInput(status: .active(activeSubject))
        )
        let model = ImpersonationBannerModel(source: source, now: { clock.now })
        model.start()

        let resolve: ImpersonationBannerResolve = { _, fallback in fallback }
        XCTAssertEqual(model.countdownText(using: resolve), "Expires in 2m 05s")

        clock.now = Date(timeIntervalSince1970: 120)
        model.tickClock()
        XCTAssertEqual(model.countdownText(using: resolve), "Expires in 5s")

        clock.now = Date(timeIntervalSince1970: 125)
        model.tickClock()
        XCTAssertEqual(model.countdownText(using: resolve), "Session expired")
        model.stop()
    }

    func testCountdownTextIsNilWhenNotActive() {
        let (model, _) = makeModel(ImpersonationBannerInput(status: .inactive))
        model.start()
        XCTAssertNil(model.countdownText(using: { _, fallback in fallback }))
    }

    func testStopReArms() {
        let (model, source) = makeModel(ImpersonationBannerInput(status: .inactive))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ImpersonationBannerModel.surfaceSlug, "ImpersonationBanner")
        XCTAssertEqual(ImpersonationBanner.surfaceSlug, "ImpersonationBanner")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyImpersonationBannerTelemetry: ImpersonationBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.withLock { storage }
    }

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }
}

/// A settable clock for the countdown tests — lock-guarded so the injected `@Sendable` `now` closure
/// can read it while a test mutates it.
private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    init(_ value: Date) {
        self.value = value
    }

    var now: Date {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}
