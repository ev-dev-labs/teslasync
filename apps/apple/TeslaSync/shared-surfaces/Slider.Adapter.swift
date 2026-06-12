//
//  Slider.Adapter.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  The testable, dependency-light core for the single-thumb slider — the SwiftUI parity of
//  `components/ui/Slider.tsx`. Everything here is pure (Foundation only): the input snapshot, the
//  WAI-ARIA APG keyboard commands the web `<input type="range">` documents, the numeric core that
//  reproduces the browser's clamp-and-snap-to-step semantics, the `Number(value)` change-handler
//  parse + the `String(value)` default formatter, and the VoiceOver builders. No store, no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is a controlled primitive: it receives `value` / `onChange`
//  from its parent and reads `useId` for an element id. It performs NO data fetch — `useId` is id
//  generation, not a query — so it has no loading / error / stale / offline axis. Synthesising
//  network chrome here would invent state the source does not have (the same disposition as the 0087
//  Range, 0085 Distance and 0075 AnimatedNumber synchronous-primitive surfaces). The genuine render
//  branches this core models are exactly the web's: the optional label row (`showLabel`), the live
//  formatted readout, the enabled track, and the disabled (dimmed, non-interactive) track. The value
//  is a required prop — there is no empty/missing-value branch.
//
//  Parity note — i18n. The web `Slider` renders NO translatable copy of its own: `label` and the
//  formatted value are caller-supplied. The only native-owned string is an accessibility hint (a
//  refinement over the web `<input>`, which leans on the browser/AT), resolved through the injected
//  P1/S10 facade. See Slider.strings.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: the app passes the
/// P1/S10 facade, tests pass the identity-fallback resolver.
public typealias SliderResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Surface metadata (diagnostics slug + lib defaults)

/// Static, non-identifying surface constants — the P1/S11 diagnostics slug emitted with
/// `view.opened`, the web `step` default (1), the PageUp/PageDown fraction (~10% of the range, the
/// WAI-ARIA APG "large step"), and the `useId`-equivalent identifier prefix.
public enum SliderMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = "Slider"

    /// Web `step = 1` default.
    public static let defaultStep: Double = 1

    /// PageUp / PageDown moves by ~10% of the range (web JSDoc "PageUp/Down by ~10% of the range").
    public static let pageStepFraction: Double = 0.1

    /// The auto-generated identifier prefix — the native parity of web `slider-${useId()}`.
    public static let identifierPrefix = "slider"

    /// Resolve the element identifier — web `id ?? slider-${reactId}`. An explicit, non-blank id
    /// wins; otherwise a stable unique id is generated (the native parity of `useId`).
    public static func makeIdentifier(_ explicit: String?) -> String {
        if let explicit, !explicit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return explicit
        }
        return "\(identifierPrefix)-\(UUID().uuidString.lowercased())"
    }
}

// MARK: - Keyboard commands (web JSDoc WAI-ARIA APG slider pattern)

/// The adjustment commands the web `<input type="range">` services from the keyboard, modelled so the
/// value transitions are unit tested without a view. Arrow keys map to `step`/`stepDown`, PageUp/Down
/// to the ~10% large step, and Home/End jump to the bounds. SwiftUI's `Slider(step:)` services the
/// arrow keys + the VoiceOver increment/decrement natively; the page + bound jumps are wired as key
/// commands on top.
public enum SliderCommand: String, Sendable, Equatable, CaseIterable {
    /// ArrowRight / ArrowUp — increment by `step`.
    case stepUp
    /// ArrowLeft / ArrowDown — decrement by `step`.
    case stepDown
    /// PageUp — increment by ~10% of the range.
    case pageUp
    /// PageDown — decrement by ~10% of the range.
    case pageDown
    /// Home — jump to `min`.
    case toMinimum
    /// End — jump to `max`.
    case toMaximum
}

// MARK: - Input snapshot (web `SliderProps` minus the closures)

/// One coalesced snapshot of the slider's value-type inputs — the web `value` / `min` / `max` /
/// `step` / `label` / `showLabel` / `disabled` props plus the resolved element id. The `onChange` and
/// `formatValue` closures are NOT part of the snapshot (closures are not `Equatable`); they are held
/// by the model and applied to this snapshot, so the view can re-sync the model whenever any
/// value-type prop changes via `onChange(of:)`.
public struct SliderInput: Sendable, Equatable {
    /// The current value (web `value`).
    public var value: Double
    /// Inclusive lower bound (web `min`).
    public var minimum: Double
    /// Inclusive upper bound (web `max`).
    public var maximum: Double
    /// Step increment for keyboard + drag (web `step`, default 1).
    public var step: Double
    /// Visible label *and* accessible name (web `label`, required).
    public var label: String
    /// When `false`, the visible label row is hidden and `label` is exposed only as the accessible
    /// name (web `showLabel`, default true).
    public var showLabel: Bool
    /// Disable interaction (web `disabled`).
    public var isDisabled: Bool
    /// Resolved element id (web `id ?? slider-${useId()}`).
    public var identifier: String

    public init(
        value: Double,
        minimum: Double,
        maximum: Double,
        step: Double = SliderMeta.defaultStep,
        label: String,
        showLabel: Bool = true,
        isDisabled: Bool = false,
        identifier: String = SliderMeta.identifierPrefix
    ) {
        self.value = value
        self.minimum = minimum
        self.maximum = maximum
        self.step = step
        self.label = label
        self.showLabel = showLabel
        self.isDisabled = isDisabled
        self.identifier = identifier
    }
}

// MARK: - Numeric core (web `<input type=range>` clamp + snap-to-step semantics)

