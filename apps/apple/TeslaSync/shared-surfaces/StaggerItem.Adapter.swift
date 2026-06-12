//
//  StaggerItem.Adapter.swift
//  TeslaSync — P4 shared surface · 0194 · StaggerItem (Apple)
//
//  The Foundation-only core for the staggered-entrance item — the SwiftUI parity of
//  `components/motion/StaggerItem.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the two entrance phases (``StaggerItemPhase``), the resolved motion preference
//  (``StaggerItemMotionPreference`` — the native peer of the web `useMotionPreference(350)` hook), the
//  props value type (``StaggerItemInput``), the view-ready ``StaggerItemProjection``, and the pure
//  ``StaggerItemProjector`` that maps the props + the bound reduce-motion preference into the rendered
//  opacity / vertical offset / duration / cascade delay. No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<StaggerItem>` is a PURE presentational motion wrapper. It takes its
//  content as `children`, reads one display-boundary hook (`useMotionPreference`), and renders a
//  `motion.div` that lifts + fades its content in — there is no fetch, no React-Query cache, and no
//  Promise, so it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age,
//  or lose connectivity to). Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  primitives Delta (0081), MetricCard (0095), and InlineCallout (0124) did. The real branches are: the
//  full-motion entrance (hidden → shown), the reduced-motion variant (rendered in its final state with no
//  movement, web `reduce ? { opacity: 1, y: 0 }`), and the empty-content leaf (the native "never a blank
//  box" peer of the wrapper hosting no children).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum StaggerItemSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StaggerItem"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<StaggerItem>` is anonymous (it renders no copy of its own), so the only strings this surface owns
/// are the native a11y additions for the empty-content leaf. Kept as a plain closure so the pure core has
/// no dependency on a bundle: the production app passes the P1/S10 facade, tests an identity resolver.
public typealias StaggerItemResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - StaggerItemPhase (web variants `hidden` / `show`)

/// The two entrance phases — the native peer of the web Framer Motion variants `hidden` and `show`. The
/// surface renders `hidden` on first layout and animates to `shown` on appear (web `StaggerContainer`'s
/// `initial="hidden"` → `animate="show"`); under reduced motion the `hidden` phase already equals the
/// final state, so the transition is a no-op.
public enum StaggerItemPhase: Sendable, Equatable, CaseIterable {
    /// Pre-entrance — faded + lifted when motion is allowed, the final state when it is reduced.
    case hidden
    /// Post-entrance — fully opaque and settled at its resting offset.
    case shown
}

// MARK: - StaggerItemMotionPreference (web `useMotionPreference`)

/// The resolved motion preference — the native peer of the web `useMotionPreference(defaultMs)` return
/// value `{ reduce, durationMs }`. `reduce` is the user's Reduce Motion setting (web
/// `useReducedMotion()`, coalesced from its tri-state to `false`); `durationMs` is `0` when reduced and
/// `defaultMs` otherwise. A value type so the projection + the unit tests agree on one shape.
public struct StaggerItemMotionPreference: Sendable, Equatable {
    /// True when the user has requested reduced motion (web `reduce`).
    public let reduce: Bool
    /// The recommended transition duration in milliseconds, `0` when reduced (web `durationMs`).
    public let durationMs: Int

    public init(reduce: Bool, durationMs: Int) {
        self.reduce = reduce
        self.durationMs = durationMs
    }

    /// The duration in seconds — the native peer of the web `durationMs / 1000` passed straight into the
    /// transition. `0` when reduced, so call sites get an instant settle.
    public var durationSeconds: Double {
        Double(durationMs) / 1000
    }

    /// The default duration when motion is allowed, mirroring the web hook's `defaultMs = 250`.
    public static let defaultDurationMs = 250

    /// The verbatim port of `useMotionPreference`: `reduce` is the (coalesced) Reduce Motion flag, and
    /// `durationMs` collapses to `0` when reduced, else the supplied `defaultMs`.
    public static func resolve(reduceMotion: Bool, defaultMs: Int = defaultDurationMs) -> StaggerItemMotionPreference {
        StaggerItemMotionPreference(reduce: reduceMotion, durationMs: reduceMotion ? 0 : defaultMs)
    }
}

// MARK: - StaggerItemInput (web props + the call-site `useMotionPreference(350)`)

