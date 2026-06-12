//
//  RangeSlider.Adapter.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  The Foundation-only core for the dual-thumb range slider — the SwiftUI parity of
//  `components/ui/RangeSlider.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the props value type (``RangeSliderInput``), the view-ready ``RangeSliderProjection``, and
//  the pure ``RangeSliderProjector`` that reproduces the web math 1:1: the per-thumb fill percent (web
//  `range > 0 ? clamp(((v-min)/range)*100,0,100) : fallback`), the thumb-swap rules (web `handleLowChange`
//  / `handleHighChange`), the step snap + clamp the native `<input type="range">` does for free, the
//  drag-fraction → value mapping, and the default `String(n)` readout. No SwiftUI and no `@Observable`, so
//  every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<RangeSlider>` is a PURE presentational PRIMITIVE — a controlled
//  component whose `value` + `onChange` are plain props (there is no fetch, no React-Query cache, no
//  Promise). It therefore has NO loading / error / stale / offline branch (there is nothing to fetch,
//  fail, age, or lose connectivity to). Inventing such chrome would fabricate states the source does not
//  have, so this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  primitives Accordion (0203), Delta (0081), MetricCard (0095), InlineCallout (0124), ActiveFilterChips
//  (0147), and StaggerItem (0194) did. The REAL branches: enabled / disabled, label row shown / hidden,
//  the two-direction thumb-swap, the fill span, the colliding-thumb z-order (web `lowPct > 50`), the
//  default vs custom value format, the default vs overridden thumb a11y names, and the native
//  never-a-blank-box affordance for a degenerate range (`max <= min`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum RangeSliderSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RangeSlider"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<RangeSlider>` resolves two keys (`slider.thumbMin` / `slider.thumbMax`); the native peer adds a small
/// set of a11y additions. Kept as a plain closure so the pure core has no dependency on a bundle: the
/// production app passes the P1/S10 facade, tests an identity resolver.
public typealias RangeSliderResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - RangeSliderInput (web props, closure-free)

/// The component's props — the native peer of `RangeSliderProps`, minus the `onChange` and `formatValue`
/// closures (held by the view + the state-holder so the value type stays closure-free + `Equatable`). The
/// `[low, high]` tuple is normalized on construction so `low <= high` (web "Always normalised so low <=
/// high"). A value type so the view, the state-holder, and the pure projection agree on one shape, and so a
/// SwiftUI `.onChange` can detect a prop change cheaply when the page rebinds a new value.
public struct RangeSliderInput: Sendable, Equatable {
    /// The lower selected value (web `value[0]`). Always `<= high`.
    public let low: Double
    /// The upper selected value (web `value[1]`). Always `>= low`.
    public let high: Double
    /// Inclusive lower bound (web `min`).
    public let min: Double
    /// Inclusive upper bound (web `max`).
    public let max: Double
    /// Step increment for keyboard / VoiceOver adjustment and drag snapping (web `step`, default 1).
    public let step: Double
    /// The visible label + accessible name for the range (web `label`).
    public let label: String
    /// Whether the label / value row renders (web `showLabel`, default true).
    public let showLabel: Bool
    /// Whether both thumbs are non-interactive (web `disabled`).
    public let isDisabled: Bool
    /// Optional override for the low thumb's accessible name (web `minThumbLabel`).
    public let minThumbLabel: String?
    /// Optional override for the high thumb's accessible name (web `maxThumbLabel`).
    public let maxThumbLabel: String?

    public init(
        low: Double,
        high: Double,
        min: Double,
        max: Double,
        step: Double = RangeSliderProjector.defaultStep,
        label: String,
        showLabel: Bool = true,
        isDisabled: Bool = false,
        minThumbLabel: String? = nil,
        maxThumbLabel: String? = nil
    ) {
        // Web invariant: value is always normalised so low <= high; enforce it defensively.
        self.low = Swift.min(low, high)
        self.high = Swift.max(low, high)
        self.min = min
        self.max = max
        self.step = step
        self.label = label
        self.showLabel = showLabel
        self.isDisabled = isDisabled
        self.minThumbLabel = minThumbLabel
        self.maxThumbLabel = maxThumbLabel
    }

