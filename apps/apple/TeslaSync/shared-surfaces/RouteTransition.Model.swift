//
//  RouteTransition.Model.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  The state-holder seam (P1/S8) and the telemetry seam (P1/S11) for the route cross-fade wrapper. The
//  view binds through `RouteTransitionModel`; no networking lives in the view (the web source has none —
//  it reads `useLocation` + `useMotionPreference` and cross-fades `children`). The model owns the
//  previous-path ref the web tracks with `useRef`, resolves each navigation to a pure
//  `RouteTransitionDecision`, holds the currently-rendered path that drives the SwiftUI identity swap,
//  and emits the `view.opened` diagnostics event exactly once when the surface first appears.
//
//  There is no async data source because the web source has no data dependency. The reduced-motion
//  input is supplied by the view from `@Environment(\.accessibilityReduceMotion)` — the native parity of
//  the web `useMotionPreference` read — and threaded into the decision, so the model stays free of any
//  UIKit / SwiftUI dependency and is exercised by the pure tests.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol RouteTransitionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRouteTransitionTelemetry: RouteTransitionTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Owns the previous-path ref (web `prevPathRef`), the
/// currently-rendered path (the value the view keys its content on), and the last resolved decision.
/// Resolves each navigation through `RouteTransitionProjection.decide`, advances the previous-path ref
/// afterwards (web `prevPathRef.current = newPath`), and emits `view.opened` once on first appear. There
/// is no async source because the web source has no data dependency.
@MainActor
@Observable
public final class RouteTransitionModel {
    /// The path the view currently keys its content on. Advancing this (inside the view's animation
    /// transaction) is what drives the SwiftUI identity swap that plays the cross-fade.
    public private(set) var renderedPath: String

    /// The decision resolved for the most recent navigation — the view reads it to choose the transition
    /// + animation. Seeded to `.initial` so the first appearance plays no entry animation
    /// (web `initial={false}`).
    public private(set) var currentDecision: RouteTransitionDecision

    /// The active list ↔ detail skip patterns (web `skipPattern`).
    public let skipPatterns: [String]

    /// The base cross-fade duration in milliseconds (web `useMotionPreference(120)`), guarded positive.
    public let baseDurationMs: Double

    @ObservationIgnored private var previousPath: String
    @ObservationIgnored private let telemetry: any RouteTransitionTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: RouteTransitionInput,
        telemetry: any RouteTransitionTelemetry = OSLogRouteTransitionTelemetry()
    ) {
        renderedPath = input.initialPath
        previousPath = input.initialPath
        skipPatterns = input.skipPatterns
        baseDurationMs = input.effectiveBaseDurationMs
        currentDecision = RouteTransitionDecision(phase: .initial, durationMs: 0)
        self.telemetry = telemetry
    }

    // MARK: Decision (pure read)

    /// Resolves what a navigation to `newPath` would do, without mutating any state — the view calls this
    /// first so it can pick the right SwiftUI animation transaction before committing.
    public func makeDecision(forNext newPath: String, reduceMotion: Bool) -> RouteTransitionDecision {
        RouteTransitionProjection.decide(
            previousPath: previousPath,
            newPath: newPath,
            reduceMotion: reduceMotion,
            skipPatterns: skipPatterns,
            baseDurationMs: baseDurationMs
        )
    }

    // MARK: Commit (advances the rendered + previous path)

    /// Adopts a resolved decision: records it, swaps the rendered path (the SwiftUI identity change), and
    /// advances the previous-path ref (web `prevPathRef.current = newPath`). The view wraps this in the
    /// matching animation / no-animation transaction; the model itself stays SwiftUI-free.
    public func commit(_ newPath: String, decision: RouteTransitionDecision) {
        currentDecision = decision
        renderedPath = newPath
        previousPath = newPath
    }

    /// Resolves + commits a navigation in one call and returns the decision — the convenience the tests
    /// drive (the view splits the two so it can choose the animation transaction between them).
    @discardableResult
    public func transition(to newPath: String, reduceMotion: Bool) -> RouteTransitionDecision {
        let decision = makeDecision(forNext: newPath, reduceMotion: reduceMotion)
        commit(newPath, decision: decision)
        return decision
    }

    // MARK: Lifecycle

    /// Records the surface open exactly once (P1/S11 `view.opened`). Idempotent across re-appears.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: RouteTransitionMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}
}