/// The surface's props — the native peer of the web `<StaggerItem>` configuration. The web component
/// takes `children` + `className`; the timing it derives from its `useMotionPreference(350)` call. Here
/// `defaultMs` carries that `350` (overridable), and `index` carries the cascade position the web
/// `StaggerContainer` orchestrates via `staggerChildren: 0.06` (the parent is out of this surface's
/// scope, so each item derives its own delay from its index — the same approach the app's existing
/// `TSStaggerItem` uses). A value type so a SwiftUI `.onChange` can detect a prop change cheaply.
public struct StaggerItemInput: Sendable, Equatable {
    /// The cascade position used to derive the entrance delay (web container `staggerChildren`). `0`
    /// (the default) means no delay — a standalone item that simply lifts + fades in.
    public let index: Int
    /// The entrance duration in milliseconds when motion is allowed (web `useMotionPreference(350)`).
    public let defaultMs: Int

    public init(index: Int = 0, defaultMs: Int = StaggerItemProjector.defaultDurationMs) {
        self.index = index
        self.defaultMs = defaultMs
    }
}

// MARK: - StaggerItemProjection (view-ready)

/// The resolved, view-ready entrance — everything the SwiftUI body needs as a pure function of the props
/// + the bound reduce-motion preference (no derivation in the view). `hiddenOpacity` / `hiddenOffsetY`
/// are the web `hidden` variant (`reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }`); the `shown`
/// variant is canonical (opacity `1`, offset `0`). `durationSeconds` is the web transition duration and
/// `staggerDelaySeconds` is the cascade delay (`0` under reduced motion, web `staggerChildren: reduce ? 0
/// : 0.06`).
public struct StaggerItemProjection: Sendable, Equatable {
    /// Whether reduced motion is in effect (web `reduce`).
    public let reduce: Bool
    /// The entrance duration in seconds (web `durationMs / 1000`).
    public let durationSeconds: Double
    /// The cascade delay in seconds derived from the item index (web container `staggerChildren`).
    public let staggerDelaySeconds: Double
    /// The opacity of the `hidden` phase (web `hidden.opacity`).
    public let hiddenOpacity: Double
    /// The vertical offset of the `hidden` phase, in points (web `hidden.y`).
    public let hiddenOffsetY: Double

    public init(
        reduce: Bool,
        durationSeconds: Double,
        staggerDelaySeconds: Double,
        hiddenOpacity: Double,
        hiddenOffsetY: Double
    ) {
        self.reduce = reduce
        self.durationSeconds = durationSeconds
        self.staggerDelaySeconds = staggerDelaySeconds
        self.hiddenOpacity = hiddenOpacity
        self.hiddenOffsetY = hiddenOffsetY
    }

    /// The opacity for a phase — the canonical `1` when shown, else the `hidden` variant's opacity.
    public func opacity(for phase: StaggerItemPhase) -> Double {
        phase == .shown ? 1 : hiddenOpacity
    }

    /// The vertical offset (points) for a phase — the canonical `0` when shown, else the `hidden` offset.
    public func offsetY(for phase: StaggerItemPhase) -> Double {
        phase == .shown ? 0 : hiddenOffsetY
    }
}

// MARK: - StaggerItemProjector (web render body)

/// The pure projection from the props + the bound reduce-motion preference to the view-ready model — the
/// surface's data adapter in the "preference → projection" sense the acceptance calls for: it takes the
/// props a page already holds plus the platform Reduce Motion flag (no fetch, no clock) and derives the
/// rendered entrance. Unit tested across the reduced / full-motion split, the index-driven cascade delay,
/// and the per-phase opacity / offset.
public enum StaggerItemProjector {
    /// The entrance duration the web call site requests: `useMotionPreference(350)`.
    public static let defaultDurationMs = 350

    /// The vertical lift of the `hidden` phase, in points — the web `y: 15`.
    public static let hiddenOffsetY: Double = 15

    /// The per-item cascade step, in seconds — the web `StaggerContainer`'s `staggerChildren: 0.06`.
    public static let staggerStepSeconds: Double = 0.06

    /// Resolves the whole entrance from the props + the bound reduce-motion preference — the native peer
    /// of the web component's variant + transition definition.
    public static func resolve(_ input: StaggerItemInput, reduceMotion: Bool) -> StaggerItemProjection {
        let preference = StaggerItemMotionPreference.resolve(
            reduceMotion: reduceMotion,
            defaultMs: input.defaultMs
        )
        return StaggerItemProjection(
            reduce: preference.reduce,
            durationSeconds: preference.durationSeconds,
            staggerDelaySeconds: preference.reduce ? 0 : Double(max(0, input.index)) * staggerStepSeconds,
            hiddenOpacity: preference.reduce ? 1 : 0,
            hiddenOffsetY: preference.reduce ? 0 : hiddenOffsetY
        )
    }
}
