//
//  Delta.Projection.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  The pure projection from the indicator's props to the view-ready model the SwiftUI body renders —
//  the native port of the web `<Delta>` render body (components/data-display/Delta.tsx), including the
//  inline `useUnitLabels` affix resolution and the `fmtNumber` / `formatAbsolute` helpers it composes
//  (lib/numberFormat.ts). Kept Foundation-only and view-free so every branch — loading / empty /
//  percent / absolute / both, tone + arrow, the previous-zero percent fallback — is unit tested
//  without an `@Observable` model or a view.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``DeltaProjector/resolve(_:units:)`` takes the cached endpoints a metric row already holds plus the
//  bound unit preferences (P1/S8, the native peer of `useUnits()` / `useFormatting()`), and derives
//  the rendered indicator — no networking, no clock. The `current` / `previous` arrive ALREADY in
//  display units (the web never converts in `<Delta>`); the units only resolve the affix labels and
//  the locale-aware grouping, the same boundary the web hooks draw.
//

import Foundation

// MARK: - DeltaGlyph (web string literals)

/// The literal glyphs the indicator renders verbatim — kept as named constants so the projection and
/// its tests share one source of truth.
public enum DeltaGlyph {
    /// The em-dash shown for a missing comparison or an undefined percent (web `'—'`).
    public static let dash = "—"
}

// MARK: - DeltaUnitLabels (web `useUnitLabels` result)

/// The resolved affixes for a unit — the native peer of the web `useUnitLabels` return
/// (`{ prefix, suffix }`). `prefix` precedes the value (e.g. a currency symbol); `suffix` follows it
/// with a leading space unless it is `%` (which is glued).
public struct DeltaUnitLabels: Sendable, Equatable {
    /// Prefix shown before the value (web `prefix`).
    public let prefix: String
    /// Suffix shown after the value (web `suffix`).
    public let suffix: String

    public init(prefix: String, suffix: String) {
        self.prefix = prefix
        self.suffix = suffix
    }
}

// MARK: - DeltaUnitLabelResolver (web `useUnitLabels`)

/// Resolves a ``DeltaMetricUnit`` to its affixes against the bound ``UnitPreferences`` — the verbatim
/// port of the web `useUnitLabels`. Distance / speed / temperature / pressure suffixes come from the
/// user's unit labels (web `unitPrefs.*`), the efficiency suffix flips with the distance unit, the
/// currency prefix is the locale's currency symbol (web `useFormatting().currencySymbol`), and the
/// dimensionless units carry no affix.
public enum DeltaUnitLabelResolver {
    /// Units whose suffix is a fixed literal (independent of the user's preferences) — the web
    /// `percent` / `kwh` / `wh` / `h` / `min` arms. Split out of the main switch so the resolver stays
    /// under the cyclomatic-complexity budget; the preference-driven units fall through to
    /// ``preferenceSuffix(for:units:)`` and `currency` is handled inline (it is the only prefix).
    private static let fixedSuffixes: [DeltaMetricUnit: String] = [
        .percent: "%",
        .kwh: "kWh",
        .wh: "Wh",
        .hours: "h",
        .minutes: "min"
    ]

    public static func resolve(_ unit: DeltaMetricUnit?, units: UnitPreferences) -> DeltaUnitLabels {
        guard let unit else {
            return DeltaUnitLabels(prefix: "", suffix: "")
        }
        if unit == .currency {
            return DeltaUnitLabels(prefix: currencySymbol(locale: units.locale), suffix: "")
        }
        if let fixed = fixedSuffixes[unit] {
            return DeltaUnitLabels(prefix: "", suffix: fixed)
        }
        return DeltaUnitLabels(prefix: "", suffix: preferenceSuffix(for: unit, units: units))
    }

    /// The suffix for the preference-driven units — the web arms that read `unitPrefs.*`. The
    /// efficiency suffix flips with the distance unit (web `unitPrefs.distance === 'mi' ? 'Wh/mi' :
    /// 'Wh/km'`); the dimensionless `count` (and any unit already handled above) carries no suffix.
    private static func preferenceSuffix(for unit: DeltaMetricUnit, units: UnitPreferences) -> String {
        switch unit {
        case .mi, .km:
            units.distance
        case .whPerMi:
            units.distance == "mi" ? "Wh/mi" : "Wh/km"
        case .mph, .kph:
            units.speed
        case .celsius, .fahrenheit:
            units.temperature
        case .bar:
            units.pressure
        default:
            ""
        }
    }

