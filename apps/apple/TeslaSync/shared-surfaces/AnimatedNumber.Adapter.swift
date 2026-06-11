//
//  AnimatedNumber.Adapter.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  The testable, dependency-light core for the count-up number display — the SwiftUI parity of
//  `components/data-display/AnimatedNumber.tsx`. Everything here is pure (Foundation only): the input
//  snapshot (the web props), the surface metadata (the diagnostics slug + the web defaults), the
//  locale-aware number formatter (the native shape of the web `fmtNumber(value, decimals)` call), and
//  the VoiceOver label builder. No store, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is purely presentational: it takes an already-resolved
//  `value` and tweens it to the screen. It reads no hooks, performs no fetch, and has no
//  loading / error / empty / stale / offline branch to mirror; synthesising such chrome would invent
//  state the web source does not have (the same disposition as the 0053 AIThinkingIndicator surface).
//  The genuine render branches this core models are exactly the ones the web has: the in-flight tween
//  vs. the settled value, motion vs. Reduce Motion (jump to the final value), the `decimals` precision,
//  the optional `prefix` / `suffix`, locale-aware grouping, and non-finite / negative inputs.
//
//  Parity note — i18n. The web component renders no translatable copy: its only locale-sensitive
//  output is the formatted number. The P1/S10 binding for this surface is therefore the injected
//  `Locale` that drives the grouping separators and decimal mark (the native parity of `fmtNumber`'s
//  global-locale read), not a string catalog. See AnimatedNumber.strings.
//

import Foundation

// MARK: - Input (web `AnimatedNumberProps`)

/// One coalesced snapshot of the surface's inputs — the web props. `value` is the already-resolved
/// target the display tweens toward; `duration` is the count-up length in seconds (web default 1);
/// `decimals` is the fixed fraction-digit count (web default 0); `prefix` / `suffix` bracket the
/// formatted number; `locale` carries the grouping/decimal conventions the web reads from the global
/// formatter. Equatable + Hashable so the view can key its restart-from-zero animation off it.
public struct AnimatedNumberInput: Sendable, Equatable, Hashable {
    public var value: Double
    public var duration: Double
    public var decimals: Int
    public var prefix: String?
    public var suffix: String?
    public var locale: Locale

    public init(
        value: Double,
        duration: Double = AnimatedNumberMeta.defaultDuration,
        decimals: Int = AnimatedNumberMeta.defaultDecimals,
        prefix: String? = nil,
        suffix: String? = nil,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.value = value
        self.duration = duration
        self.decimals = decimals
        self.prefix = prefix
        self.suffix = suffix
        self.locale = locale
    }
}

// MARK: - Surface metadata (diagnostics slug + web defaults)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened` and
/// the web prop defaults (`duration = 1`, `decimals = 0`) plus the fraction-digit clamp.
public enum AnimatedNumberMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AnimatedNumber"

    /// Web default `duration = 1` (seconds).
    public static let defaultDuration: Double = 1

    /// Web default `decimals = 0`.
    public static let defaultDecimals: Int = 0

    /// Upper bound on fraction digits, matching the web `setGlobalPrecision` clamp of 0...20.
    public static let maxFractionDigits: Int = 20
}

// MARK: - Number formatting (web `fmtNumber` + the prefix/suffix composition)

/// The locale-aware number formatter — the native shape of the web `fmtNumber(value, decimals)` and
/// the `{prefix}{number}{suffix}` composition. Pure and value-type (uses `FloatingPointFormatStyle`,
/// which is `Sendable`), so the surface formats without a shared mutable `NumberFormatter`.
public enum AnimatedNumberFormatting {
    /// Web `safeNumber`: a non-finite value (NaN / ±Infinity) formats as zero rather than reaching
    /// the formatter and producing "NaN".
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Clamp the fraction-digit count to the web `setGlobalPrecision` range (0...20) so a negative or
    /// runaway `decimals` can never crash the format style.
    public static func clampDecimals(_ decimals: Int) -> Int {
        min(max(0, decimals), AnimatedNumberMeta.maxFractionDigits)
    }

    /// Format a single value with locale-aware grouping and exactly `decimals` fraction digits — the
    /// parity of `toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })`.
    public static func string(_ value: Double, decimals: Int, locale: Locale) -> String {
        let digits = clampDecimals(decimals)
        return safe(value).formatted(
            .number
                .precision(.fractionLength(digits))
                .grouping(.automatic)
                .locale(locale)
        )
    }

    /// Bracket the formatted number with the optional prefix / suffix (web `{prefix}{…}{suffix}`,
    /// rendered adjacent with no separator). A `nil` affix contributes nothing.
    public static func composed(prefix: String?, number: String, suffix: String?) -> String {
        (prefix ?? "") + number + (suffix ?? "")
    }

    /// The full display string for an arbitrary (already-tweened) value under the input's precision,
    /// locale, prefix, and suffix.
    public static func display(_ input: AnimatedNumberInput, value: Double) -> String {
        composed(
            prefix: input.prefix,
            number: string(value, decimals: input.decimals, locale: input.locale),
            suffix: input.suffix
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from the input, so the spoken content is asserted without
/// rendering the view. The web is a bare `<span>` with no `aria-label`; the native refinement voices
/// the *settled* value (prefix + final number + suffix) so VoiceOver announces the meaningful figure
/// rather than the intermediate tween frames.
public enum AnimatedNumberAccessibility {
    /// The spoken label for the value — the fully composed settled display string.
    public static func valueLabel(_ input: AnimatedNumberInput) -> String {
        AnimatedNumberFormatting.display(input, value: input.value)
    }
}
