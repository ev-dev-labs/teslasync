//
//  StaggerContainer.Adapter.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  The Foundation-only core for the staggered-entrance container — the SwiftUI parity of
//  `components/motion/StaggerContainer.tsx`. This file owns the surface identity (the diagnostics slug),
//  the i18n facade seam, the two orchestration phases (``StaggerContainerPhase``), the resolved motion
//  preference (``StaggerContainerMotionPreference`` — the native peer of the web `useMotionPreference()`
//  hook the container calls), the props value type (``StaggerContainerInput``), the view-ready
//  ``StaggerContainerProjection``, and the pure ``StaggerContainerProjector`` that maps the props + the
//  bound reduce-motion preference into the cascade step, the per-index entrance delay, and the hosted
//  child's opacity / vertical offset / duration. No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<StaggerContainer>` is a PURE presentational motion wrapper. It takes its
//  content as `children`, reads one display-boundary hook (`useMotionPreference()`), and renders a
//  `motion.div` whose `show` variant carries `transition: { staggerChildren: reduce ? 0 : 0.06 }` — the
//  cascade that delays each child's entrance. There is no fetch, no React-Query cache, and no Promise, so
//  it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces only the source's REAL branches — exactly as the sibling presentational primitives StaggerItem
//  (0194) and FadeIn (0191) did. The real branches are: the full-motion cascade (children enter hidden →
//  shown, each delayed `index * 0.06 s`), the reduced-motion variant (the stagger collapses to a no-op and
//  children render in their final state with no movement, web `staggerChildren: reduce ? 0`), and the
//  empty-content leaf (the native "never a blank box" peer of the container hosting no children).
//
//  The container itself has no transform — the web `hidden` variant is empty (`hidden: {}`), so the
//  container neither fades nor moves; it only orchestrates the timing of its children. The per-child
//  opacity / offset / duration this core resolves are the canonical hosted child (the `<StaggerItem>` the
//  container is built to wrap): opacity `0 → 1`, lifted `15` pt → `0`, over `350` ms.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum StaggerContainerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StaggerContainer"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<StaggerContainer>` is anonymous (it renders no copy of its own), so the only strings this surface owns
/// are the native a11y additions for the empty-content leaf. Kept as a plain closure so the pure core has
/// no dependency on a bundle: the production app passes the P1/S10 facade, tests an identity resolver.
public typealias StaggerContainerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - StaggerContainerPhase (web variants `hidden` / `show`)

/// The two orchestration phases — the native peer of the web Framer Motion variants `hidden` and `show`.
/// The container starts `hidden` on first layout and animates to `shown` on appear (web `initial="hidden"`
/// → `animate="show"`); every hosted child inherits the phase from the container and reveals on the flip,
/// delayed by its cascade position. Under reduced motion the `hidden` phase already equals the final state,
/// so the transition is a no-op.
public enum StaggerContainerPhase: Sendable, Equatable, CaseIterable {
    /// Pre-entrance — children faded + lifted when motion is allowed, the final state when it is reduced.
    case hidden
    /// Post-entrance — children fully opaque and settled at their resting offset.
    case shown
}

// MARK: - StaggerContainerMotionPreference (web `useMotionPreference`)

/// The resolved motion preference — the native peer of the web `useMotionPreference(defaultMs)` return
/// value `{ reduce, durationMs }`. The web container destructures only `reduce`; this type models the whole
/// hook return so the boundary is faithful and unit-tested. `reduce` is the user's Reduce Motion setting
/// (web `useReducedMotion()`, coalesced from its tri-state to `false`); `durationMs` is `0` when reduced and
/// `defaultMs` otherwise. A value type so the projection + the unit tests agree on one shape.
public struct StaggerContainerMotionPreference: Sendable, Equatable {
    /// True when the user has requested reduced motion (web `reduce`).
    public let reduce: Bool
    /// The recommended transition duration in milliseconds, `0` when reduced (web `durationMs`).
    public let durationMs: Int

    public init(reduce: Bool, durationMs: Int) {
        self.reduce = reduce
        self.durationMs = durationMs
    }

    /// The duration in seconds — the native peer of the web `durationMs / 1000`. `0` when reduced.
    public var durationSeconds: Double {
        Double(durationMs) / 1000
    }

    /// The default duration when motion is allowed, mirroring the web container's `useMotionPreference()`
    /// call with no argument (`defaultMs = 250`).
    public static let defaultDurationMs = 250

    /// The verbatim port of `useMotionPreference`: `reduce` is the (coalesced) Reduce Motion flag, and
    /// `durationMs` collapses to `0` when reduced, else the supplied `defaultMs`.
    public static func resolve(
        reduceMotion: Bool,
        defaultMs: Int = defaultDurationMs
    ) -> StaggerContainerMotionPreference {
        StaggerContainerMotionPreference(reduce: reduceMotion, durationMs: reduceMotion ? 0 : defaultMs)
    }
}

// MARK: - StaggerContainerInput (web props + the call-site `useMotionPreference()`)

