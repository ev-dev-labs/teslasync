//
//  AlertBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  State-holder coverage for `AlertBannerModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent, re-armed by `stop()`), the phase transitions across every state
//  (loading / empty / error / alert), the dismiss-capability derivation from the supplied handler,
//  the connection axis (live / stale / offline) with the one-shot stale auto-refresh (re-armed on
//  return to live), offline keeping the connectivity banner without auto-refreshing, the
//  handler-forwarded dismiss, and the controlled source. Driven through the in-memory seams — no
//  network, no real time.
//

import XCTest
@testable import TeslaSync

private func mutationNotice(
    _ kind: AlertBannerMutationKind,
    _ title: String,
    detail: String? = nil
) -> AlertBannerNotice {
    AlertBannerNotice.from(mutation: AlertBannerMutation(kind: kind, title: title, detail: detail))
}

// MARK: - Model (state-holder)

@MainActor
final class AlertBannerModelTests: XCTestCase {
    private func makeModel(
        _ input: AlertBannerInput,
        telemetry: AlertBannerTelemetry = OSLogAlertBannerTelemetry(),
        onDismiss: (@MainActor () -> Void)? = nil
    ) -> (AlertBannerModel, InMemoryAlertBannerSource) {
        let source = InMemoryAlertBannerSource(initial: input)
        let model = AlertBannerModel(source: source, telemetry: telemetry, onDismiss: onDismiss)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAlertBannerTelemetry()
        let (model, source) = makeModel(
            AlertBannerInput(notice: mutationNotice(.error, "Failed", detail: "HTTP 500")),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .alert)
        XCTAssertEqual(model.resolved.content?.variant, .danger)
        XCTAssertEqual(spy.surfaces, [AlertBanner.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCanDismissDerivedFromHandler() {
        let (withHandler, _) = makeModel(AlertBannerInput(), onDismiss: {})
        XCTAssertTrue(withHandler.canDismiss)
        let (withoutHandler, _) = makeModel(AlertBannerInput())
        XCTAssertFalse(withoutHandler.canDismiss)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AlertBannerInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoNoticeProjectsEmpty() {
        let (model, _) = makeModel(AlertBannerInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.resolved.content)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(AlertBannerInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToAlert() {
        let (model, source) = makeModel(AlertBannerInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AlertBannerInput(notice: mutationNotice(.success, "Saved")))
        XCTAssertEqual(model.phase, .alert)
        XCTAssertEqual(model.resolved.content?.variant, .success)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(AlertBannerInput())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AlertBannerInput(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(AlertBannerInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(AlertBannerInput())
        model.start()
        source.push(AlertBannerInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AlertBannerInput(connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(AlertBannerInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsConnectivityBannerAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(AlertBannerInput())
        model.start()
        source.push(AlertBannerInput(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .alert)
        XCTAssertEqual(model.resolved.content?.symbolName, "wifi.slash")
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(AlertBannerInput(notice: mutationNotice(.success, "Saved")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopReArmsStartAndTelemetry() {
        let spy = SpyAlertBannerTelemetry()
        let (model, source) = makeModel(AlertBannerInput(), telemetry: spy)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AlertBanner.surfaceSlug, "AlertBanner")
    }
}

// MARK: - Actions (web `onClose`)

@MainActor
final class AlertBannerActionTests: XCTestCase {
    func testDismissForwardsToHandler() {
        var dismissed = 0
        let source = InMemoryAlertBannerSource(initial: AlertBannerInput(notice: mutationNotice(.success, "Saved")))
        let model = AlertBannerModel(source: source, onDismiss: { dismissed += 1 })
        model.start()
        model.dismiss()
        XCTAssertEqual(dismissed, 1)
    }

    func testDismissIsNoOpWhenNoHandlerSupplied() {
        let source = InMemoryAlertBannerSource(initial: AlertBannerInput(notice: mutationNotice(.success, "Saved")))
        let model = AlertBannerModel(source: source)
        model.start()
        model.dismiss()
        XCTAssertFalse(model.canDismiss)
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticAlertBannerSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticAlertBannerSource(notice: mutationNotice(.error, "Failed", detail: "HTTP 500"))
        var inputs: [AlertBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.notice?.variant, .danger)
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticAlertBannerSource(notice: mutationNotice(.success, "Saved"))
        var inputs: [AlertBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(AlertBannerInput(connection: .offline))
        XCTAssertEqual(inputs.last?.connection, .offline)
        XCTAssertNil(inputs.last?.notice)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAlertBannerTelemetry: AlertBannerTelemetry, @unchecked Sendable {
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
