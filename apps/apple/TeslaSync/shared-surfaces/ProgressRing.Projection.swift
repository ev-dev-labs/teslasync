//
//  ProgressRing.Projection.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  The pure projection from the input snapshot to the on-screen geometry — the native port of the web
//  ring math:
//
//      const radius = (size - strokeWidth) / 2;
//      const center = size / 2;
//      const circumference = 2 * Math.PI * radius;
//      const clamped = Math.max(0, Math.min(value, max));
//      const offset = circumference - (clamped / max) * circumference;
//      const hasCenter = centerLabel != null || centerSubLabel != null;
//      const mainSize = Math.max(10, Math.round(size * 0.32));
//      const subSize = Math.max(8, Math.round(size * 0.18));
//
//  The view is a pure function of these values; every branch is unit tested. Keeping the geometry here
//  (rather than in the view) lets the resolved ring at any input be asserted deterministically, which
//  is how the per-state (empty / partial / full) coverage is expressed without a pixel-snapshot harness.
//  The native peer additionally guards the web's un-guarded division: a non-finite or non-positive
//  `max`, `size`, or `strokeWidth` resolves to a stable zero-fill / default-dimension ring rather than
//  the `NaN` the web expressions would propagate, so the surface is never a broken or blank box.
//

import Foundation

// MARK: - Resolved view-state (web computed geometry)

/// The resolved, view-ready ring geometry — the fully computed values the gauge paints. `fillFraction`
/// (0...1) drives the native `.trim`; `offset` is retained as the direct parity of the web
/// `strokeDashoffset`; `percent` (0...100) feeds the accessibility value; `mainFontSize` / `subFontSize`
/// are the proportional centered-text sizes; `hasCenter` gates the centered overlay.
public struct ProgressRingResolved: Sendable, Equatable {
    public let size: Double
    public let strokeWidth: Double
    public let radius: Double
    public let center: Double
    public let circumference: Double
    public let clamped: Double
    public let fillFraction: Double
    public let offset: Double
    public let percent: Double
    public let hasCenter: Bool
    public let mainFontSize: Double
    public let subFontSize: Double

    public init(
        size: Double,
        strokeWidth: Double,
        radius: Double,
        center: Double,
        circumference: Double,
        clamped: Double,
        fillFraction: Double,
        offset: Double,
        percent: Double,
        hasCenter: Bool,
        mainFontSize: Double,
        subFontSize: Double
    ) {
        self.size = size
        self.strokeWidth = strokeWidth
        self.radius = radius
        self.center = center
        self.circumference = circumference
        self.clamped = clamped
        self.fillFraction = fillFraction
        self.offset = offset
        self.percent = percent
        self.hasCenter = hasCenter
        self.mainFontSize = mainFontSize
        self.subFontSize = subFontSize
    }
}

// MARK: - Projection (geometry + clamping + font scaling)

/// Pure projection: the ring radius / circumference, the clamped value, the fill fraction and its
/// `strokeDashoffset` peer, the fill percentage, and the proportional centered-text sizes. No SwiftUI.
public enum ProgressRingProjection {
    /// A finite, positive dimension or the supplied fallback — the guard the web omits, so a degenerate
    /// `size` / `strokeWidth` cannot produce a negative radius or a `NaN`.
    static func dimension(_ value: Double, fallback: Double) -> Double {
        (value.isFinite && value > 0) ? value : fallback
    }

    /// Web `radius = (size - strokeWidth) / 2`, floored at zero so an over-thick stroke cannot invert
    /// the ring.
    public static func radius(size: Double, strokeWidth: Double) -> Double {
        Swift.max(0, (size - strokeWidth) / 2)
    }

    /// Web `circumference = 2 * Math.PI * radius`.
    public static func circumference(radius: Double) -> Double {
        2 * .pi * radius
    }

    /// Web `clamped = Math.max(0, Math.min(value, max))`, with a non-finite `value` treated as zero and
    /// a non-positive / non-finite `max` collapsing the upper bound to zero.
    public static func clamp(value: Double, maxValue: Double) -> Double {
        let safeValue = value.isFinite ? value : 0
        let upper = (maxValue.isFinite && maxValue > 0) ? maxValue : 0
        return Swift.min(Swift.max(0, safeValue), upper)
    }

    /// The fill as a 0...1 fraction (`clamped / max`), guarded against the web's un-guarded divide so a
    /// non-positive `max` yields an empty ring rather than `NaN`.
    public static func fillFraction(value: Double, maxValue: Double) -> Double {
        guard maxValue.isFinite, maxValue > 0 else { return 0 }
        return clamp(value: value, maxValue: maxValue) / maxValue
    }

    /// Web `offset = circumference - (clamped / max) * circumference` — the dash offset that reveals the
    /// arc. Retained for direct parity; the native view paints with `fillFraction` via `.trim`.
    public static func offset(circumference: Double, fillFraction: Double) -> Double {
        circumference - fillFraction * circumference
    }

    /// The fill as a 0...100 percentage — the accessibility value reading.
    public static func percent(value: Double, maxValue: Double) -> Double {
        fillFraction(value: value, maxValue: maxValue) * 100
    }

    /// Web `mainSize = Math.max(10, Math.round(size * 0.32))`.
    public static func mainFontSize(forSize size: Double) -> Double {
        Swift.max(ProgressRingMeta.minMainFontSize, (size * ProgressRingMeta.mainFontScale).rounded())
    }

    /// Web `subSize = Math.max(8, Math.round(size * 0.18))`.
    public static func subFontSize(forSize size: Double) -> Double {
        Swift.max(ProgressRingMeta.minSubFontSize, (size * ProgressRingMeta.subFontScale).rounded())
    }

    /// The full resolved geometry for an input snapshot.
    public static func resolve(_ input: ProgressRingInput) -> ProgressRingResolved {
        let size = dimension(input.size, fallback: ProgressRingMeta.defaultSize)
        let stroke = dimension(input.strokeWidth, fallback: ProgressRingMeta.defaultStrokeWidth)
        let ringRadius = radius(size: size, strokeWidth: stroke)
        let ringCircumference = circumference(radius: ringRadius)
        let fraction = fillFraction(value: input.value, maxValue: input.max)
        return ProgressRingResolved(
            size: size,
            strokeWidth: stroke,
            radius: ringRadius,
            center: size / 2,
            circumference: ringCircumference,
            clamped: clamp(value: input.value, maxValue: input.max),
            fillFraction: fraction,
            offset: offset(circumference: ringCircumference, fillFraction: fraction),
            percent: fraction * 100,
            hasCenter: input.centerLabel != nil || input.centerSubLabel != nil,
            mainFontSize: mainFontSize(forSize: size),
            subFontSize: subFontSize(forSize: size)
        )
    }
}