    /// Returns a copy with a new `[low, high]` value, re-normalized — used by the state-holder to apply a
    /// thumb change optimistically without restating every field.
    public func updatingValue(low: Double, high: Double) -> RangeSliderInput {
        RangeSliderInput(
            low: low,
            high: high,
            min: min,
            max: max,
            step: step,
            label: label,
            showLabel: showLabel,
            isDisabled: isDisabled,
            minThumbLabel: minThumbLabel,
            maxThumbLabel: maxThumbLabel
        )
    }
}

// MARK: - RangeSliderProjection (view-ready)

/// The resolved, view-ready model — everything the SwiftUI body needs as a pure function of the props (no
/// derivation in the view). `lowPercent` / `highPercent` are the web `lowPct` / `highPct`; `fillStart…` /
/// `fillEnd…` are the web `Math.min/Math.max(lowPct, highPct)` fill span; `lowOnTop` is the web `lowPct >
/// 50` z-order; `hasRange` / `isAdjustable` gate the native degenerate-range affordance.
public struct RangeSliderProjection: Sendable, Equatable {
    /// The resolved lower value (web `low`).
    public let low: Double
    /// The resolved upper value (web `high`).
    public let high: Double
    /// The low thumb position as a 0…100 percent (web `lowPct`).
    public let lowPercent: Double
    /// The high thumb position as a 0…100 percent (web `highPct`).
    public let highPercent: Double
    /// The fill's left edge percent — `min(lowPercent, highPercent)` (web fill `left`).
    public let fillStartPercent: Double
    /// The fill's right edge percent — `max(lowPercent, highPercent)` (web fill `right`).
    public let fillEndPercent: Double
    /// Whether the low thumb renders above the high thumb (web `lowPct > 50`).
    public let lowOnTop: Bool
    /// Whether the label / value row renders (web `showLabel`).
    public let showsLabelRow: Bool
    /// Whether the thumbs are disabled (web `disabled`).
    public let isDisabled: Bool
    /// Whether there is a usable span to slide over (`max > min`). When false the surface shows the native
    /// degenerate-range affordance instead of an unusable track.
    public let hasRange: Bool
    /// Whether the user can move a thumb right now (`hasRange && !isDisabled`).
    public let isAdjustable: Bool

    public init(
        low: Double,
        high: Double,
        lowPercent: Double,
        highPercent: Double,
        fillStartPercent: Double,
        fillEndPercent: Double,
        lowOnTop: Bool,
        showsLabelRow: Bool,
        isDisabled: Bool,
        hasRange: Bool,
        isAdjustable: Bool
    ) {
        self.low = low
        self.high = high
        self.lowPercent = lowPercent
        self.highPercent = highPercent
        self.fillStartPercent = fillStartPercent
        self.fillEndPercent = fillEndPercent
        self.lowOnTop = lowOnTop
        self.showsLabelRow = showsLabelRow
        self.isDisabled = isDisabled
        self.hasRange = hasRange
        self.isAdjustable = isAdjustable
    }
}

// MARK: - RangeSliderProjector (web render body)

/// The pure projection + interaction math — the surface's data adapter in the "state → projection" sense
/// the acceptance calls for: it takes the props a page already holds (no fetch, no clock) and derives the
/// rendered slider plus the values each thumb change / drag / step produces. Unit tested across the percent
/// math, the two-direction thumb-swap, the step snap, the drag-fraction mapping, the default format, and
/// the z-order threshold.
public enum RangeSliderProjector {
    /// The web default `step` (1).
    public static let defaultStep: Double = 1
    /// The web z-order threshold — the low thumb sits on top once it passes the midpoint (`lowPct > 50`).
    public static let lowOnTopThresholdPercent: Double = 50