/// The surface's props — the native peer of the web `<StaggerContainer>` configuration. The web component
/// takes `children` + `className`; its timing it derives from the cascade `staggerChildren: 0.06`. Here
/// `stepSeconds` carries that `0.06` (the per-child cascade step), and `childDurationMs` carries the
/// canonical hosted child's entrance duration (the `<StaggerItem>` the container wraps, web
/// `useMotionPreference(350)`). Both default to the web values and are overridable. A value type so a
/// SwiftUI `.onChange` can detect a prop change cheaply.
public struct StaggerContainerInput: Sendable, Equatable {
    /// The per-child cascade step in seconds (web container `staggerChildren: 0.06`).
    public let stepSeconds: Double
    /// The hosted child's entrance duration in milliseconds when motion is allowed (web `<StaggerItem>`'s
    /// `useMotionPreference(350)`).
    public let childDurationMs: Int

    public init(
        stepSeconds: Double = StaggerContainerProjector.staggerStepSeconds,
        childDurationMs: Int = StaggerContainerProjector.childDefaultDurationMs
    ) {
        self.stepSeconds = stepSeconds
        self.childDurationMs = childDurationMs
    }
}

// MARK: - StaggerContainerProjection (view-ready)

/// The resolved, view-ready cascade — everything the SwiftUI body needs as a pure function of the props +
/// the bound reduce-motion preference (no derivation in the view). `staggerStepSeconds` is the web
/// `staggerChildren` (`reduce ? 0 : 0.06`); `delaySeconds(forIndex:)` is the per-child entrance delay it
/// orchestrates. `childHiddenOpacity` / `childHiddenOffsetY` are the hosted child's `hidden` variant
/// (`reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }`); the `shown` variant is canonical (opacity
/// `1`, offset `0`). `childDurationSeconds` is the hosted child's entrance duration (`0` under reduced
/// motion).
public struct StaggerContainerProjection: Sendable, Equatable {
    /// Whether reduced motion is in effect (web `reduce`).
    public let reduce: Bool
    /// The per-child cascade step in seconds (web `staggerChildren: reduce ? 0 : 0.06`).
    public let staggerStepSeconds: Double
    /// The hosted child's entrance duration in seconds (web child `durationMs / 1000`, `0` under reduce).
    public let childDurationSeconds: Double
    /// The opacity of a hosted child's `hidden` phase (web child `hidden.opacity`).
    public let childHiddenOpacity: Double
    /// The vertical offset of a hosted child's `hidden` phase, in points (web child `hidden.y`).
    public let childHiddenOffsetY: Double

    public init(
        reduce: Bool,
        staggerStepSeconds: Double,
        childDurationSeconds: Double,
        childHiddenOpacity: Double,
        childHiddenOffsetY: Double
    ) {
        self.reduce = reduce
        self.staggerStepSeconds = staggerStepSeconds
        self.childDurationSeconds = childDurationSeconds
        self.childHiddenOpacity = childHiddenOpacity
        self.childHiddenOffsetY = childHiddenOffsetY
    }

    /// The entrance delay (seconds) for the child at `index` — the native peer of the web container
    /// `staggerChildren` orchestration (`index * step`). A negative index clamps to no delay.
    public func delaySeconds(forIndex index: Int) -> Double {
        staggerStepSeconds * Double(max(0, index))
    }

    /// The opacity for a phase — the canonical `1` when shown, else the `hidden` variant's opacity.
    public func childOpacity(for phase: StaggerContainerPhase) -> Double {
        phase == .shown ? 1 : childHiddenOpacity
    }

    /// The vertical offset (points) for a phase — the canonical `0` when shown, else the `hidden` offset.
    public func childOffsetY(for phase: StaggerContainerPhase) -> Double {
        phase == .shown ? 0 : childHiddenOffsetY
    }
}

// MARK: - StaggerContainerProjector (web render body)

/// The pure projection from the props + the bound reduce-motion preference to the view-ready model — the
/// surface's data adapter in the "preference → projection" sense the acceptance calls for: it takes the
/// props a page already holds plus the platform Reduce Motion flag (no fetch, no clock) and derives the
/// cascade. Unit tested across the reduced / full-motion split, the index-driven cascade delay, the hosted
/// child's per-phase opacity / offset, and the duration.
public enum StaggerContainerProjector {
    /// The per-child cascade step, in seconds — the web `staggerChildren: 0.06`.
    public static let staggerStepSeconds: Double = 0.06

    /// The vertical lift of a hosted child's `hidden` phase, in points — the web child `y: 15`.
    public static let childHiddenOffsetY: Double = 15

    /// The hosted child's entrance duration the web call site requests: `<StaggerItem>`'s
    /// `useMotionPreference(350)`.
    public static let childDefaultDurationMs = 350

    /// Resolves the whole cascade from the props + the bound reduce-motion preference — the native peer of
    /// the web container's variant + transition definition. The container reads only `reduce` from the hook
    /// (the web `const { reduce } = useMotionPreference()`); the duration governs the hosted child.
    public static func resolve(_ input: StaggerContainerInput, reduceMotion: Bool) -> StaggerContainerProjection {
        let preference = StaggerContainerMotionPreference.resolve(reduceMotion: reduceMotion)
        let childDuration = preference.reduce ? 0 : Double(input.childDurationMs) / 1000
        return StaggerContainerProjection(
            reduce: preference.reduce,
            staggerStepSeconds: preference.reduce ? 0 : input.stepSeconds,
            childDurationSeconds: childDuration,
            childHiddenOpacity: preference.reduce ? 1 : 0,
            childHiddenOffsetY: preference.reduce ? 0 : childHiddenOffsetY
        )
    }
}
