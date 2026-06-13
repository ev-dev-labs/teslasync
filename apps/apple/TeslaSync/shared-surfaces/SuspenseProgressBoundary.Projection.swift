//
//  SuspenseProgressBoundary.Projection.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  The pure reducer behind the bar — the native port of the web `@/lib/globalProgress` controller math.
//  The web controller is an imperative singleton (mutable `activeCount` / `progress` + a `setInterval`
//  trickle); here that logic is split into an immutable `SuspenseProgressState` plus three total
//  transitions so the start / stop / trickle behaviour can be asserted deterministically without a
//  timer or a live store. The stateful `SuspenseProgressController` (P1/S8) merely advances this
//  reducer on each tick and publishes the result.
//
//  Verbatim source mapping:
//
//      start():  activeCount++; if (activeCount === 1) progress = TRICKLE_INITIAL          → started(_:)
//      trickle:  progress = Math.min(TARGET, progress + Math.max(1, remaining * 0.15))      → ticked(_:)
//      stop():   activeCount = Math.max(0, activeCount - 1);
//                if (activeCount === 0) progress = 0                                         → stopped(_:)
//
//  The reducer additionally hardens the web's un-guarded arithmetic: a non-finite `progress` collapses
//  to the idle origin rather than propagating `NaN` into the bar geometry, so the surface is never a
//  broken strip.
//

import Foundation

// MARK: - Reducer state (web `activeCount` + `progress`)

/// One immutable snapshot of the controller — the parity of the web module-scoped `activeCount` and
/// `progress`. `activeCount` stacks concurrent consumers (every mounted boundary fallback + every
/// opt-in mutation); `progress` is the 0…80 asymptotic trickle. The bar is visible while `isActive`.
public struct SuspenseProgressState: Sendable, Equatable {
    public var activeCount: Int
    public var progress: Double

    public init(activeCount: Int = 0, progress: Double = 0) {
        self.activeCount = Swift.max(0, activeCount)
        self.progress = progress
    }

    /// Web `const active = activeCount > 0` — at least one consumer is holding the bar open.
    public var isActive: Bool {
        activeCount > 0
    }

    /// The resting origin — no consumers, no progress. The snap-back target when the last consumer
    /// stops (web sets `progress = 0` and `active = false`).
    public static let idle = SuspenseProgressState(activeCount: 0, progress: 0)
}

// MARK: - Reducer (start / trickle / stop)

/// The pure transitions that drive the bar — the verbatim port of the web `globalProgress` start,
/// trickle, and stop arithmetic. No SwiftUI, no timer, no shared mutable state, so every edge (first
/// activation jump, asymptotic cap, concurrent stacking, idempotent floor) is unit tested directly.
public enum SuspenseProgressReducer {
    /// Web `start`: `activeCount++`, and on the first activation jump `progress` to `TRICKLE_INITIAL`
    /// so the bar is instantly visible; further concurrent starts only stack the count.
    public static func started(_ state: SuspenseProgressState) -> SuspenseProgressState {
        let nextCount = state.activeCount + 1
        let nextProgress = state.activeCount == 0 ? SuspenseProgressBoundaryMeta.trickleInitial : safe(state.progress)
        return SuspenseProgressState(activeCount: nextCount, progress: nextProgress)
    }

    /// Web trickle tick: `progress = Math.min(TARGET, progress + Math.max(1, remaining * 0.15))`, but
    /// only while active and below the target. A no-op once parked at the ceiling or when idle.
    public static func ticked(_ state: SuspenseProgressState) -> SuspenseProgressState {
        guard state.isActive else { return state }
        let current = safe(state.progress)
        guard current < SuspenseProgressBoundaryMeta.trickleTarget else {
            return SuspenseProgressState(activeCount: state.activeCount, progress: current)
        }
        let remaining = SuspenseProgressBoundaryMeta.trickleTarget - current
        let step = Swift.max(
            SuspenseProgressBoundaryMeta.trickleMinStep,
            remaining * SuspenseProgressBoundaryMeta.trickleStepFraction
        )
        let next = Swift.min(SuspenseProgressBoundaryMeta.trickleTarget, current + step)
        return SuspenseProgressState(activeCount: state.activeCount, progress: next)
    }

    /// Web `stop`: `activeCount = Math.max(0, activeCount - 1)`, and on reaching zero snap `progress`
    /// back to 0. The floor guards the web's StrictMode double-stop underflow.
    public static func stopped(_ state: SuspenseProgressState) -> SuspenseProgressState {
        let nextCount = Swift.max(0, state.activeCount - 1)
        let nextProgress = nextCount == 0 ? 0 : safe(state.progress)
        return SuspenseProgressState(activeCount: nextCount, progress: nextProgress)
    }

    /// A finite progress value or the idle origin — the guard the web arithmetic omits, so a `NaN`
    /// never reaches the bar width.
    private static func safe(_ progress: Double) -> Double {
        progress.isFinite ? progress : 0
    }
}
