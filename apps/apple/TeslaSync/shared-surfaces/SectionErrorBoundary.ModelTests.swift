//
//  SectionErrorBoundary.ModelTests.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  State-holder coverage for `SectionErrorBoundaryModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent, re-armed by `stop()`), the `sectionFailed` catch diagnostic (emitted
//  once on the transition into `.caught`, keyed by the boundary `name` + the runtime reason, and not
//  re-emitted while it stays caught), the phase transitions across every state (loading / empty /
//  content / caught), the retry-capability derivation, the optimistic retry recovery (web
//  `handleRetry`), the connection axis (live / stale / offline) with the one-shot stale auto-refresh
//  (re-armed on return to live), offline NOT auto-refreshing, and the controlled source. Driven
//  through the in-memory seams — no network, no real time.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class SectionErrorBoundaryModelTests: XCTestCase {
    private func makeModel(
        _ input: SectionErrorBoundaryInput,
        mode: SectionBoundaryFallbackMode = .inline,
        telemetry: SectionErrorBoundaryTelemetry = OSLogSectionErrorBoundaryTelemetry(),
        onRetry: (@MainActor () -> Void)? = nil
    ) -> (SectionErrorBoundaryModel, InMemorySectionErrorBoundarySource) {
        let source = InMemorySectionErrorBoundarySource(initial: input)
        let model = SectionErrorBoundaryModel(
            name: "BatteryDegradationChart",
            mode: mode,
            source: source,
            telemetry: telemetry,
            onRetry: onRetry
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsViewOpenedOnce() {
        let spy = SpySectionErrorBoundaryTelemetry()
        let (model, source) = makeModel(
            SectionErrorBoundaryInput(error: SectionBoundaryError(message: "boom")),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .caught)
        XCTAssertEqual(model.resolved.fallback?.kind, .inline)
        XCTAssertEqual(spy.opened, [SectionErrorBoundaryModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCanRetryDerivedFromHandler() {
        let (withHandler, _) = makeModel(SectionErrorBoundaryInput(), onRetry: {})
        XCTAssertTrue(withHandler.canRetry)
        let (withoutHandler, _) = makeModel(SectionErrorBoundaryInput())
        XCTAssertFalse(withoutHandler.canRetry)
    }

    func testHealthyContentProjectsContentPhase() {
        let (model, _) = makeModel(SectionErrorBoundaryInput())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.resolved.fallback)
    }

    func testLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(SectionErrorBoundaryInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoContentProjectsEmptyPhase() {
        let (model, _) = makeModel(SectionErrorBoundaryInput(hasContent: false))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testPushFromContentToCaughtEmitsSectionFailedOnce() {
        let spy = SpySectionErrorBoundaryTelemetry()
        let (model, source) = makeModel(SectionErrorBoundaryInput(), telemetry: spy)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(spy.failures.isEmpty)

        source.push(SectionErrorBoundaryInput(error: SectionBoundaryError(message: "render failed")))
        XCTAssertEqual(model.phase, .caught)
        XCTAssertEqual(spy.failures.count, 1)
        XCTAssertEqual(spy.failures.first?.name, "BatteryDegradationChart")
        XCTAssertEqual(spy.failures.first?.reason, "render failed")

        // Staying caught (a new failure) must not re-emit the catch diagnostic.
        source.push(SectionErrorBoundaryInput(error: SectionBoundaryError(message: "still failing")))
        XCTAssertEqual(spy.failures.count, 1)
    }

    func testHealthyStartEmitsNoSectionFailed() {
        let spy = SpySectionErrorBoundaryTelemetry()
        let (model, _) = makeModel(SectionErrorBoundaryInput(), telemetry: spy)
        model.start()
        XCTAssertTrue(spy.failures.isEmpty)
    }

    func testRetryOptimisticallyRecoversAndDelegates() {
        var retried = 0
        let (model, source) = makeModel(
            SectionErrorBoundaryInput(error: SectionBoundaryError(message: "boom")),
            onRetry: { retried += 1 }
        )
        model.start()
        XCTAssertEqual(model.phase, .caught)

        model.retry()
        XCTAssertEqual(model.phase, .content, "retry clears the caught failure so the section re-renders")
        XCTAssertEqual(model.retryCount, 1)
        XCTAssertEqual(retried, 1)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRetryReCatchesWhenSourceReEmitsError() {
        let (model, source) = makeModel(SectionErrorBoundaryInput(error: SectionBoundaryError(message: "boom")))
        model.start()
        model.retry()
        XCTAssertEqual(model.phase, .content)
        // The underlying issue persists → the host re-emits the failure → the fallback returns.
        source.push(SectionErrorBoundaryInput(error: SectionBoundaryError(message: "boom")))
        XCTAssertEqual(model.phase, .caught)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(SectionErrorBoundaryInput())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(SectionErrorBoundaryInput(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(SectionErrorBoundaryInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(SectionErrorBoundaryInput())
        model.start()
        source.push(SectionErrorBoundaryInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SectionErrorBoundaryInput(connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(SectionErrorBoundaryInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(SectionErrorBoundaryInput())
        model.start()
        source.push(SectionErrorBoundaryInput(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(SectionErrorBoundaryInput())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopReArmsStartAndTelemetry() {
        let spy = SpySectionErrorBoundaryTelemetry()
        let (model, source) = makeModel(SectionErrorBoundaryInput(), telemetry: spy)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.opened.count, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SectionErrorBoundaryModel.surfaceSlug, "SectionErrorBoundary")
        XCTAssertEqual(SectionErrorBoundary<EmptyView, EmptyView>.surfaceSlug, "SectionErrorBoundary")
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticSectionErrorBoundarySourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticSectionErrorBoundarySource(error: SectionBoundaryError(message: "boom"))
        var inputs: [SectionErrorBoundaryInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.error?.message, "boom")
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticSectionErrorBoundarySource(error: SectionBoundaryError(message: "boom"))
        var inputs: [SectionErrorBoundaryInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(SectionErrorBoundaryInput(connection: .offline))
        XCTAssertEqual(inputs.last?.connection, .offline)
        XCTAssertNil(inputs.last?.error)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` + `sectionFailed` so the telemetry contract can be asserted. Lock-guarded so
/// it satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpySectionErrorBoundaryTelemetry: SectionErrorBoundaryTelemetry, @unchecked Sendable {
    struct Failure: Equatable {
        let surface: String
        let name: String
        let reason: String
    }

    private let lock = NSLock()
    private var openedStorage: [String] = []
    private var failureStorage: [Failure] = []

    var opened: [String] {
        lock.lock()
        defer { lock.unlock() }
        return openedStorage
    }

    var failures: [Failure] {
        lock.lock()
        defer { lock.unlock() }
        return failureStorage
    }

    func viewOpened(surface: String) {
        lock.lock()
        openedStorage.append(surface)
        lock.unlock()
    }

    func sectionFailed(surface: String, name: String, reason: String) {
        lock.lock()
        failureStorage.append(Failure(surface: surface, name: name, reason: reason))
        lock.unlock()
    }
}
