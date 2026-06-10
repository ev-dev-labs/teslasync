//
//  AiLimitBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  State-holder coverage for `AiLimitBannerModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the capability derivation from the supplied handlers, the
//  countdown driven by the manual ticker (decrement → retry-ready, reset on a new limit, preserved
//  on a connection-only update), the connection axis (live / stale / offline) with the one-shot
//  stale auto-refresh (re-armed on return to live), offline keeping the cached limit, the
//  handler-gated actions (retry only when ready; baseline / dismiss always), and the controlled
//  source. Driven through the in-memory + manual seams — no network, no real time.
//

import XCTest
@testable import TeslaSync

private func info(
    _ reason: String,
    retryAfterS: Int = 0,
    bannerLevel: String = "",
    baselineAvailable: Bool = true
) -> AiLimitInfo {
    AiLimitInfo(
        reason: reason,
        retryAfterS: retryAfterS,
        bannerLevel: bannerLevel,
        baselineAvailable: baselineAvailable,
        message: "test message"
    )
}

// MARK: - Model (state-holder)

@MainActor
final class AiLimitBannerModelTests: XCTestCase {
    private func makeModel(
        _ input: AiLimitBannerInput,
        ticker: AiLimitTicker = ManualAiLimitTicker(),
        telemetry: AiLimitBannerTelemetry = OSLogAiLimitBannerTelemetry(),
        onRetry: (@MainActor () -> Void)? = nil,
        onUseBaseline: (@MainActor () -> Void)? = nil,
        onDismiss: (@MainActor () -> Void)? = nil
    ) -> (AiLimitBannerModel, InMemoryAiLimitBannerSource) {
        let source = InMemoryAiLimitBannerSource(initial: input)
        let model = AiLimitBannerModel(
            source: source,
            ticker: ticker,
            telemetry: telemetry,
            onRetry: onRetry,
            onUseBaseline: onUseBaseline,
            onDismiss: onDismiss
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAiLimitBannerTelemetry()
        let (model, source) = makeModel(
            AiLimitBannerInput(info: info("cost_cap", bannerLevel: "critical")),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.severity, .danger)
        XCTAssertEqual(spy.surfaces, [AiLimitBanner.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCapabilitiesDerivedFromSuppliedHandlers() {
        let (model, _) = makeModel(
            AiLimitBannerInput(info: info("burst")),
            onRetry: {},
            onDismiss: {}
        )
        XCTAssertTrue(model.capabilities.canRetry)
        XCTAssertFalse(model.capabilities.canUseBaseline)
        XCTAssertTrue(model.capabilities.canDismiss)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AiLimitBannerInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoInfoProjectsEmptyAndStartsNoTicker() {
        let ticker = ManualAiLimitTicker()
        let (model, _) = makeModel(AiLimitBannerInput(), ticker: ticker)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(ticker.isRunning)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(AiLimitBannerInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(AiLimitBannerInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AiLimitBannerInput(info: info("per_minute", bannerLevel: "warn")))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.severity, .warning)
    }

    func testZeroRetryAfterIsImmediatelyReadyAndNoTicker() {
        let ticker = ManualAiLimitTicker()
        let (model, _) = makeModel(
            AiLimitBannerInput(info: info("cost_cap", retryAfterS: 0, bannerLevel: "critical")),
            ticker: ticker,
            onRetry: {}
        )
        model.start()
        XCTAssertEqual(model.resolved.data?.secondsLeft, 0)
        XCTAssertEqual(model.resolved.data?.retryReady, true)
        XCTAssertEqual(model.resolved.data?.showRetry, true)
        XCTAssertFalse(ticker.isRunning)
    }

    func testCountdownTicksDownAndStopsAtZero() {
        let ticker = ManualAiLimitTicker()
        let (model, _) = makeModel(
            AiLimitBannerInput(info: info("per_minute", retryAfterS: 3, bannerLevel: "warn")),
            ticker: ticker,
            onRetry: {}
        )
        model.start()
        XCTAssertEqual(model.resolved.data?.secondsLeft, 3)
        XCTAssertEqual(model.resolved.data?.retryReady, false)
        XCTAssertEqual(model.resolved.data?.showRetry, false)
        XCTAssertTrue(ticker.isRunning)

        ticker.fire() // 3 → 2
        XCTAssertEqual(model.resolved.data?.secondsLeft, 2)
        ticker.fire() // 2 → 1
        ticker.fire() // 1 → 0 → stop
        XCTAssertEqual(model.resolved.data?.secondsLeft, 0)
        XCTAssertEqual(model.resolved.data?.retryReady, true)
        XCTAssertEqual(model.resolved.data?.showRetry, true)
        XCTAssertFalse(ticker.isRunning)
    }

    func testNewLimitResetsTheCountdown() {
        let ticker = ManualAiLimitTicker()
        let (model, source) = makeModel(
            AiLimitBannerInput(info: info("per_minute", retryAfterS: 3, bannerLevel: "warn")),
            ticker: ticker
        )
        model.start()
        ticker.fire() // 3 → 2
        XCTAssertEqual(model.resolved.data?.secondsLeft, 2)

        source.push(AiLimitBannerInput(info: info("per_day", retryAfterS: 10, bannerLevel: "warn")))
        XCTAssertEqual(model.resolved.data?.secondsLeft, 10)
        XCTAssertEqual(model.resolved.data?.copy.titleKey, "ai.limit.title.perDay")
        XCTAssertTrue(ticker.isRunning)
    }

    func testConnectionOnlyUpdateDoesNotResetCountdown() {
        let ticker = ManualAiLimitTicker()
        let limit = info("per_minute", retryAfterS: 5, bannerLevel: "warn")
        let (model, source) = makeModel(AiLimitBannerInput(info: limit), ticker: ticker)
        model.start()
        ticker.fire() // 5 → 4
        ticker.fire() // 4 → 3
        XCTAssertEqual(model.resolved.data?.secondsLeft, 3)

        // Same limit value, only connectivity changed → countdown must be preserved.
        source.push(AiLimitBannerInput(info: limit, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.resolved.data?.secondsLeft, 3)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let limit = info("per_day", bannerLevel: "warn")
        let (model, source) = makeModel(AiLimitBannerInput(info: limit))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AiLimitBannerInput(info: limit, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(AiLimitBannerInput(info: limit, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let limit = info("per_day", bannerLevel: "warn")
        let (model, source) = makeModel(AiLimitBannerInput(info: limit))
        model.start()
        source.push(AiLimitBannerInput(info: limit, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AiLimitBannerInput(info: limit, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(AiLimitBannerInput(info: limit, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedLimitAndDoesNotAutoRefresh() {
        let limit = info("cost_cap", bannerLevel: "critical")
        let (model, source) = makeModel(AiLimitBannerInput(info: limit))
        model.start()
        source.push(AiLimitBannerInput(info: limit, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(AiLimitBannerInput(info: info("burst")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsTickerAndReArms() {
        let ticker = ManualAiLimitTicker()
        let (model, source) = makeModel(
            AiLimitBannerInput(info: info("per_minute", retryAfterS: 9, bannerLevel: "warn")),
            ticker: ticker
        )
        model.start()
        XCTAssertTrue(ticker.isRunning)
        model.stop()
        XCTAssertFalse(ticker.isRunning)
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AiLimitBanner.surfaceSlug, "AiLimitBanner")
    }
}

// MARK: - Actions (web controlled handlers)

@MainActor
final class AiLimitBannerActionTests: XCTestCase {
    func testRetryOnlyFiresOnceTheCountdownIsReady() {
        let ticker = ManualAiLimitTicker()
        var retried = 0
        let source = InMemoryAiLimitBannerSource(
            initial: AiLimitBannerInput(info: info("per_minute", retryAfterS: 2, bannerLevel: "warn"))
        )
        let model = AiLimitBannerModel(source: source, ticker: ticker, onRetry: { retried += 1 })
        model.start()

        // Counting down → the gate suppresses the parent handler (web: button not mounted).
        model.retry()
        XCTAssertEqual(retried, 0)

        ticker.fire() // 2 → 1
        ticker.fire() // 1 → 0 → ready
        model.retry()
        XCTAssertEqual(retried, 1)
    }

    func testUseBaselineAndDismissForwardToHandlers() {
        var baselined = 0
        var dismissed = 0
        let source = InMemoryAiLimitBannerSource(
            initial: AiLimitBannerInput(info: info("cost_cap", bannerLevel: "critical"))
        )
        let model = AiLimitBannerModel(
            source: source,
            ticker: ManualAiLimitTicker(),
            onUseBaseline: { baselined += 1 },
            onDismiss: { dismissed += 1 }
        )
        model.start()
        model.useBaseline()
        model.dismiss()
        XCTAssertEqual(baselined, 1)
        XCTAssertEqual(dismissed, 1)
    }

    func testActionsAreNoOpWhenNoHandlerSupplied() {
        let source = InMemoryAiLimitBannerSource(initial: AiLimitBannerInput(info: info("burst")))
        let model = AiLimitBannerModel(source: source, ticker: ManualAiLimitTicker())
        model.start()
        // No handlers were supplied — the calls must be safe no-ops.
        model.retry()
        model.useBaseline()
        model.dismiss()
        XCTAssertEqual(model.capabilities, AiLimitBannerCapabilities())
    }
}

// MARK: - Controlled source (production parity of the web `info` prop)

@MainActor
final class StaticAiLimitBannerSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticAiLimitBannerSource(
            info: info("cost_cap", bannerLevel: "critical"),
            connection: .live
        )
        var inputs: [AiLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.info?.reason, "cost_cap")
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticAiLimitBannerSource(info: info("burst"))
        var inputs: [AiLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(AiLimitBannerInput(info: info("per_day", bannerLevel: "warn"), connection: .stale))
        XCTAssertEqual(inputs.last?.info?.reason, "per_day")
        XCTAssertEqual(inputs.last?.connection, .stale)
    }
}

// MARK: - Ticker (manual test double)

@MainActor
final class ManualAiLimitTickerTests: XCTestCase {
    func testFireInvokesScheduledTick() {
        let ticker = ManualAiLimitTicker()
        var ticks = 0
        ticker.start(interval: 1) { ticks += 1 }
        ticker.fire()
        ticker.fire()
        XCTAssertEqual(ticks, 2)
        XCTAssertEqual(ticker.startCount, 1)
        XCTAssertTrue(ticker.isRunning)
    }

    func testStopPreventsFurtherTicks() {
        let ticker = ManualAiLimitTicker()
        var ticks = 0
        ticker.start(interval: 1) { ticks += 1 }
        ticker.stop()
        ticker.fire()
        XCTAssertEqual(ticks, 0)
        XCTAssertFalse(ticker.isRunning)
        XCTAssertEqual(ticker.stopCount, 1)
    }

    func testFireTimesStopsEarlyWhenHalted() {
        let ticker = ManualAiLimitTicker()
        var ticks = 0
        ticker.start(interval: 1) {
            ticks += 1
            if ticks == 2 { ticker.stop() }
        }
        ticker.fire(times: 5)
        XCTAssertEqual(ticks, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAiLimitBannerTelemetry: AiLimitBannerTelemetry, @unchecked Sendable {
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
