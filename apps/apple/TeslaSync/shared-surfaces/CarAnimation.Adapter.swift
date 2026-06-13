//
//  CarAnimation.Adapter.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The Foundation/CoreGraphics-only core for the brand motion marks — the SwiftUI parity of
//  `components/motion/CarAnimation.tsx`. The web module exports FOUR sibling presentational marks, all
//  reproduced here: the animated Tesla silhouette (``CarAnimation``), the charging bolt (``ChargingBolt``),
//  the battery fill gauge (``BatteryFillAnimation``), and the spinning wheel loader (``WheelSpin``). This
//  file owns the surface identity (the diagnostics slug + the per-mark identity), the resolved motion
//  preference (``CarAnimationMotionPreference`` — the native peer of the web `useMotionPreference()` hook),
//  the props value types, the view-ready projections, and the pure projectors that map each mark's props +
//  the bound reduce-motion preference into the rendered dimension / scale / derived values. No SwiftUI and
//  no `@Observable`, so every rule is unit-testable in isolation. The path + primitive geometry lives in the
//  sibling `CarAnimation.Geometry.swift`.
//
//  Faithful-parity note: the web `CarAnimation` module is a set of PURE presentational primitives. Each mark
//  takes plain props (`size`, `level`, `className`) and reads one display-boundary hook
//  (`useMotionPreference`) to draw an SVG; there is no fetch, no React-Query cache, and no Promise, so the
//  marks have NO loading, error, stale, or offline branch (they ARE the loading / hero affordances other
//  surfaces show — there is nothing for them to fetch, fail, age, or lose connectivity to; inventing such
//  chrome would fabricate states the source does not have, and would be dishonest). So this surface
//  reproduces only the source's REAL branches — exactly as the sibling presentational primitives Spinner
//  (0140), Accordion (0203), StaggerItem (0194), Delta (0081), and MetricCard (0095) did. The real branches:
//  the four marks, each with its size / level props and its reduced-motion variant (the final resting frame
//  with no entry draw, scale-in, or looping head/tail-light / bolt / wheel motion) versus the animated form.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum CarAnimationSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "CarAnimation"
}

// MARK: - CarAnimationMark (the four web exports)

/// The four marks the web module exports — the native peer of its four exported components. Each mark
/// resolves its own accessibility identity: the silhouette, bolt, and wheel carry a localized `role="img"`
/// label (web `aria-label`), while the battery gauge is decorative (web renders it with no `role`/`aria`).
public enum CarAnimationMark: String, Sendable, Equatable, CaseIterable {
    /// The animated Tesla silhouette (web `CarAnimation`, `aria-label` `carAnimation.tesla`).
    case tesla
    /// The charging bolt glyph (web `ChargingBolt`, `aria-label` `carAnimation.charging`).
    case chargingBolt
    /// The battery fill gauge (web `BatteryFillAnimation`, no `role`/`aria` — decorative).
    case batteryFill
    /// The spinning wheel loader (web `WheelSpin`, `aria-label` `carAnimation.loading`).
    case wheelSpin

    /// Whether the mark carries a VoiceOver label (web `role="img"` + `aria-label`). The battery gauge has
    /// none in the source, so it is decorative.
    public var isLabeled: Bool {
        self != .batteryFill
    }
}

// MARK: - CarAnimationMotionPreference (web `useMotionPreference`)

/// The resolved motion preference — the native peer of the web `useMotionPreference(defaultMs)` return value
/// `{ reduce, durationMs }`. `reduce` is the user's Reduce Motion setting (web `useReducedMotion()`,
/// coalesced from its tri-state to `false`); `durationMs` is `0` when reduced and `defaultMs` otherwise. The
/// marks destructure only `reduce` (their cadences are the per-element transition constants, not the hook
/// duration), but the whole `{ reduce, durationMs }` contract is modelled + tested here so the surface
/// mirrors the hook faithfully rather than a narrowed slice of it.
public struct CarAnimationMotionPreference: Sendable, Equatable {
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

    /// The default duration when motion is allowed, mirroring the web hook's `defaultMs = 250` (the value
    /// the marks get by calling `useMotionPreference()` with no argument).
    public static let defaultDurationMs = 250

