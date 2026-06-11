//
//  MetricCard.Projection.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  The pure projection from the card's props to the view-ready model the SwiftUI body renders — the
//  native port of the web `MetricCard` render body, including the inline reproduction of the web
//  `<Delta>` render logic (components/data-display/Delta.tsx) the card composes in its footer. Kept
//  Foundation-only and view-free so every branch — value, the legacy change pill, and the delta's
//  loading / empty / percent / absolute / both arms — is unit tested without an `@Observable` model
//  or a view.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``MetricCardProjector/resolve(_:)`` takes the cached props a metric row already holds and derives
//  the rendered card — no networking, no clock. Locale-specific number grouping + unit-label lookup
//  are the format / units subsystem's job (web `fmtNumber` / `useUnits`), so the absolute formatter is
//  pinned to a stable en-US grouping (the web `toLocaleString('en-US', …)` fallback) and the unit
//  affixes arrive already resolved on ``MetricCardDelta``.
//

import Foundation

// MARK: - MetricCardTone (delta / change value color)

/// The semantic tone coloring a trend value — the native peer of the web `colorForDelta` outcome. A
/// zero delta is ``muted``, a `neutral`-direction metric is ``secondary`` (never good / bad), and a
/// signed delta is ``success`` (favorable) or ``danger`` (unfavorable). Mapped to theme-aware design
/// tokens (P1/S9) in MetricCard.Views.swift, where the web used fixed `text-emerald-400` /
/// `text-rose-400` / `var(--text-*)`.
public enum MetricCardTone: String, Sendable, Equatable, CaseIterable {
    /// Zero change — web `text-[var(--text-muted)]`.
    case muted
    /// Neutral-direction metric — web `text-[var(--text-secondary)]`.
    case secondary
    /// Favorable change — web `text-emerald-400`.
    case success
    /// Unfavorable change — web `text-rose-400`.
    case danger
}

// MARK: - MetricCardDeltaArrow (web lucide Arrow{Up,Down,Right})

/// The directional arrow the delta renders — the native peer of the web `ArrowUp` / `ArrowDown` /
/// `ArrowRight` choice (and the `hideArrow` opt-out). Mapped to an SF Symbol in MetricCard.Views.swift
/// and, like the web SVG (`aria-hidden`), kept out of the VoiceOver label (the spoken delta comes from
/// the resolved title).
public enum MetricCardDeltaArrow: String, Sendable, Equatable {
    /// Rise — web `ArrowUp` (`signedDelta > 0`).
    case up
    /// Drop — web `ArrowDown` (`signedDelta < 0`).
    case down
    /// No change — web `ArrowRight` (`signedDelta === 0`).
    case right
    /// Suppressed — web `hideArrow`.
    case hidden
}

// MARK: - MetricCardChangeProjection (web legacy change pill)

/// The resolved legacy change pill — the native port of the web `change && !delta` arm. `text` is the
/// rendered "↑ 12%" / "↓ 12%" (the glyph + the caller's value, byte-identical to web so VoiceOver reads
/// it natively); `positive` drives the emerald / rose tone.
public struct MetricCardChangeProjection: Sendable, Equatable {
    /// The visible "↑ {value}" / "↓ {value}" string (web `{positive ? '↑' : '↓'} {value}`).
    public let text: String
    /// Whether the change is favorable (emerald) or not (rose) — web `change.positive`.
    public let positive: Bool

    public init(text: String, positive: Bool) {
        self.text = text
        self.positive = positive
    }
}

// MARK: - MetricCardDeltaValue (web `<Delta>` populated render)

/// The resolved populated delta — everything the web `<Delta>` render body decides for the
/// non-loading, non-empty case: the `arrow`, the `tone`, the visible `text` (percent / absolute /
/// both), the trailing `comparedTo`, the `size`, and the formatted endpoints feeding the VoiceOver
/// title (web `title="{current} vs {previous}"`). The view is a pure function of this value.
public struct MetricCardDeltaValue: Sendable, Equatable {
    public let arrow: MetricCardDeltaArrow
    public let tone: MetricCardTone
    public let text: String
    public let comparedTo: String?
    public let size: MetricCardDelta.Size
    /// Formatted current value for the spoken title (web title `current`, precision ?? 2).
    public let currentText: String
    /// Formatted previous value for the spoken title (web title `previous`, precision ?? 2).
    public let previousText: String

