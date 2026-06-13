//
//  Spinner.Adapter.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  The Foundation-only core for the brand loading mark — the SwiftUI parity of
//  `components/feedback/Spinner.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the size scale (``SpinnerSize`` — the web `sizeMap`), the resolved motion preference
//  (``SpinnerMotionPreference`` — the native peer of the web `useMotionPreference()` hook), the props value
//  type (``SpinnerInput``), the view-ready ``SpinnerProjection``, the pure ``SpinnerProjector`` that maps
//  the props + the bound reduce-motion preference into the rendered dimension / stroke / glow / resting
//  fill, the bolt path geometry (``SpinnerBoltGeometry`` — the web SVG `d`), and the strike-draw schedule
//  (``SpinnerBoltKeyframes`` — the web `@keyframes boltDraw`). No SwiftUI and no `@Observable`, so every
//  rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<Spinner>` is THE loading indicator — a PURE presentational primitive. It
//  takes plain props (`size`, `label`, `className`), reads one display-boundary hook (`useMotionPreference`)
//  and draws a lightning bolt; there is no fetch, no React-Query cache, and no Promise, so it has NO
//  loading, error, stale, or offline branch (it IS the loading affordance other surfaces show — there is
//  nothing for it to fetch, fail, age, or lose connectivity to; inventing such chrome would fabricate states
//  the source does not have, and would be dishonest). So this surface reproduces only the source's REAL
//  branches — exactly as the sibling presentational primitives Accordion (0203), StaggerItem (0194), Delta
//  (0081), MetricCard (0095), and InlineCallout (0124) did. The real branches: the three sizes (`sm` / `md`
//  / `lg`), the optional caption label (web `{label && <span>}`), and the reduced-motion variant (a static,
//  fully-filled bolt with the same glow, web `fillOpacity={reduce ? 1 : 0}`) versus the animated strike
//  draw.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum SpinnerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Spinner"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<Spinner>` hardcodes one English literal (the `'Loading'` accessibility label fallback) and otherwise
/// renders a caller-supplied, already-localized `label`. Kept as a plain closure so the pure core has no
/// dependency on a bundle: the production app passes the P1/S10 facade, tests an identity resolver.
public typealias SpinnerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - SpinnerSize (web `sizeMap`)

/// The three size variants — the native peer of the web `sizeMap`. `dimension` is the box edge in points
/// (web `pixels`); `boltStrokeViewBox` is the stroke width expressed in the bolt's `0…200` view-box space
/// (web `stroke`), scaled to points by ``SpinnerProjector/strokeWidthPoints(size:)`` so the line keeps the
/// same visual weight at every size.
public enum SpinnerSize: String, Sendable, Equatable, CaseIterable {
    /// 24 pt — the inline size (web `sm`).
    case sm
    /// 48 pt — the default size (web `md`).
    case md
    /// 80 pt — the page-loader size (web `lg`).
    case lg

    /// The box edge in points (web `sizeMap[size].pixels`).
    public var dimension: CGFloat {
        switch self {
        case .sm: 24
        case .md: 48
        case .lg: 80
        }
    }

    /// The stroke width in the bolt's `0…200` view-box space (web `sizeMap[size].stroke`). Smaller marks
    /// use a heavier view-box stroke so the bolt stays legible once scaled down.
    public var boltStrokeViewBox: CGFloat {
        switch self {
        case .sm: 22
        case .md: 14
        case .lg: 10
        }
    }
}

// MARK: - SpinnerMotionPreference (web `useMotionPreference`)

/// The resolved motion preference — the native peer of the web `useMotionPreference(defaultMs)` return value
/// `{ reduce, durationMs }`. `reduce` is the user's Reduce Motion setting (web `useReducedMotion()`,
/// coalesced from its tri-state to `false`); `durationMs` is `0` when reduced and `defaultMs` otherwise. The
/// `<Spinner>` source destructures only `reduce` (its strike cadence is the CSS `boltDraw 2s` constant, not
/// the hook duration), but the whole `{ reduce, durationMs }` contract is modelled + tested here so the
/// surface mirrors the hook faithfully rather than a narrowed slice of it.
public struct SpinnerMotionPreference: Sendable, Equatable {
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
    /// `<Spinner>` gets by calling `useMotionPreference()` with no argument).
    public static let defaultDurationMs = 250

    /// The verbatim port of `useMotionPreference`: `reduce` is the (coalesced) Reduce Motion flag, and
    /// `durationMs` collapses to `0` when reduced, else the supplied `defaultMs`.
    public static func resolve(reduceMotion: Bool, defaultMs: Int = defaultDurationMs) -> SpinnerMotionPreference {
        SpinnerMotionPreference(reduce: reduceMotion, durationMs: reduceMotion ? 0 : defaultMs)
    }
}

// MARK: - SpinnerInput (web props, closure-free)