    /// The currency symbol for the bound locale — the native peer of the web
    /// `useFormatting().currencySymbol`. Derived from the locale (the same locale that drives the
    /// number grouping) so it tracks the user's region; falls back to `$` for an empty / generic
    /// (`¤`) symbol, keeping the affix deterministic.
    static func currencySymbol(locale: String?) -> String {
        let trimmed = locale ?? ""
        let identifier = trimmed.isEmpty ? "en-US" : trimmed
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: identifier)
        let symbol = formatter.currencySymbol ?? ""
        if symbol.isEmpty || symbol == "\u{00A4}" {
            return "$"
        }
        return symbol
    }
}

// MARK: - DeltaNumberFormat (web `fmtNumber` / `formatAbsolute`)

/// Locale-aware fixed-precision formatting — the native peer of the web `fmtNumber(value, decimals,
/// locale)` (`toLocaleString` with `min = max` fraction digits) and `formatAbsolute`. The grouping +
/// decimal separators come from the bound locale, matching the web `toLocaleString(locale)`.
public enum DeltaNumberFormat {
    /// The web percent fallback precision (`precision ?? 1`).
    public static let percentPrecision = 1
    /// The web absolute / title fallback precision when no settings precision is bound
    /// (the web global `_globalPrecision` default).
    public static let defaultPrecision = 2

    /// Formats a value with a fixed number of fraction digits and locale grouping — web
    /// `fmtNumber(value, decimals, locale)`.
    public static func fixed(_ value: Double, precision: Int, locale: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: locale)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = precision
        formatter.maximumFractionDigits = precision
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// The web `formatAbsolute`: prefix + grouped number + suffix, with the percent suffix glued and
    /// other suffixes space-separated.
    public static func absolute(
        _ value: Double,
        prefix: String,
        suffix: String,
        precision: Int,
        locale: String
    ) -> String {
        let num = fixed(value, precision: precision, locale: locale)
        if !prefix.isEmpty, !suffix.isEmpty {
            return "\(prefix)\(num) \(suffix)"
        }
        if !prefix.isEmpty {
            return "\(prefix)\(num)"
        }
        if suffix == "%" {
            return "\(num)%"
        }
        if !suffix.isEmpty {
            return "\(num) \(suffix)"
        }
        return num
    }
}

// MARK: - DeltaTone (web `colorForDelta` outcome)

/// The semantic tone colouring the value — the native peer of the web `colorForDelta` outcome. A zero
/// delta is ``muted``, a `neutral`-direction metric is ``secondary`` (never good / bad), and a signed
/// delta is ``success`` (favorable) or ``danger`` (unfavorable). Mapped to theme-aware design tokens
/// (P1/S9) in Delta.Views.swift, where the web used fixed `text-emerald-400` / `text-rose-400` /
/// `var(--text-*)`.
public enum DeltaTone: String, Sendable, Equatable, CaseIterable {
    /// Zero change — web `text-[var(--text-muted)]`.
    case muted
    /// Neutral-direction metric — web `text-[var(--text-secondary)]`.
    case secondary
    /// Favorable change — web `text-emerald-400`.
    case success
    /// Unfavorable change — web `text-rose-400`.
    case danger
}

// MARK: - DeltaArrow (web lucide Arrow{Up,Down,Right})

/// The directional arrow the indicator renders — the native peer of the web `ArrowUp` / `ArrowDown` /
/// `ArrowRight` choice (and the `hideArrow` opt-out). Mapped to an SF Symbol in Delta.Views.swift
/// and, like the web SVG (`aria-hidden`), kept out of the VoiceOver label (the spoken indicator comes
/// from the resolved title).
public enum DeltaArrow: String, Sendable, Equatable {
    /// Rise — web `ArrowUp` (`signedDelta > 0`).
    case up
    /// Drop — web `ArrowDown` (`signedDelta < 0`).
    case down
    /// No change — web `ArrowRight` (`signedDelta === 0`).
    case right
    /// Suppressed — web `hideArrow`.
    case hidden
}

// MARK: - DeltaValue (web populated render)

/// The resolved populated indicator — everything the web `<Delta>` render body decides for the
/// non-loading, non-empty case: the `arrow`, the `tone`, the visible `text` (percent / absolute /
/// both), the trailing `comparedTo`, the `size`, and the formatted endpoints feeding the VoiceOver
/// title (web `title="{current} vs {previous}"`). The view is a pure function of this value.
public struct DeltaValue: Sendable, Equatable {
    public let arrow: DeltaArrow
    public let tone: DeltaTone
    public let text: String
    public let comparedTo: String?
    public let size: DeltaSize
    /// Formatted current value for the spoken title (web title `current`, precision ?? 2).
    public let currentText: String
    /// Formatted previous value for the spoken title (web title `previous`, precision ?? 2).
    public let previousText: String

