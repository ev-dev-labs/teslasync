//
//  CarAnimation.Timeline.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The Foundation-only motion schedule + static style constants for the four marks — the native peers of the
//  web `transition` props (the per-element delays / durations and the looping head/tail-light + bolt pulse
//  `@keyframes`) and the static SVG `fill-opacity` / `stroke` values. Kept as pure data so the cadence is
//  unit-tested once and the SwiftUI views build their animations + strokes from it (the same disposition as
//  `SpinnerBoltKeyframes`). Every value is the exact web constant. No SwiftUI here.
//

import CoreGraphics
import Foundation

// MARK: - CarAnimationTiming (web `transition` delays / durations)

/// The per-element entry + loop cadence — the native peer of each web `transition={{ delay, duration }}`.
/// The Tesla silhouette plays a staggered entry (the body draws in, the windows fade, the wheels pop, the
/// shadow stretches), then the lights pulse forever; the bolt, battery, and wheel marks each have their own
/// entry + loop. All values are seconds, verbatim from the source.
public enum CarAnimationTiming {
    /// Body draw-in (web `pathLength 0→1`, `duration: 1.5, ease: easeInOut`).
    public static let bodyDraw: Double = 1.5
    /// Windshield fade (web `delay: 0.8, duration: 0.6`).
    public static let windshieldDelay: Double = 0.8
    public static let windshieldDuration: Double = 0.6
    /// Rear-window fade (web `delay: 1, duration: 0.5`).
    public static let rearWindowDelay: Double = 1.0
    public static let rearWindowDuration: Double = 0.5
    /// Wheel pop-in spring delays (web front tire `0.3`, rear tire `0.4`, front hub `0.5`, rear hub `0.6`).
    public static let frontTireDelay: Double = 0.3
    public static let rearTireDelay: Double = 0.4
    public static let frontHubDelay: Double = 0.5
    public static let rearHubDelay: Double = 0.6
    /// Headlight pulse (web `delay: 1.2, duration: 2, repeat: Infinity`).
    public static let headlightDelay: Double = 1.2
    /// Taillight pulse (web `delay: 1.4, duration: 2, repeat: Infinity`).
    public static let taillightDelay: Double = 1.4
    /// Ground shadow stretch (web `delay: 0.5, duration: 0.8`).
    public static let shadowDelay: Double = 0.5
    public static let shadowDuration: Double = 0.8
    /// Charging-bolt entry (web `duration: 0.5`) — opacity + a `-4` view-box rise.
    public static let boltEntryDuration: Double = 0.5
    public static let boltEntryRise: CGFloat = 4
    /// Battery container fade (web `duration: 0.4`) + fill grow (web `delay: 0.3, duration: 1.2`).
    public static let batteryFadeDuration: Double = 0.4
    public static let batteryFillDelay: Double = 0.3
    public static let batteryFillDuration: Double = 1.2
    /// Wheel-loader spin (web `duration: 2, repeat: Infinity, ease: linear`).
    public static let wheelSpinCycle: Double = 2.0
    /// The wheel pop spring (web `type: 'spring'`) — a SwiftUI-native equivalent of the framer spring.
    public static let wheelPopResponse: Double = 0.45
    public static let wheelPopDamping: Double = 0.6
}

// MARK: - CarPulse (web looping opacity `@keyframes`)

/// A looping opacity pulse — the native peer of a web `animate={{ opacity: [...] }}` with `repeat: Infinity`.
/// `stops` are the keyframe opacities spread evenly across `cycle` seconds (framer-motion's default even
/// distribution), looping back to the first stop. `resting` is the opacity rendered when Reduce Motion is on
/// (web's reduced branch renders the element at its steady value with no loop).
public struct CarPulse: Sendable, Equatable {
    public let stops: [Double]
    public let cycle: Double
    public let resting: Double

    public init(stops: [Double], cycle: Double, resting: Double) {
        self.stops = stops
        self.cycle = cycle
        self.resting = resting
    }

    /// The per-segment duration — `cycle / (stops.count - 1)` (the gaps between the evenly spread stops).
    public var segmentDuration: Double {
        let segments = max(stops.count - 1, 1)
        return cycle / Double(segments)
    }

    /// The headlight glow (web `opacity: [0, 0.8, 0.4, 0.8]`, `duration: 2`; reduced `opacity: 0.8`).
    public static let headlight = CarPulse(stops: [0, 0.8, 0.4, 0.8], cycle: 2, resting: 0.8)

    /// The taillight (web `opacity: [0, 0.7, 0.3, 0.7]`, `duration: 2`; reduced `opacity: 0.7`).
    public static let taillight = CarPulse(stops: [0, 0.7, 0.3, 0.7], cycle: 2, resting: 0.7)

    /// The charging-bolt fill (web `fillOpacity: [0.1, 0.3, 0.1]`, `duration: 1.5`; reduced `0.2`).
    public static let chargingBolt = CarPulse(stops: [0.1, 0.3, 0.1], cycle: 1.5, resting: 0.2)
}

// MARK: - CarStyle (web static `fill-opacity` / `stroke` values)

/// The static visual constants — the native peers of the web `fillOpacity`, `strokeOpacity`, and `stroke`
/// (line-width) attributes, in view-box units (the views scale line widths to points). Tokenized colors live
/// in the views (P1/S9); only the source's numeric opacities + widths live here.
public enum CarStyle {
    /// Tesla body (web fill `--surface-2`, stroke `--theme-primary` width 1.5).
    public static let bodyStrokeWidth: CGFloat = 1.5
    // Windshield (web fill `--theme-primary` 0.15, stroke `--theme-primary` 0.8 strokeOpacity 0.5).
    public static let windshieldFillOpacity: Double = 0.15
    public static let windshieldStrokeOpacity: Double = 0.5
    public static let windshieldStrokeWidth: CGFloat = 0.8
    // Rear window (web fill `--theme-primary` 0.1, stroke `--theme-primary` 0.6 strokeOpacity 0.3).
    public static let rearWindowFillOpacity: Double = 0.1
    public static let rearWindowStrokeOpacity: Double = 0.3
    public static let rearWindowStrokeWidth: CGFloat = 0.6
    // Wheels (web tire fill `--surface-3` stroke `--text-muted` 2; hub fill `--surface-1` stroke 1).
    public static let tireStrokeWidth: CGFloat = 2
    public static let hubStrokeWidth: CGFloat = 1
    /// Ground shadow (web fill `--text-muted` 0.15).
    public static let shadowFillOpacity: Double = 0.15
    /// Charging bolt (web stroke `--theme-primary` 1.5, round cap/join).
    public static let boltStrokeWidth: CGFloat = 1.5
    // Battery (web outline stroke `--text-muted` 1.5; cap fill `--text-muted` 0.4).
    public static let batteryOutlineStrokeWidth: CGFloat = 1.5
    public static let batteryCapFillOpacity: Double = 0.4
    // Wheel loader (web tire stroke `--text-muted` 1.5; hub stroke 1; spoke stroke 1.5 round cap).
    public static let wheelTireStrokeWidth: CGFloat = 1.5
    public static let wheelHubStrokeWidth: CGFloat = 1
    public static let spokeStrokeWidth: CGFloat = 1.5
}
