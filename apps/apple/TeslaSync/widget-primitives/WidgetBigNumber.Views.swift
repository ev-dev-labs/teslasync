//
//  WidgetBigNumber.Views.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  The presentational pieces of the big-number primitive — the native peers of the web elements: the
//  headline value (animated count-up / static figure / muted null value), its optional unit affix, the
//  uppercase label, the subtitle, and the trailing badge, composed into a centered column (the native
//  peer of the web `flex flex-col items-center justify-center h-full gap-1`). The count-up REUSES the
//  shared native ``AnimatedNumber`` surface (0075), the faithful peer of the web
//  `<AnimatedNumber value={value} />`; the badge chip is the verbatim-text peer of the shared ``TSBadge``
//  (web `<Badge>`), reusing its ``TSTone`` tokens. All chrome is token-driven (P1/S9); no raw hex, no
//  Tailwind ports. The whole column folds into one VoiceOver element reading "{value}{unit}, {label}, …".
//

import SwiftUI

// MARK: - Tone → design tokens

extension BigNumberValueTone {
    /// The headline value's text color — the theme-aware projection of the web `valueColor?` className.
    /// Defaults to the primary text token (the native peer of the web `'text-white'`, which resolves to
    /// white in dark and the high-ink color in light / high-contrast).
    var color: Color {
        switch self {
        case .primary: Color.TS.textPrimary
        case .secondary: Color.TS.textSecondary
        case .muted: Color.TS.textMuted
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .warning: Color.TS.statusWarning
        case .accent: Color.TS.accent
        }
    }
}

extension BigNumberBadgeVariant {
    /// The shared semantic tone the chip renders in — the native peer of the web `badgeVariantMap`
    /// (`success → success`, `warning → warning`, `error → danger`, `neutral → neutral`). Reuses the same
    /// ``TSTone`` vocabulary the shared ``TSBadge`` (web `<Badge>`) uses, so the chip stays on-token.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .error: .danger
        case .neutral: .neutral
        }
    }
}

// MARK: - BigNumberValueView (web value slot)

/// The headline value — the native peer of the web value slot: the shared ``AnimatedNumber`` count-up
/// (web `<AnimatedNumber value={value} />`), the static monospaced figure (web `tabular-nums` span), or
/// the muted null value (web null `<span>{nullDisplay}</span>`). Rendered at the display token size
/// (web `text-3xl font-bold`); the tone tints the figure (the null value is always muted). A pure
/// function of its ``BigNumberValueDisplay``, so it composes in every branch for snapshot / preview / test.
struct BigNumberValueView: View {
    let display: BigNumberValueDisplay

    var body: some View {
        switch display {
        case let .animated(raw, _, tone, locale):
            AnimatedNumber(value: raw, locale: locale)
                .font(Font.TS.display)
                .foregroundStyle(tone.color)
        case let .staticValue(text, tone):
            Text(verbatim: text)
                .font(Font.TS.display.monospacedDigit())
                .foregroundStyle(tone.color)
        case let .nullDisplay(text):
            Text(verbatim: text)
                .font(Font.TS.display)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - BigNumberValueLine (web baseline row)

/// The baseline row — the value with its optional trailing unit affix (web `flex items-baseline gap-1`
/// → the `text-lg text-secondary` unit span). Baseline-aligned so the smaller unit sits on the value's
/// baseline; kept to a single line so the big figure never wraps.
struct BigNumberValueLine: View {
    let value: BigNumberValueDisplay
    let unit: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            BigNumberValueView(display: value)
            if let unit, !unit.isEmpty {
                Text(verbatim: unit)
                    .font(Font.TS.section.weight(.regular))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .lineLimit(1)
    }
}

// MARK: - BigNumberBadgeView (web `<Badge>`)

/// The trailing badge — the verbatim-text peer of the shared ``TSBadge`` (web `<Badge size="sm">`):
/// a tinted, capsule-bordered chip carrying the caller's already-localized copy. Reuses the shared
/// ``TSTone`` tokens via ``BigNumberBadgeVariant/tone`` so it recolors across light / dark / high-contrast.
/// Rendered with `Text(verbatim:)` because the copy is a runtime, already-localized string (not a key).
struct BigNumberBadgeView: View {
    let badge: BigNumberBadge

    private var tint: Color {
        badge.variant.tone.color
    }

    var body: some View {
        Text(verbatim: badge.text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tint)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tint.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - BigNumberStack (web `flex flex-col items-center justify-center h-full gap-1`)

/// The centered column — the native peer of the web container: the baseline value row, then the optional
/// uppercase label, the subtitle, and the badge, centered horizontally and vertically in the available
/// space (web `items-center justify-center h-full`). A pure function of its ``WidgetBigNumberProjection``,
/// so it composes in every branch. The whole column is one VoiceOver element reading the value, then the
/// label, subtitle, and badge — so the primitive is scanned as a single, meaningful figure.
struct BigNumberStack: View {
    let projection: WidgetBigNumberProjection

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            BigNumberValueLine(value: projection.value, unit: projection.unit)
            if let label = projection.label, !label.isEmpty {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(TSTypeMetrics.labelTracking)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
            if let subtitle = projection.subtitle, !subtitle.isEmpty {
                Text(verbatim: subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            if let badge = projection.badge {
                BigNumberBadgeView(badge: badge)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The combined VoiceOver reading — the settled value (with its unit) followed by the label, the
    /// subtitle, and the badge copy, skipping any that are absent.
    private var accessibilityLabel: String {
        WidgetBigNumberStrings.accessibilityLabel(
            value: projection.value.spokenText,
            unit: projection.unit,
            label: projection.label,
            subtitle: projection.subtitle,
            badge: projection.badge?.text
        )
    }
}
