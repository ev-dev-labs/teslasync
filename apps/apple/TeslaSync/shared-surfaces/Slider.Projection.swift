//
//  Slider.Projection.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  The pure projection from the input snapshot (+ the caller's `formatValue` closure + the P1/S10
//  resolver) to the resolved, view-ready state — the native port of the web `Slider` render. The web
//  has no async branches (see Slider.Adapter "states" note); the genuine structural branches are the
//  optional label row (`showLabel`) and the disabled track. Everything the view needs is computed
//  here — the canonical (clamped + snapped) value, the formatted readout, the accessible name / value
//  / hint, and the well-formed control range — so the view is a pure function of this value and every
//  branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved view-state (web rendered output)

/// The resolved, view-ready slider state. The view renders these fields directly: the canonical value
/// + bounds drive the native `Slider`; `displayText` is the readout (web `display`); `showLabel`
/// gates the label row; `isDisabled` dims + disables the track; the accessibility fields carry the
/// web `<label>`/`aria-label` name, the `aria-valuetext` value, and the native hint.
public struct SliderResolved: Sendable, Equatable {
    /// The canonical value — clamped into `[minimum, maximum]` and snapped to the step grid.
    public let value: Double
    /// Inclusive lower bound (web `min`).
    public let minimum: Double
    /// Inclusive upper bound, coerced to never sit below `minimum` (web `max`).
    public let maximum: Double
    /// The positive step increment (web `step`).
    public let step: Double
    /// The visible / spoken readout — web `display = formatValue?(value) ?? String(value)`.
    public let displayText: String
    /// The caller's label (web `label`) — shown in the label row when `showLabel`.
    public let labelText: String
    /// Whether the visible label row is shown (web `showLabel`).
    public let showLabel: Bool
    /// Whether interaction is disabled (web `disabled`).
    public let isDisabled: Bool
    /// The accessible name (web `<label>` / `aria-label`).
    public let accessibilityLabel: String
    /// The spoken value (web `aria-valuetext`).
    public let accessibilityValue: String
    /// The localized native adjust hint.
    public let accessibilityHint: String
    /// The resolved element id (web `id ?? slider-${useId()}`).
    public let accessibilityIdentifier: String

    public init(
        value: Double,
        minimum: Double,
        maximum: Double,
        step: Double,
        displayText: String,
        labelText: String,
        showLabel: Bool,
        isDisabled: Bool,
        accessibilityLabel: String,
        accessibilityValue: String,
        accessibilityHint: String,
        accessibilityIdentifier: String
    ) {
        self.value = value
        self.minimum = minimum
        self.maximum = maximum
        self.step = step
        self.displayText = displayText
        self.labelText = labelText
        self.showLabel = showLabel
        self.isDisabled = isDisabled
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.accessibilityHint = accessibilityHint
        self.accessibilityIdentifier = accessibilityIdentifier
    }

    /// The lower bound of the range handed to the native `Slider`.
    public var controlLowerBound: Double {
        minimum
    }

    /// The upper bound of the range handed to the native `Slider`. A degenerate `min == max` range
    /// would make the native control divide by a zero-length span, so it is widened by one step to
    /// keep the thumb well-formed (the value still pins to `minimum`). The logical `maximum` stays
    /// untouched for accessibility + tests.
    public var controlUpperBound: Double {
        maximum > minimum ? maximum : minimum + step
    }
}

// MARK: - Projection (web component body)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `Slider` render. The value is canonicalised through `SliderMath`; the readout is produced by the
/// caller's `formatValue` (or the `String(value)` default); the accessibility name / value / hint are
/// built through the P1/S10 resolver. Unit tested across the label modes, the disabled flag, the
/// default vs. custom formatter, and the clamp/snap normalisation.
public enum SliderProjection {
    public static func resolve(
        _ input: SliderInput,
        format: ((Double) -> String)? = nil,
        strings: SliderResolve = SliderStrings.string
    ) -> SliderResolved {
        let maximum = SliderMath.effectiveMaximum(minimum: input.minimum, maximum: input.maximum)
        let step = SliderMath.effectiveStep(input.step)
        let value = SliderMath.sanitize(
            input.value,
            minimum: input.minimum,
            maximum: input.maximum,
            step: input.step
        )
        let display = format?(value) ?? SliderFormatting.defaultDisplay(value)
        return SliderResolved(
            value: value,
            minimum: input.minimum,
            maximum: maximum,
            step: step,
            displayText: display,
            labelText: input.label,
            showLabel: input.showLabel,
            isDisabled: input.isDisabled,
            accessibilityLabel: SliderAccessibility.label(input.label),
            accessibilityValue: SliderAccessibility.value(display),
            accessibilityHint: SliderAccessibility.hint(strings: strings),
            accessibilityIdentifier: input.identifier
        )
    }
}