    public init(
        arrow: MetricCardDeltaArrow,
        tone: MetricCardTone,
        text: String,
        comparedTo: String?,
        size: MetricCardDelta.Size,
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

// MARK: - MetricCardDeltaProjection (web `<Delta>` three render arms)

/// The single render arm the delta resolves to — the native projection of the web `<Delta>`
/// conditional. `loading` is the web `loading` skeleton, `empty` is the missing-inputs em-dash (the
/// faithful "empty" — web `current/previous == null || !Number.isFinite`), and `value` is the
/// sign-/tone-decorated indicator.
public enum MetricCardDeltaProjection: Sendable, Equatable {
    /// Forced skeleton — web `if (loading) return <Skeleton/>`.
    case loading(MetricCardDelta.Size)
    /// Missing / non-finite inputs — the muted "—" + optional `comparedTo` (web em-dash branch).
    case empty(comparedTo: String?, size: MetricCardDelta.Size)
    /// The populated indicator.
    case value(MetricCardDeltaValue)
}

// MARK: - MetricCardTrend (the card's footer slot)

/// The card's footer slot — the native peer of the web `change && !delta` vs `delta` decision. The
/// richer `delta` always takes precedence; otherwise the legacy pill is shown; otherwise nothing.
public enum MetricCardTrend: Sendable, Equatable {
    case none
    case change(MetricCardChangeProjection)
    case delta(MetricCardDeltaProjection)
}

// MARK: - MetricCardProjection (the whole card render output)

/// The resolved, view-ready card — the native bundle of everything the web `MetricCard` render body
/// decides: the visible `valueText` (web `{value}`), the optional `subtitle`, and the `trend` footer
/// slot. The view is a pure function of this value; every branch is unit tested.
public struct MetricCardProjection: Sendable, Equatable {
    /// The visible headline string (web `{value}`).
    public let valueText: String
    /// The optional muted subtitle (web `subtitle`).
    public let subtitle: String?
    /// The footer trend slot (web change pill / delta / neither).
    public let trend: MetricCardTrend

    public init(valueText: String, subtitle: String?, trend: MetricCardTrend) {
        self.valueText = valueText
        self.subtitle = subtitle
        self.trend = trend
    }
}

// MARK: - Glyph tokens (web string literals)

/// The literal glyphs the card / delta render verbatim — kept as named constants so the projection
/// and its tests share one source of truth.
public enum MetricCardGlyph {
    /// The up arrow of the legacy change pill (web `'↑'`).
    public static let upArrow = "↑"
    /// The down arrow of the legacy change pill (web `'↓'`).
    public static let downArrow = "↓"
    /// The em-dash shown for a missing comparison or undefined percent (web `'—'`).
    public static let dash = "—"
}

// MARK: - Absolute number formatting (web `fmtNumber`)

/// Formats a value with a fixed number of fraction digits and stable thousands grouping — the native
/// peer of the web `fmtNumber(value, decimals)` (`toLocaleString` with `min = max` fraction digits).
/// Pinned to `en_US_POSIX` so the output is deterministic (matching the web `toLocaleString('en-US',
/// …)` fallback); the user's actual locale grouping is the format subsystem's concern (P1), applied at
/// its own boundary.
public enum MetricCardDeltaFormat {
    /// The default precision used when a delta supplies none — the web global precision fallback.
    public static let defaultPrecision = 1

    public static func fixed(_ value: Double, precision: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.groupingSeparator = ","
        formatter.decimalSeparator = "."
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
        precision: Int?
    ) -> String {
        let num = fixed(value, precision: precision ?? defaultPrecision)
        if !prefix.isEmpty, !suffix.isEmpty { return "\(prefix)\(num) \(suffix)" }
        if !prefix.isEmpty { return "\(prefix)\(num)" }
        if suffix == "%" { return "\(num)%" }
        if !suffix.isEmpty { return "\(num) \(suffix)" }
        return num
    }
}

// MARK: - Change projector (web legacy pill)

/// Resolves the legacy change pill — the verbatim port of the web `{positive ? '↑' : '↓'} {value}`.
public enum MetricCardChangeProjector {
    public static func resolve(_ change: MetricCardChange) -> MetricCardChangeProjection {
        let glyph = change.positive ? MetricCardGlyph.upArrow : MetricCardGlyph.downArrow
        return MetricCardChangeProjection(
            text: "\(glyph) \(change.value)",
            positive: change.positive
        )
    }
}

// MARK: - Delta projector (web `<Delta>` render body)

/// Resolves the delta footer exactly like the web `<Delta>`:
///   • `loading` → the skeleton arm.
///   • `current`/`previous` missing or non-finite → the muted "—" empty arm (web em-dash).
///   • otherwise `signedDelta = current − previous`; the arrow encodes the sign (or is hidden), the
///     tone follows `colorForDelta`, and the visible text is the percent / absolute / both form (with
///     the percent falling back to "—" when `previous == 0`, where a percentage is undefined).
/// The `current` fallback is the web `delta.current ?? (Number.isFinite(numericValue) ? … : null)`.
public enum MetricCardDeltaProjector {
    public static func resolve(
        _ delta: MetricCardDelta,
        fallbackCurrent: Double?
    ) -> MetricCardDeltaProjection {
        if delta.loading { return .loading(delta.size) }

        let current = delta.current ?? fallbackCurrent
        guard let current, current.isFinite,
              let previous = delta.previous, previous.isFinite
        else {
            return .empty(comparedTo: delta.comparedTo, size: delta.size)
        }

        let signedDelta = current - previous
        let signedPct = previous != 0 ? (signedDelta / abs(previous)) * 100 : nil
        let tone = tone(direction: delta.direction, signedDelta: signedDelta)
        let arrow = arrow(hideArrow: delta.hideArrow, signedDelta: signedDelta)

        let absText = MetricCardDeltaFormat.absolute(
            abs(signedDelta),
            prefix: delta.unitPrefix,
            suffix: delta.unitSuffix,
            precision: delta.precision
        )
        let pctText = signedPct.map { value -> String in
            let pct = MetricCardDeltaFormat.fixed(abs(value), precision: delta.precision ?? 1)
            return "\(pct)%"
        }

        let text: String = switch delta.display {
        case .absolute:
            absText
        case .both:
            pctText.map { "\(absText) (\($0))" } ?? absText
        case .percent:
            pctText ?? MetricCardGlyph.dash
        }

        let titlePrecision = delta.precision ?? 2
        return .value(MetricCardDeltaValue(
            arrow: arrow,
            tone: tone,
            text: text,
            comparedTo: delta.comparedTo,
            size: delta.size,
            currentText: MetricCardDeltaFormat.fixed(current, precision: titlePrecision),
            previousText: MetricCardDeltaFormat.fixed(previous, precision: titlePrecision)
        ))
    }

    /// Web `colorForDelta(direction, signedDelta)`.
    static func tone(direction: MetricCardDelta.Direction, signedDelta: Double) -> MetricCardTone {
        if signedDelta == 0 { return .muted }
        if direction == .neutral { return .secondary }
        let positiveOutcome =
            (direction == .higherBetter && signedDelta > 0) ||
            (direction == .lowerBetter && signedDelta < 0)
        return positiveOutcome ? .success : .danger
    }

    /// Web arrow choice (`signedDelta > 0 ? ArrowUp : signedDelta < 0 ? ArrowDown : ArrowRight`),
    /// suppressed when `hideArrow`.
    static func arrow(hideArrow: Bool, signedDelta: Double) -> MetricCardDeltaArrow {
        if hideArrow { return .hidden }
        if signedDelta > 0 { return .up }
        if signedDelta < 0 { return .down }
        return .right
    }
}

// MARK: - MetricCardProjector (whole card)

/// The top-level projection — the verbatim port of the web `MetricCard` render body. Resolves the
/// visible value, threads the card's numeric value into the delta's `current` fallback, and chooses
/// the footer slot (delta wins over the legacy pill, web `change && !delta`).
public enum MetricCardProjector {
    public static func resolve(_ inputs: MetricCardInputs) -> MetricCardProjection {
        MetricCardProjection(
            valueText: inputs.value.displayText,
            subtitle: inputs.subtitle,
            trend: trend(inputs)
        )
    }

    static func trend(_ inputs: MetricCardInputs) -> MetricCardTrend {
        if let delta = inputs.delta {
            return .delta(
                MetricCardDeltaProjector.resolve(
                    delta,
                    fallbackCurrent: inputs.value.finiteNumericValue
                )
            )
        }
        if let change = inputs.change {
            return .change(MetricCardChangeProjector.resolve(change))
        }
        return .none
    }
}
