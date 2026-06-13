//
//  SuspenseProgressBoundary.Controller.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  The stateful progress controller (P1/S8 state-holder) — the native parity of the web
//  `@/lib/globalProgress` singleton. It owns the `SuspenseProgressState`, exposes the observable
//  `isActive` / `progress` / `valueNow` the bar renders, and drives the asymptotic trickle with a
//  cooperative `Task` (the parity of the web `setInterval`). Each `start()` returns an idempotent stop
//  closure that MUST be paired with the start — the same contract as the web (`try/finally` / effect
//  cleanup) — and concurrent starts stack so the bar stays active until the last stop fires.
//
//  Concurrency: `@MainActor`-isolated so the observable state mutates on the UI actor and the trickle
//  `Task` (started from a `@MainActor` method) advances the reducer on the main actor. The trickle is
//  cancelled the moment the last consumer stops, so no timer survives an idle controller.
//

import Foundation
import Observation

// MARK: - Progress controller (web `globalProgress` singleton)

/// The observable "is the app busy?" channel — the native parity of the web `globalProgress`. Boundary
/// fallbacks (and any opt-in long mutation) call `start()` while busy and invoke the returned stop when
/// done; the bar observes `isActive` / `valueNow`. The trickle advances `progress` asymptotically toward
/// 80 % while at least one consumer is active, then snaps back to 0 when the last one stops.
@MainActor
@Observable
public final class SuspenseProgressController {
    /// The process-wide shared channel — the parity of the web module singleton. App-root bars bind
    /// this; boundaries default to it so concurrent fallbacks stack into one bar. Tests and previews
    /// inject a fresh instance to stay isolated.
    public static let shared = SuspenseProgressController()

    public private(set) var state: SuspenseProgressState

    @ObservationIgnored private let intervalMilliseconds: Int
    @ObservationIgnored private var trickleTask: Task<Void, Never>?

    /// Creates a controller with an injectable trickle interval (default the web `TRICKLE_INTERVAL_MS`).
    /// Tests pass a tiny interval (or drive `advance()` directly) to assert the trickle deterministically.
    public init(intervalMilliseconds: Int = SuspenseProgressBoundaryMeta.trickleIntervalMs) {
        self.intervalMilliseconds = Swift.max(1, intervalMilliseconds)
        state = .idle
    }

    /// Web `active` — at least one consumer is holding the bar open.
    public var isActive: Bool {
        state.isActive
    }

    /// The raw 0…80 asymptotic trickle.
    public var progress: Double {
        state.progress
    }

    /// The bar's whole-percent accessibility value (web `aria-valuenow`).
    public var valueNow: Int {
        SuspenseProgressBoundaryMeta.valueNow(state.progress)
    }

    /// Registers a consumer and returns its idempotent stop — the parity of the web `start(): () => void`.
    /// The first consumer jumps the bar to the initial fill and launches the trickle; the returned
    /// closure can be safely called more than once (StrictMode / defensive `finally`) without
    /// underflowing the active count.
    @discardableResult
    public func start() -> () -> Void {
        state = SuspenseProgressReducer.started(state)
        if state.activeCount == 1 {
            startTrickle()
        }
        var stopped = false
        return { [weak self] in
            guard !stopped else { return }
            stopped = true
            self?.handleStop()
        }
    }

    /// Advances the trickle one tick and reports whether the controller is still active — the body of
    /// the trickle loop, exposed so the reducer-driven motion is asserted without waiting on wall-clock
    /// time.
    @discardableResult
    public func advance() -> Bool {
        guard state.isActive else { return false }
        state = SuspenseProgressReducer.ticked(state)
        return true
    }

    /// Force-clears the controller to the idle origin — the parity of the web test-only reset. Used by
    /// previews and tests to guarantee a clean channel; the running app reaches idle organically when
    /// the last consumer stops.
    public func reset() {
        trickleTask?.cancel()
        trickleTask = nil
        state = .idle
    }

    private func handleStop() {
        state = SuspenseProgressReducer.stopped(state)
        if state.activeCount == 0 {
            stopTrickle()
        }
    }

    private func startTrickle() {
        guard trickleTask == nil else { return }
        let interval = intervalMilliseconds
        trickleTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(interval))
                if Task.isCancelled { break }
                guard let self, advance() else { break }
            }
        }
    }

    private func stopTrickle() {
        trickleTask?.cancel()
        trickleTask = nil
        state = .idle
    }
}
