//
//  FadeIn.Adapter.swift
//  TeslaSync — P4 shared surface · 0191 · FadeIn (Apple)
//
//  The Foundation-only core for the fade-in entrance wrapper — the SwiftUI parity of
//  `components/motion/FadeIn.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the two entrance phases (``FadeInPhase``), the resolved motion preference
//  (``FadeInMotionPreference`` — the native peer of the web `useMotionPreference(400)` hook), the props
//  value type (``FadeInInput``), the view-ready ``FadeInProjection``, and the pure ``FadeInProjector`` that
//  maps the props + the bound reduce-motion preference into the rendered opacity / vertical offset /
//  duration / entrance delay. No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<FadeIn>` is a PURE presentational motion wrapper. It takes its content
//  as `children`, reads one display-boundary hook (`useMotionPreference(400)`), and renders a `motion.div`
//  that lifts + fades its content in over 400 ms with an optional `delay` — there is no fetch, no
//  React-Query cache, and no Promise, so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to). Inventing such chrome would fabricate states the
//  source does not have, so this surface reproduces only the source's REAL branches — exactly as the
//  sibling presentational primitive StaggerItem (0194) did. The real branches are: the full-motion entrance
//  (hidden → shown), the optional entrance delay (web `delay`, suppressed under reduced motion), the
//  reduced-motion variant (rendered in its final state with no movement, web `initial={false}`), and the
//  empty-content leaf (the native "never a blank box" peer of the wrapper hosting no children).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum FadeInSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "FadeIn"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<FadeIn>` is anonymous (it renders no copy of its own), so the only strings this surface owns are the
/// native a11y additions for the empty-content leaf. Kept as a plain closure so the pure core has no
/// dependency on a bundle: the production app passes the P1/S10 facade, tests an identity resolver.
public typealias FadeInResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - FadeInPhase (web `initial` → `animate`)

/// The two entrance phases — the native peer of the web Framer Motion `initial` → `animate` pair. The
/// surface renders `hidden` on first layout and animates to `shown` on appear (web `initial={{ opacity: 0,
/// y: 12 }}` → `animate={{ opacity: 1, y: 0 }}`); under reduced motion the web sets `initial={false}`, so
/// the `hidden` phase already equals the final state and the transition is a no-op.
public enum FadeInPhase: Sendable, Equatable, CaseIterable {
    /// Pre-entrance — faded + lifted when motion is allowed, the final state when it is reduced.
    case hidden
    /// Post-entrance — fully opaque and settled at its resting offset.
    case shown
}

// MARK: - FadeInMotionPreference (web `useMotionPreference`)

/// The resolved motion preference — the native peer of the web `useMotionPreference(defaultMs)` return
/// value `{ reduce, durationMs }`. `reduce` is the user's Reduce Motion setting (web `useReducedMotion()`,
/// coalesced from its tri-state to `false`); `durationMs` is `0` when reduced and `defaultMs` otherwise. A
/// value type so the projection + the unit tests agree on one shape.
public struct FadeInMotionPreference: Sendable, Equatable {
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

    /// The hook's own default duration when motion is allowed, mirroring the web `useMotionPreference`
    /// signature default `defaultMs = 250`.
    public static let defaultDurationMs = 250

    /// The verbatim port of `useMotionPreference`: `reduce` is the (coalesced) Reduce Motion flag, and
    /// `durationMs` collapses to `0` when reduced, else the supplied `defaultMs`.
    public static func resolve(reduceMotion: Bool, defaultMs: Int = defaultDurationMs) -> FadeInMotionPreference {
        FadeInMotionPreference(reduce: reduceMotion, durationMs: reduceMotion ? 0 : defaultMs)
    }
}

// MARK: - FadeInInput (web props + the call-site `useMotionPreference(400)`)