    /// A value's position as a 0…100 percent of the range, clamped, with `emptyFallback` returned when the
    /// range is non-positive — the verbatim port of the web `range > 0 ? Math.max(0, Math.min(100,
    /// ((v-min)/range)*100)) : emptyFallback`.
    public static func percent(value: Double, min: Double, max: Double, emptyFallback: Double) -> Double {
        let range = max - min
        guard range > 0 else { return emptyFallback }
        let pct = ((value - min) / range) * 100
        return Swift.max(0, Swift.min(100, pct))
    }

    /// The low thumb percent (web `lowPct`, fallback `0` for an empty range).
    public static func lowPercent(low: Double, min: Double, max: Double) -> Double {
        percent(value: low, min: min, max: max, emptyFallback: 0)
    }

    /// The high thumb percent (web `highPct`, fallback `100` for an empty range).
    public static func highPercent(high: Double, min: Double, max: Double) -> Double {
        percent(value: high, min: min, max: max, emptyFallback: 100)
    }

    /// Whether the low thumb renders on top — the web `lowOnTop = lowPct > 50`.
    public static func lowOnTop(lowPercent: Double) -> Bool {
        lowPercent > lowOnTopThresholdPercent
    }

    /// Whether the slider has a usable span (`max > min`).
    public static func hasRange(min: Double, max: Double) -> Bool {
        max > min
    }

    /// The new sorted `[low, high]` when the LOW thumb moves to `next` — the verbatim port of the web
    /// `handleLowChange`: `next > high ? [high, next] : [next, high]` (dragging the low thumb past the high
    /// thumb swaps them).
    public static func applyLowChange(next: Double, high: Double) -> (low: Double, high: Double) {
        next > high ? (low: high, high: next) : (low: next, high: high)
    }

    /// The new sorted `[low, high]` when the HIGH thumb moves to `next` — the verbatim port of the web
    /// `handleHighChange`: `next < low ? [next, low] : [low, next]`.
    public static func applyHighChange(next: Double, low: Double) -> (low: Double, high: Double) {
        next < low ? (low: next, high: low) : (low: low, high: next)
    }

    /// Clamps a raw value into `[min, max]` then snaps it to the nearest `step` from `min` — the rounding a
    /// native `<input type="range" step>` applies for free. A non-positive step skips snapping.
    public static func snapped(value: Double, min: Double, max: Double, step: Double) -> Double {
        let clamped = Swift.max(min, Swift.min(max, value))
        guard step > 0 else { return clamped }
        let steps = ((clamped - min) / step).rounded()
        return Swift.max(min, Swift.min(max, min + steps * step))
    }

    /// Maps a 0…1 drag fraction across the track to a snapped value in `[min, max]`. Non-finite → `min`.
    public static func value(fromFraction fraction: Double, min: Double, max: Double, step: Double) -> Double {
        let clampedFraction = Swift.max(0, Swift.min(1, fraction.isFinite ? fraction : 0))
        return snapped(value: min + clampedFraction * (max - min), min: min, max: max, step: step)
    }

    /// The default value readout — the parity of the web `String(n)`: an integral value shows with no
    /// decimal point ("3"), a fractional value keeps its decimals ("3.5").
    public static func defaultFormat(_ value: Double) -> String {
        guard value.isFinite else { return "\(value)" }
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    /// Resolves the whole slider from the props — the native peer of the web component's render decision.
    public static func resolve(input: RangeSliderInput) -> RangeSliderProjection {
        let lowPct = lowPercent(low: input.low, min: input.min, max: input.max)
        let highPct = highPercent(high: input.high, min: input.min, max: input.max)
        let usable = hasRange(min: input.min, max: input.max)
        return RangeSliderProjection(
            low: input.low,
            high: input.high,
            lowPercent: lowPct,
            highPercent: highPct,
            fillStartPercent: Swift.min(lowPct, highPct),
            fillEndPercent: Swift.max(lowPct, highPct),
            lowOnTop: lowOnTop(lowPercent: lowPct),
            showsLabelRow: input.showLabel,
            isDisabled: input.isDisabled,
            hasRange: usable,
            isAdjustable: usable && !input.isDisabled
        )
    }
}