    public init(
        arrow: DeltaArrow,
        tone: DeltaTone,
        text: String,
        comparedTo: String?,
        size: DeltaSize,
        currentText: String,
        previousText: String
    ) {
        self.arrow = arrow
        self.tone = tone
        self.text = text
        self.comparedTo = comparedTo
        self.size = size
        self.currentText = currentText
        self.previousText = previousText
    }
}

// MARK: - DeltaProjection (web three render arms)

/// The single render arm the indicator resolves to — the native projection of the web `<Delta>`
/// conditional. `loading` is the web `loading` skeleton, `empty` is the missing-inputs em-dash (the
/// faithful "empty" — web `current/previous == null || !Number.isFinite`), and `value` is the
/// sign-/tone-decorated indicator.
public enum DeltaProjection: Sendable, Equatable {
    /// Forced skeleton — web `if (loading) return <Skeleton/>`.
    case loading(DeltaSize)
    /// Missing / non-finite inputs — the muted "—" + optional `comparedTo` (web em-dash branch).
    case empty(comparedTo: String?, size: DeltaSize)
    /// The populated indicator.
    case value(DeltaValue)
}

// MARK: - DeltaProjector (web `<Delta>` render body)

/// Resolves the indicator exactly like the web `<Delta>`:
///   • `loading` → the skeleton arm.
///   • `current`/`previous` missing or non-finite → the muted "—" empty arm (web em-dash).
///   • otherwise `signedDelta = current − previous`; the arrow encodes the sign (or is hidden), the
///     tone follows `colorForDelta`, and the visible text is the percent / absolute / both form (with
///     the percent falling back to "—" when `previous == 0`, where a percentage is undefined).
public enum DeltaProjector {
    public static func resolve(_ inputs: DeltaInputs, units: UnitPreferences) -> DeltaProjection {
        let semantic = DeltaMetricRegistry.resolve(inputs.metric)

        if inputs.loading {
            return .loading(inputs.size)
        }

        guard let current = inputs.current, current.isFinite,
              let previous = inputs.previous, previous.isFinite
        else {
            return .empty(comparedTo: inputs.comparedTo, size: inputs.size)
        }

        let labels = DeltaUnitLabelResolver.resolve(semantic.unit, units: units)
        let locale = units.locale ?? "en-US"
        let signedDelta = current - previous
        let signedPct = previous != 0 ? (signedDelta / abs(previous)) * 100 : nil
        let tone = tone(direction: semantic.direction, signedDelta: signedDelta)
        let arrow = arrow(hideArrow: inputs.hideArrow, signedDelta: signedDelta)

        let absolutePrecision = inputs.precision ?? units.precision ?? DeltaNumberFormat.defaultPrecision
        let titlePrecision = inputs.precision ?? DeltaNumberFormat.defaultPrecision

        let absText = DeltaNumberFormat.absolute(
            abs(signedDelta),
            prefix: labels.prefix,
            suffix: labels.suffix,
            precision: absolutePrecision,
            locale: locale
        )
        let pctText = signedPct.map { value -> String in
            let precision = inputs.precision ?? DeltaNumberFormat.percentPrecision
            return "\(DeltaNumberFormat.fixed(abs(value), precision: precision, locale: locale))%"
        }

        let text: String = switch inputs.display {
        case .absolute:
            absText
        case .both:
            pctText.map { "\(absText) (\($0))" } ?? absText
        case .percent:
            pctText ?? DeltaGlyph.dash
        }

        return .value(DeltaValue(
            arrow: arrow,
            tone: tone,
            text: text,
            comparedTo: inputs.comparedTo,
            size: inputs.size,
            currentText: DeltaNumberFormat.fixed(current, precision: titlePrecision, locale: locale),
            previousText: DeltaNumberFormat.fixed(previous, precision: titlePrecision, locale: locale)
        ))
    }

    /// Web `colorForDelta(direction, signedDelta)`.
    static func tone(direction: DeltaDirection, signedDelta: Double) -> DeltaTone {
        if signedDelta == 0 {
            return .muted
        }
        if direction == .neutral {
            return .secondary
        }
        let positiveOutcome =
            (direction == .higherBetter && signedDelta > 0) ||
            (direction == .lowerBetter && signedDelta < 0)
        return positiveOutcome ? .success : .danger
    }

    /// Web arrow choice (`signedDelta > 0 ? ArrowUp : signedDelta < 0 ? ArrowDown : ArrowRight`),
    /// suppressed when `hideArrow`.
    static func arrow(hideArrow: Bool, signedDelta: Double) -> DeltaArrow {
        if hideArrow {
            return .hidden
        }
        if signedDelta > 0 {
            return .up
        }
        if signedDelta < 0 {
            return .down
        }
        return .right
    }
}