/// The surface's props — the native peer of the web `<FadeIn delay className>` configuration. The web
/// component takes `children` + `delay` + `className`; the duration it derives from its
/// `useMotionPreference(400)` call. Here `delaySeconds` carries the web `delay` (seconds, default `0`) and
/// `defaultMs` carries that `400` (overridable). The web `className` is a Tailwind passthrough with no
/// native peer — a SwiftUI caller styles the `FadeIn` directly with modifiers — so it is intentionally
/// absent. A value type so a SwiftUI `.onChange` can detect a prop change cheaply.
public struct FadeInInput: Sendable, Equatable {
    /// The entrance delay in seconds (web `delay`). `0` (the default) means the content lifts + fades in
    /// immediately on appear. Suppressed to `0` under reduced motion (web `delay: reduce ? 0 : delay`).
    public let delaySeconds: Double
    /// The entrance duration in milliseconds when motion is allowed (web `useMotionPreference(400)`).
    public let defaultMs: Int

    public init(delaySeconds: Double = 0, defaultMs: Int = FadeInProjector.defaultDurationMs) {
        self.delaySeconds = delaySeconds
        self.defaultMs = defaultMs
    }
}

// MARK: - FadeInProjection (view-ready)

/// The resolved, view-ready entrance — everything the SwiftUI body needs as a pure function of the props +
/// the bound reduce-motion preference (no derivation in the view). `hiddenOpacity` / `hiddenOffsetY` are
/// the web `initial` variant (`reduce ? final-state : { opacity: 0, y: 12 }`); the `shown` variant is
/// canonical (opacity `1`, offset `0`). `durationSeconds` is the web transition duration and `delaySeconds`
/// is the entrance delay (`0` under reduced motion, web `delay: reduce ? 0 : delay`).
public struct FadeInProjection: Sendable, Equatable {
    /// Whether reduced motion is in effect (web `reduce`).
    public let reduce: Bool
    /// The entrance duration in seconds (web `durationMs / 1000`).
    public let durationSeconds: Double
    /// The entrance delay in seconds (web `delay`, `0` under reduced motion).
    public let delaySeconds: Double
    /// The opacity of the `hidden` phase (web `initial.opacity`).
    public let hiddenOpacity: Double
    /// The vertical offset of the `hidden` phase, in points (web `initial.y`).
    public let hiddenOffsetY: Double

    public init(
        reduce: Bool,
        durationSeconds: Double,
        delaySeconds: Double,
        hiddenOpacity: Double,
        hiddenOffsetY: Double
    ) {
        self.reduce = reduce
        self.durationSeconds = durationSeconds
        self.delaySeconds = delaySeconds
        self.hiddenOpacity = hiddenOpacity
        self.hiddenOffsetY = hiddenOffsetY
    }

    /// The opacity for a phase — the canonical `1` when shown, else the `hidden` variant's opacity.
    public func opacity(for phase: FadeInPhase) -> Double {
        phase == .shown ? 1 : hiddenOpacity
    }

    /// The vertical offset (points) for a phase — the canonical `0` when shown, else the `hidden` offset.
    public func offsetY(for phase: FadeInPhase) -> Double {
        phase == .shown ? 0 : hiddenOffsetY
    }
}

// MARK: - FadeInProjector (web render body)

/// The pure projection from the props + the bound reduce-motion preference to the view-ready model — the
/// surface's data adapter in the "preference → projection" sense the acceptance calls for: it takes the
/// props a page already holds plus the platform Reduce Motion flag (no fetch, no clock) and derives the
/// rendered entrance. Unit tested across the reduced / full-motion split, the delay passthrough + its
/// reduced-motion suppression, and the per-phase opacity / offset.
public enum FadeInProjector {
    /// The entrance duration the web call site requests: `useMotionPreference(400)`.
    public static let defaultDurationMs = 400

    /// The vertical lift of the `hidden` phase, in points — the web `y: 12`.
    public static let hiddenOffsetY: Double = 12

    /// Resolves the whole entrance from the props + the bound reduce-motion preference — the native peer of
    /// the web component's `initial` / `animate` + `transition` definition.
    public static func resolve(_ input: FadeInInput, reduceMotion: Bool) -> FadeInProjection {
        let preference = FadeInMotionPreference.resolve(reduceMotion: reduceMotion, defaultMs: input.defaultMs)
        return FadeInProjection(
            reduce: preference.reduce,
            durationSeconds: preference.durationSeconds,
            delaySeconds: preference.reduce ? 0 : max(0, input.delaySeconds),
            hiddenOpacity: preference.reduce ? 1 : 0,
            hiddenOffsetY: preference.reduce ? 0 : hiddenOffsetY
        )
    }
}