/// The component's props — the native peer of `SpinnerProps`. The web `className` styling hook has no
/// Tailwind peer (the host composes the native mark with standard SwiftUI modifiers), so the modelled props
/// are the `size` and the optional `label`. A value type so the view, the state-holder, and the pure
/// projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply.
public struct SpinnerInput: Sendable, Equatable {
    /// The size variant (web `size`, default `md`).
    public let size: SpinnerSize
    /// The caption + accessibility label (web `label`). When present + non-empty it renders under the bolt
    /// and names the surface; when absent the surface falls back to the localized `"Loading"` label.
    public let label: String?

    public init(size: SpinnerSize = .md, label: String? = nil) {
        self.size = size
        self.label = label
    }
}

// MARK: - SpinnerProjection (view-ready)

/// The resolved, view-ready loading mark — everything the SwiftUI body needs as a pure function of the props
/// + the bound reduce-motion preference (no derivation in the view). `dimension` / `strokeWidthPoints` are
/// the scaled box + line (web `sizeMap`); `showsLabelText` is the web `{label && <span>}`; `reduce` selects
/// the static-versus-animated bolt; `restingFillOpacity` is the web `fillOpacity={reduce ? 1 : 0}` (a solid
/// bolt under reduced motion, an unfilled outline as the animation's first frame otherwise).
public struct SpinnerProjection: Sendable, Equatable {
    /// The box edge in points (web `sizeMap[size].pixels`).
    public let dimension: CGFloat
    /// The stroke width in points (web `sizeMap[size].stroke`, scaled out of the `0…200` view box).
    public let strokeWidthPoints: CGFloat
    /// Whether the caption label renders under the bolt (web `{label && <span>}`).
    public let showsLabelText: Bool
    /// Whether reduced motion is in effect (web `reduce`) — selects the static, fully-filled bolt.
    public let reduce: Bool
    /// The bolt fill opacity at rest (web `fillOpacity={reduce ? 1 : 0}`).
    public let restingFillOpacity: Double

    public init(
        dimension: CGFloat,
        strokeWidthPoints: CGFloat,
        showsLabelText: Bool,
        reduce: Bool,
        restingFillOpacity: Double
    ) {
        self.dimension = dimension
        self.strokeWidthPoints = strokeWidthPoints
        self.showsLabelText = showsLabelText
        self.reduce = reduce
        self.restingFillOpacity = restingFillOpacity
    }
}

// MARK: - SpinnerProjector (web render body)

/// The pure projection from the props + the bound reduce-motion preference to the view-ready model — the
/// surface's data adapter in the "preference → projection" sense the acceptance calls for: it takes the
/// props a page already holds plus the platform Reduce Motion flag (no fetch, no clock) and derives the
/// rendered mark. Unit tested across the three sizes, the label presence, the reduced / full-motion split,
/// and the scaled stroke width.
public enum SpinnerProjector {
    /// The bolt path's design view box (web `viewBox="0 0 200 200"`).
    public static let viewBox: CGFloat = 200

    /// The inner glow blur radius in points (web `drop-shadow(0 0 4px var(--theme-primary))`).
    public static let glowPrimaryRadius: CGFloat = 4

    /// The outer glow blur radius in points (web `drop-shadow(0 0 10px var(--theme-accent))`).
    public static let glowAccentRadius: CGFloat = 10

    /// The strike-draw cycle length in seconds (web `animation: boltDraw 2s ease-in-out infinite`).
    public static let boltCycleSeconds: Double = 2

    /// Scales the view-box stroke into points for a size — `stroke * dimension / 200` — so the line keeps a
    /// constant visual weight as the mark shrinks (web renders the `0…200` path at the box size).
    public static func strokeWidthPoints(size: SpinnerSize) -> CGFloat {
        size.boltStrokeViewBox * size.dimension / viewBox
    }

    /// Whether the caption renders — the web `{label && <span>}`, treating an empty string as absent so the
    /// surface never shows a blank caption row.
    public static func showsLabelText(label: String?) -> Bool {
        guard let label, !label.isEmpty else { return false }
        return true
    }

    /// Resolves the whole mark from the props + the bound reduce-motion preference — the native peer of the
    /// web component's render decision.
    public static func resolve(_ input: SpinnerInput, reduceMotion: Bool) -> SpinnerProjection {
        SpinnerProjection(
            dimension: input.size.dimension,
            strokeWidthPoints: strokeWidthPoints(size: input.size),
            showsLabelText: showsLabelText(label: input.label),
            reduce: reduceMotion,
            restingFillOpacity: reduceMotion ? 1 : 0
        )
    }
}

// MARK: - SpinnerBoltGeometry (web SVG `d`)