    /// The verbatim port of `useMotionPreference`: `reduce` is the (coalesced) Reduce Motion flag, and
    /// `durationMs` collapses to `0` when reduced, else the supplied `defaultMs`.
    public static func resolve(
        reduceMotion: Bool,
        defaultMs: Int = defaultDurationMs
    ) -> CarAnimationMotionPreference {
        CarAnimationMotionPreference(reduce: reduceMotion, durationMs: reduceMotion ? 0 : defaultMs)
    }
}

// MARK: - Inputs (web props, closure-free)

/// The Tesla silhouette props — the native peer of `CarAnimation`'s `{ size, className }`. The web
/// `className` styling hook has no Tailwind peer (the host composes the native mark with standard SwiftUI
/// modifiers), so the modelled prop is the `size` (web default `120`).
public struct CarAnimationInput: Sendable, Equatable {
    /// The mark width in points (web `size`, default `120`); the height is `size * 0.4` (web `h = size*0.4`).
    public let size: CGFloat

    public init(size: CGFloat = 120) {
        self.size = size
    }
}

/// The charging-bolt props — the native peer of `ChargingBolt`'s `{ size, className }` (web default `32`).
public struct ChargingBoltInput: Sendable, Equatable {
    public let size: CGFloat

    public init(size: CGFloat = 32) {
        self.size = size
    }
}

/// The battery-gauge props — the native peer of `BatteryFillAnimation`'s `{ level, size, className }` (web
/// defaults `level = 80`, `size = 48`). `level` is a battery percentage `0…100`.
public struct BatteryFillInput: Sendable, Equatable {
    public let level: Double
    public let size: CGFloat

    public init(level: Double = 80, size: CGFloat = 48) {
        self.level = level
        self.size = size
    }
}

/// The wheel-loader props — the native peer of `WheelSpin`'s `{ size, className }` (web default `24`).
public struct WheelSpinInput: Sendable, Equatable {
    public let size: CGFloat

    public init(size: CGFloat = 24) {
        self.size = size
    }
}

// MARK: - BatteryLevelColorKind (web `level >= 60 ? GOOD : level >= 30 ? WARN : BAD`)

/// The semantic battery-fill color band — the native peer of the web ternary
/// `level >= 60 ? COLOR.GOOD : level >= 30 ? COLOR.WARN : COLOR.BAD`. The view maps each case to the brand
/// status token (`statusSuccess` / `statusWarning` / `statusDanger`), which carries the same hex as the web
/// `COLOR` constants (`#10b981` / `#f59e0b` / `#ef4444`) so "good = green" stays green in every theme.
public enum BatteryLevelColorKind: String, Sendable, Equatable {
    case good
    case warning
    case danger

    /// The web band thresholds: `>= 60` good, `>= 30` warning, else danger.
    public static func resolve(level: Double) -> BatteryLevelColorKind {
        if level >= 60 { return .good }
        if level >= 30 { return .warning }
        return .danger
    }
}

// MARK: - Projections (view-ready)

/// The resolved Tesla silhouette — everything the SwiftUI body needs as a pure function of the props + the
/// bound reduce-motion preference. `width` / `height` are the rendered box (web `w` / `h = size*0.4`);
/// `scale` maps the `0…240` view-box into points (web renders the path at the box size); `reduce` selects
/// the resting frame versus the entry + looping animation.
public struct CarAnimationProjection: Sendable, Equatable {
    public let width: CGFloat
    public let height: CGFloat
    public let scale: CGFloat
    public let reduce: Bool

    public init(width: CGFloat, height: CGFloat, scale: CGFloat, reduce: Bool) {
        self.width = width
        self.height = height
        self.scale = scale
        self.reduce = reduce
    }
}

/// The resolved charging bolt — the square box (web `size`), the `0…24` view-box scale, and the reduce flag.
public struct ChargingBoltProjection: Sendable, Equatable {
    public let dimension: CGFloat
    public let scale: CGFloat
    public let reduce: Bool

    public init(dimension: CGFloat, scale: CGFloat, reduce: Bool) {
        self.dimension = dimension
        self.scale = scale
        self.reduce = reduce
    }
}