/// The pure numeric core — the native port of the browser's range-input value handling so the
/// rounding, clamping, step snapping, large-step, and keyboard transitions match the web. Value-type
/// and deterministic; unit tested without a view.
public enum SliderMath {
    /// A step is only meaningful when strictly positive — the web treats a non-positive `step` as "no
    /// snapping" (continuous). Falls back to the default step so the control stays well-formed.
    public static func effectiveStep(_ step: Double) -> Double {
        step.isFinite && step > 0 ? step : SliderMeta.defaultStep
    }

    /// The upper bound never sits below the lower bound — the web browser coerces `max < min` up to
    /// `min` (a degenerate, fixed slider). Non-finite bounds collapse to the lower bound.
    public static func effectiveMaximum(minimum: Double, maximum: Double) -> Double {
        guard maximum.isFinite, maximum > minimum else { return minimum }
        return maximum
    }

    /// Clamp a value into the inclusive `[minimum, maximum]` range.
    public static func clamp(_ value: Double, minimum: Double, maximum: Double) -> Double {
        if value < minimum { return minimum }
        if value > maximum { return maximum }
        return value
    }

    /// Snap a value to the nearest step offset from `minimum` — the web `<input type=range>` step
    /// quantisation (`min + round((v - min)/step) * step`). A non-positive / non-finite `step` is
    /// normalised to the default step by `effectiveStep`, so the value always snaps to a positive
    /// grid (the web `step` default is 1; the control never runs continuous).
    public static func snap(_ value: Double, minimum: Double, step: Double) -> Double {
        let stride = effectiveStep(step)
        let steps = ((value - minimum) / stride).rounded()
        return minimum + steps * stride
    }

    /// The canonical value: a non-finite input falls back to `minimum`, then snap to the step grid,
    /// then clamp into `[minimum, effectiveMaximum]` — the exact order the browser applies so a value
    /// prop outside the range (or off-grid) is normalised the same way.
    public static func sanitize(_ value: Double, minimum: Double, maximum: Double, step: Double) -> Double {
        let upper = effectiveMaximum(minimum: minimum, maximum: maximum)
        let base = value.isFinite ? value : minimum
        let snapped = snap(base, minimum: minimum, step: step)
        return clamp(snapped, minimum: minimum, maximum: upper)
    }

    /// The PageUp / PageDown delta — the larger of one `step` and ~10% of the range (the WAI-ARIA APG
    /// "large step"; the web JSDoc "PageUp/Down by ~10% of the range").
    public static func pageDelta(minimum: Double, maximum: Double, step: Double) -> Double {
        let upper = effectiveMaximum(minimum: minimum, maximum: maximum)
        let tenth = (upper - minimum) * SliderMeta.pageStepFraction
        return Swift.max(effectiveStep(step), tenth)
    }

    /// Apply a keyboard command to the current value and return the sanitized result — the value
    /// transition the web `<input type=range>` performs for each key in the APG slider pattern.
    public static func next(for command: SliderCommand, from input: SliderInput) -> Double {
        let current = sanitize(input.value, minimum: input.minimum, maximum: input.maximum, step: input.step)
        let target: Double = switch command {
        case .stepUp:
            current + effectiveStep(input.step)
        case .stepDown:
            current - effectiveStep(input.step)
        case .pageUp:
            current + pageDelta(minimum: input.minimum, maximum: input.maximum, step: input.step)
        case .pageDown:
            current - pageDelta(minimum: input.minimum, maximum: input.maximum, step: input.step)
        case .toMinimum:
            input.minimum
        case .toMaximum:
            effectiveMaximum(minimum: input.minimum, maximum: input.maximum)
        }
        return sanitize(target, minimum: input.minimum, maximum: input.maximum, step: input.step)
    }
}

// MARK: - Formatting + parsing (web `formatValue` default + the change-handler `Number(value)`)

/// The pure display + parse helpers — the native port of the web `display = formatValue ? … :
/// String(value)` default and the `Number(e.currentTarget.value)` change-handler guard. Deterministic
/// and locale-independent (the web default `String(Number)` uses a "." decimal and no grouping), so
/// the rendered text is asserted without a view.
public enum SliderFormatting {
    /// The default display — the parity of web `String(value)`: an integral value prints with no
    /// fraction (`32`, not `32.0`); a fractional value keeps its shortest round-trippable form
    /// (`0.05`); non-finite values print their literal description. No locale grouping (matching the
    /// web default, which is the unit-aware `formatValue` caller's responsibility).
    public static func defaultDisplay(_ value: Double) -> String {
        guard value.isFinite else { return String(value) }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// The change-handler parse — web `const next = Number(value); if (!Number.isNaN(next)) …`.
    /// Returns `nil` for blank / unparseable text (the web NaN guard that drops the change); a valid
    /// numeric string returns its `Double`.
    public static func parse(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let value = Double(trimmed), value.isFinite else { return nil }
        return value
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the slider's VoiceOver strings without rendering the view. The accessible name is the
/// caller's `label` in BOTH label modes (web exposes `label` as the visible `<label>` when
/// `showLabel`, and as `aria-label` when not); the spoken value is the formatted display (web
/// `aria-valuetext={display}`); the hint is the localized native refinement.
public enum SliderAccessibility {
    /// The accessible name — the caller's label verbatim (web `<label>` / `aria-label`).
    public static func label(_ label: String) -> String {
        label
    }

    /// The spoken value — the formatted display verbatim (web `aria-valuetext`).
    public static func value(_ display: String) -> String {
        display
    }

    /// The localized adjust hint — a native VoiceOver refinement (the web `<input>` has none).
    public static func hint(strings: SliderResolve) -> String {
        strings("slider.accessibility.hint", "Swipe up or down to adjust the value.")
    }
}