/// The lightning-bolt outline — the native peer of the web path `M112 30 L62 108 h34 L78 170 l58-82 h-34 z`,
/// captured as its six absolute vertices in the `0…200` view-box space and as normalized `0…1` points the
/// SwiftUI ``SpinnerBoltShape`` scales into any rect. The outline is a single closed sub-path, so a stroke
/// `trim` traces the strike along it and a fill solidifies it — the two layers the `boltDraw` cycle drives.
public enum SpinnerBoltGeometry {
    /// The path's design view box (web `viewBox="0 0 200 200"`).
    public static let viewBox: CGFloat = 200

    /// The six absolute vertices of the closed bolt outline, in `0…200` view-box space (web SVG `d`).
    public static let points: [CGPoint] = [
        CGPoint(x: 112, y: 30),
        CGPoint(x: 62, y: 108),
        CGPoint(x: 96, y: 108),
        CGPoint(x: 78, y: 170),
        CGPoint(x: 136, y: 88),
        CGPoint(x: 102, y: 88)
    ]

    /// The same vertices normalized into `0…1`, ready to scale into a SwiftUI rect of any edge length.
    public static var normalizedPoints: [CGPoint] {
        points.map { CGPoint(x: $0.x / viewBox, y: $0.y / viewBox) }
    }
}

// MARK: - SpinnerBoltKeyframes (web `@keyframes boltDraw`)

/// One stop of the strike-draw cycle — the native peer of a single `@keyframes boltDraw` rule. The web
/// animates `stroke-dashoffset` (`100 → 0 → -100`), `fill-opacity`, and `opacity`; the dash offset maps onto
/// a SwiftUI stroke `trim`: offset `100` is undrawn (`trimTo = 0`), offset `0` is fully drawn (`trimTo = 1`),
/// and offset `-100` retreats the tail (`trimFrom = 1`). So each stop carries the trim window plus the fill
/// + overall opacity at its `fraction` of the cycle.
public struct SpinnerBoltKeyframeStop: Sendable, Equatable {
    /// The stop's position in the cycle, `0…1` (web keyframe percentage / 100).
    public let fraction: Double
    /// The leading edge of the drawn stroke window (web negative `stroke-dashoffset` retreat).
    public let trimFrom: Double
    /// The trailing edge of the drawn stroke window (web `stroke-dashoffset` draw-on).
    public let trimTo: Double
    /// The bolt fill opacity (web `fill-opacity`).
    public let fillOpacity: Double
    /// The overall mark opacity (web `opacity`).
    public let opacity: Double

    public init(fraction: Double, trimFrom: Double, trimTo: Double, fillOpacity: Double, opacity: Double) {
        self.fraction = fraction
        self.trimFrom = trimFrom
        self.trimTo = trimTo
        self.fillOpacity = fillOpacity
        self.opacity = opacity
    }
}

/// The full strike-draw schedule — the native peer of the web `@keyframes boltDraw`. Five stops trace the
/// brand mark: it strikes on (stroke draws `0 → 30%`), fills to solid (`30% → 55%`), holds (`55% → 80%`),
/// then fades and retreats (`80% → 100%`), looping every ``SpinnerProjector/boltCycleSeconds``. Kept as data
/// in the pure core so the schedule is unit-tested once and the view builds its `KeyframeTrack`s from it.
public enum SpinnerBoltKeyframes {
    /// The ordered keyframe stops (web `boltDraw` at `0% / 30% / 55% / 80% / 100%`).
    public static let stops: [SpinnerBoltKeyframeStop] = [
        SpinnerBoltKeyframeStop(fraction: 0.00, trimFrom: 0, trimTo: 0, fillOpacity: 0, opacity: 0.15),
        SpinnerBoltKeyframeStop(fraction: 0.30, trimFrom: 0, trimTo: 1, fillOpacity: 0, opacity: 1.00),
        SpinnerBoltKeyframeStop(fraction: 0.55, trimFrom: 0, trimTo: 1, fillOpacity: 1, opacity: 1.00),
        SpinnerBoltKeyframeStop(fraction: 0.80, trimFrom: 0, trimTo: 1, fillOpacity: 1, opacity: 0.90),
        SpinnerBoltKeyframeStop(fraction: 1.00, trimFrom: 1, trimTo: 1, fillOpacity: 0, opacity: 0.00)
    ]

    /// The first stop — the cycle's initial frame and the `KeyframeAnimator` seed.
    public static var initialStop: SpinnerBoltKeyframeStop {
        stops[0]
    }

    /// The per-segment durations in seconds for a given cycle length — the gap between each stop's
    /// `fraction` scaled by `cycle`, so four segments sum to the full cycle. The view feeds these straight
    /// into its `KeyframeTrack`s.
    public static func segmentDurations(cycle: Double = SpinnerProjector.boltCycleSeconds) -> [Double] {
        zip(stops.dropFirst(), stops).map { next, previous in
            (next.fraction - previous.fraction) * cycle
        }
    }
}