/// The resolved battery gauge. `width` / `height = size*0.5` are the rendered box; `scale` maps the `0…48`
/// view box into points; `fillWidthViewBox` is the filled width in view-box units (web
/// `fillWidth * 38 / (size*0.6 - 4)`, which reduces to `38 * clampedLevel / 100`); `colorKind` is the
/// semantic band; `clampedLevel` is `min(max(level, 0), 100)`.
public struct BatteryFillProjection: Sendable, Equatable {
    public let width: CGFloat
    public let height: CGFloat
    public let scale: CGFloat
    public let fillWidthViewBox: CGFloat
    public let colorKind: BatteryLevelColorKind
    public let clampedLevel: Double
    public let reduce: Bool

    public init(
        width: CGFloat,
        height: CGFloat,
        scale: CGFloat,
        fillWidthViewBox: CGFloat,
        colorKind: BatteryLevelColorKind,
        clampedLevel: Double,
        reduce: Bool
    ) {
        self.width = width
        self.height = height
        self.scale = scale
        self.fillWidthViewBox = fillWidthViewBox
        self.colorKind = colorKind
        self.clampedLevel = clampedLevel
        self.reduce = reduce
    }
}

/// The resolved wheel loader — the square box (web `size`), the `0…24` view-box scale, and the reduce flag.
public struct WheelSpinProjection: Sendable, Equatable {
    public let dimension: CGFloat
    public let scale: CGFloat
    public let reduce: Bool

    public init(dimension: CGFloat, scale: CGFloat, reduce: Bool) {
        self.dimension = dimension
        self.scale = scale
        self.reduce = reduce
    }
}

// MARK: - Projectors (web render bodies)

/// The pure projections from each mark's props + the bound reduce-motion preference to its view-ready model —
/// the surface's data adapter in the "preference → projection" sense the acceptance calls for: it takes the
/// props a page already holds plus the platform Reduce Motion flag (no fetch, no clock) and derives the
/// rendered geometry. Unit tested across each mark's sizes, the battery band + clamp, and the reduced /
/// full-motion split.
public enum CarAnimationProjector {
    /// The Tesla silhouette view box (web `viewBox="0 0 240 96"`).
    public static let carViewBox = CGSize(width: 240, height: 96)
    /// The charging-bolt + wheel view box (web `viewBox="0 0 24 24"`).
    public static let squareViewBox = CGSize(width: 24, height: 24)
    /// The battery view box (web `viewBox="0 0 48 24"`).
    public static let batteryViewBox = CGSize(width: 48, height: 24)
    /// The battery outline's inner drawable width in view-box units (web rect `width="38"`).
    public static let batteryInnerWidth: CGFloat = 38

    /// Resolves the Tesla silhouette — `height = size * 0.4` (web `h`), `scale = size / 240`.
    public static func resolveCar(_ input: CarAnimationInput, reduceMotion: Bool) -> CarAnimationProjection {
        CarAnimationProjection(
            width: input.size,
            height: input.size * 0.4,
            scale: input.size / carViewBox.width,
            reduce: reduceMotion
        )
    }

    /// Resolves the charging bolt — a square box, `scale = size / 24`.
    public static func resolveBolt(_ input: ChargingBoltInput, reduceMotion: Bool) -> ChargingBoltProjection {
        ChargingBoltProjection(
            dimension: input.size,
            scale: input.size / squareViewBox.width,
            reduce: reduceMotion
        )
    }

    /// Resolves the battery gauge — `height = size * 0.5` (web `size * 0.5`), `scale = size / 48`, the clamped
    /// level, the semantic band, and the view-box fill width (`38 * clampedLevel / 100`).
    public static func resolveBattery(_ input: BatteryFillInput, reduceMotion: Bool) -> BatteryFillProjection {
        let clamped = min(max(input.level, 0), 100)
        return BatteryFillProjection(
            width: input.size,
            height: input.size * 0.5,
            scale: input.size / batteryViewBox.width,
            fillWidthViewBox: batteryInnerWidth * CGFloat(clamped) / 100,
            colorKind: BatteryLevelColorKind.resolve(level: input.level),
            clampedLevel: clamped,
            reduce: reduceMotion
        )
    }

    /// Resolves the wheel loader — a square box, `scale = size / 24`.
    public static func resolveWheel(_ input: WheelSpinInput, reduceMotion: Bool) -> WheelSpinProjection {
        WheelSpinProjection(
            dimension: input.size,
            scale: input.size / squareViewBox.width,
            reduce: reduceMotion
        )
    }
}
