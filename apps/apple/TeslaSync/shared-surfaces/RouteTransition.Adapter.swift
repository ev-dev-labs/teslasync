//
//  RouteTransition.Adapter.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  The testable, dependency-light core for the route cross-fade wrapper — the SwiftUI parity of
//  `components/motion/RouteTransition.tsx`. Everything here is pure (Foundation only): the surface
//  metadata (the diagnostics slug + the verbatim web constants), the genuine render-phase enum, the
//  coalesced input snapshot (the web props), and the resolved transition decision the view paints.
//  No store, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is a presentational motion wrapper: it reads two hooks
//  (`useLocation`, `useMotionPreference`) and cross-fades `children` on a `pathname` change. It performs
//  no fetch and has no loading / error / empty / stale / offline branch to mirror; synthesising such
//  chrome would invent state the web source does not have (the same disposition as the 0075
//  AnimatedNumber surface). The genuine render branches this core models are exactly the ones the web
//  has: `initial` (the very first appearance — the web `initial={false}` skips the entry animation),
//  `stable` (a re-render with an unchanged path — the web key is identical so nothing transitions),
//  `animated` (a path change that cross-fades — the web 120 ms ease-out + 4 pt slide), and `suppressed`
//  (a path change with the fade collapsed to an instant swap, because the user requested reduced motion
//  or because the navigation is a list ↔ detail drill the web skips for snappiness).
//

import Foundation

// MARK: - Surface metadata (diagnostics slug + verbatim web constants)

/// The static identity + tuning of the surface — the P1/S11 diagnostics slug emitted with
/// `view.opened`, plus the verbatim web constants read out of `RouteTransition.tsx`: the
/// `useMotionPreference(120)` cross-fade duration, the `initial={{ opacity: 0, y: 4 }}` enter slide, the
/// `exit={{ opacity: 0, y: -4 }}` exit slide, and the default list ↔ detail skip patterns that suppress
/// the fade on a drill-in / drill-back-out.
public enum RouteTransitionMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RouteTransition"

    /// Web `useMotionPreference(120)` — the cross-fade duration in milliseconds.
    public static let crossfadeDurationMs: Double = 120

    /// Web `initial={{ opacity: 0, y: 4 }}` — the incoming page starts 4 pt below and fades up.
    public static let enterOffsetY: Double = 4

    /// Web `exit={{ opacity: 0, y: -4 }}` — the outgoing page slides 4 pt up while fading out.
    public static let exitOffsetY: Double = -4

    /// Web `DEFAULT_SKIP_PATTERNS` — the route patterns where the page-transition cross-fade is
    /// suppressed. Drilling from a list (`/drives`) into a detail (`/drives/123`) — and back out — feels
    /// better near-instant, so the fade is skipped when EITHER the previous or the new path matches one
    /// of these. Patterns use the react-router v6 `:param` syntax the native matcher reproduces.
    public static let defaultSkipPatterns: [String] = [
        "/drives/:id",
        "/drives/:id/replay",
        "/charging/:id",
        "/vehicles/:id",
        "/vehicles/:id/access",
        "/trips/:id"
    ]
}

// MARK: - Suppression reason (why a path change skipped the fade)

/// Why a path change rendered an instant swap instead of the cross-fade — the two arms of the web
/// `reduce || skipForList` guard, kept distinct so the exact branch is asserted in tests and surfaced to
/// diagnostics. `reduceMotion` takes precedence (it is the left operand of the web `||`).
public enum RouteTransitionSuppression: Sendable, Equatable {
    /// The user requested reduced motion (web `useMotionPreference` → `reduce`): the fade is a no-op.
    case reduceMotion
    /// The navigation is a list ↔ detail drill that the web skips for snappiness (web `skipForList`).
    case skipPattern
}

// MARK: - Render phase (the genuine web render branches)

/// The genuine render branches the web source has (see the file-header parity note). `initial` is the
/// first appearance (web `initial={false}`); `stable` is a re-render with an unchanged path (the web key
/// is identical, so `AnimatePresence` runs nothing); `animated` is a cross-faded path change; and
/// `suppressed` is a path change collapsed to an instant swap, carrying the reason.
public enum RouteTransitionPhase: Sendable, Equatable {
    /// The very first appearance — content renders with no entry animation (web `initial={false}`).
    case initial
    /// A re-render with an unchanged path — nothing transitions (the web key did not change).
    case stable
    /// A path change that cross-fades (web 120 ms ease-out + 4 pt slide).
    case animated
    /// A path change with the fade collapsed to an instant swap (reduced motion or a list ↔ detail drill).
    case suppressed(RouteTransitionSuppression)

    /// Whether this phase plays the cross-fade (web `effectiveDurationMs > 0`). Only `animated` does.
    public var animates: Bool {
        if case .animated = self {
            return true
        }
        return false
    }
}

// MARK: - Transition decision (the resolved render outcome for one path change)

/// The resolved outcome of a path change — the phase plus the effective duration the view animates with
/// (the web `effectiveDurationMs`, `0` for every non-`animated` phase). The view derives its
/// `AnyTransition` + `Animation` from this; the projection produces it; the tests assert it. This is how
/// the per-state "snapshot" is expressed deterministically without a pixel harness.
public struct RouteTransitionDecision: Sendable, Equatable {
    /// The resolved render phase (web JSX branch).
    public let phase: RouteTransitionPhase

    /// The effective cross-fade duration in milliseconds — the web `effectiveDurationMs`. Zero for
    /// `initial` / `stable` / `suppressed`; the base duration for `animated`.
    public let durationMs: Double

    public init(phase: RouteTransitionPhase, durationMs: Double) {
        self.phase = phase
        self.durationMs = durationMs
    }

    /// Whether the cross-fade plays for this decision (web `effectiveDurationMs > 0`).
    public var animates: Bool {
        phase.animates
    }

    /// The effective duration in seconds — the value the view feeds SwiftUI (web
    /// `transition={{ duration: effectiveDurationMs / 1000 }}`).
    public var durationSeconds: Double {
        durationMs / 1000
    }
}

// MARK: - Input snapshot (web props)

/// One coalesced snapshot of the surface's inputs — the web props plus the seed path. `initialPath` is
/// the pathname at mount (the web `useLocation().pathname` on first render); `skipPatterns` mirrors the
/// web `skipPattern` prop (defaulting to `DEFAULT_SKIP_PATTERNS`); `baseDurationMs` is the
/// `useMotionPreference(120)` duration. Equatable so the view can react to prop changes.
public struct RouteTransitionInput: Sendable, Equatable {
    public var initialPath: String
    public var skipPatterns: [String]
    public var baseDurationMs: Double

    public init(
        initialPath: String,
        skipPatterns: [String] = RouteTransitionMeta.defaultSkipPatterns,
        baseDurationMs: Double = RouteTransitionMeta.crossfadeDurationMs
    ) {
        self.initialPath = initialPath
        self.skipPatterns = skipPatterns
        self.baseDurationMs = baseDurationMs
    }

    /// The base duration guarded to a sane positive value so a caller passing `0` (or a negative) can
    /// never produce a non-finite SwiftUI animation; falls back to the web default of 120 ms.
    public var effectiveBaseDurationMs: Double {
        baseDurationMs > 0 ? baseDurationMs : RouteTransitionMeta.crossfadeDurationMs
    }
}
