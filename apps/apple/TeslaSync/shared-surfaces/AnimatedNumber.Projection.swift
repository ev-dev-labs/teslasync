//
//  AnimatedNumber.Projection.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  The pure projection from the input snapshot + the animation progress to the on-screen text — the
//  native port of the web tick loop:
//
//      const progress = Math.min(elapsed / durationMs, 1);
//      const eased = 1 - (1 - progress) * (1 - progress);   // ease-out quad
//      setDisplay(from + (to - from) * eased);              // from = 0, to = value
//
//  The view is a pure function of these values; every branch is unit tested. Keeping the easing and
//  tween here (rather than in the view) lets the rendered text at any animation frame be asserted
//  deterministically, which is how the per-state "snapshot" coverage is expressed without a pixel
//  snapshot harness.
//

import Foundation

// MARK: - Resolved view-state (web settled `display`)

/// The resolved, view-ready settled text — the fully composed string shown once the count-up reaches
/// the target (`progress == 1`). Used for the accessibility label and the Reduce Motion / zero-
/// duration immediate render.
public struct AnimatedNumberResolved: Sendable, Equatable {
    public let text: String

    public init(text: String) {
        self.text = text
    }
}

// MARK: - Projection (easing + tween + formatting)

/// Pure projection: the ease-out-quad curve, the zero-anchored tween, the duration guard, and the
/// formatted display string at any progress. No SwiftUI, no formatter state.
public enum AnimatedNumberProjection {
    /// Ease-out quad — the verbatim port of `1 - (1 - p) * (1 - p)`. The progress is clamped to
    /// 0...1 first (web `Math.min(elapsed / durationMs, 1)`; elapsed is never negative).
    public static func easeOutQuad(_ progress: Double) -> Double {
        let clamped = min(max(0, progress), 1)
        return 1 - (1 - clamped) * (1 - clamped)
    }

    /// The displayed numeric value at a given linear progress — the web `from + (to - from) * eased`
    /// with `from = 0`, so the count always starts at zero and eases up to `value`.
    public static func tween(to value: Double, progress: Double) -> Double {
        value * easeOutQuad(progress)
    }

    /// Sanitise the count-up length: a non-positive or non-finite duration means "no tween — show the
    /// final value immediately" (web `durationMs <= 0` makes `progress` clamp straight to 1).
    public static func clampedDuration(_ duration: Double) -> Double {
        (duration.isFinite && duration > 0) ? duration : 0
    }

    /// The full display string at a given linear progress — tween, then format + compose.
    public static func displayString(for input: AnimatedNumberInput, progress: Double) -> String {
        AnimatedNumberFormatting.display(input, value: tween(to: input.value, progress: progress))
    }

    /// The settled display string (`progress == 1`, i.e. the formatted target value).
    public static func settledString(for input: AnimatedNumberInput) -> String {
        AnimatedNumberFormatting.display(input, value: input.value)
    }

    /// The resolved settled view-state.
    public static func resolve(_ input: AnimatedNumberInput) -> AnimatedNumberResolved {
        AnimatedNumberResolved(text: settledString(for: input))
    }
}
