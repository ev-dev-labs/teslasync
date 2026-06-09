//
//  BatteryDegradationForecastWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  The presentational subviews composed by `BatteryDegradationForecastWidget`:
//  the semantic status badge (web `Badge`), the projected-date hero, the current
//  health stat card (web `StatCard`), the risk-factor rows, the recommendation
//  tip cards (web `WidgetTipCards`), and the friendly empty surface (web
//  `EmptyState`). All consume pre-localized strings from the P1/S10 facade and the
//  shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Palette (web Badge `variant` → semantic status colour)

/// Maps an impact level to its semantic status colour — the native counterpart of
/// the web `Badge` `variant` (high → danger, medium → warning, low → success).
enum BatteryDegradationForecastPalette {
    static func color(for impact: BatteryDegradationForecastImpact) -> Color {
        switch impact {
        case .high: Color.TS.statusDanger
        case .medium: Color.TS.statusWarning
        case .low: Color.TS.statusSuccess
        }
    }
}

// MARK: - Badge (web `Badge` size="sm")

/// A small tinted status chip — the native port of the web `Badge`. Reads as a
/// label inside a tinted capsule with a matching border (the toned-down,
/// non-neon body treatment), coloured by the impact's status family.
struct BatteryDegradationForecastBadge: View {
    let text: String
    let impact: BatteryDegradationForecastImpact

    var body: some View {
        let tone = BatteryDegradationForecastPalette.color(for: impact)
        return Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Section header (web `text-[10px] uppercase tracking-wider muted`)

/// A muted uppercase section label (web `Risk Factors` / `Recommendations` /
/// `Projected 80% Capacity` eyebrow).
struct BatteryDegradationForecastSectionLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .accessibilityHidden(true)
    }
}

// MARK: - Projected-date hero (web center hero section)

/// The hero section: the projected 80%-capacity date as a big number with the
/// eyebrow label, the tier badge, and the optional degradation-rate sub-label —
/// the native port of the web centered hero `<div>`.
struct BatteryDegradationForecastHero: View {
    let eyebrow: String
    let projectedDate: String
    let tierText: String
    let tierImpact: BatteryDegradationForecastImpact
    let rateText: String?

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            BatteryDegradationForecastSectionLabel(text: eyebrow)
            Text(verbatim: projectedDate)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: TSSpacing.sm) {
                BatteryDegradationForecastBadge(text: tierText, impact: tierImpact)
                if let rateText {
                    Text(verbatim: rateText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: heroAccessibilityLabel))
    }

    private var heroAccessibilityLabel: String {
        var parts = ["\(eyebrow) \(projectedDate)", tierText]
        if let rateText { parts.append(rateText) }
        return parts.joined(separator: ". ")
    }
}

// MARK: - Current health stat card (web `StatCard`)

/// The current-health stat (web `StatCard label="Current Health"`): a muted label
/// over a prominent value inside a subtle bordered card.
struct BatteryDegradationForecastStatCard: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(
            Color.TS.textPrimary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Risk-factor row (web risk factors `<li>`)

/// One risk-factor row: the symbol, the title over the detail, and the score
/// badge — the native port of the web risk-factor `<li>` (min 44pt tap target).
struct BatteryDegradationForecastRiskFactorRow: View {
    let factor: BatteryDegradationForecastRiskFactor
    let accessibilityLabel: String

    var body: some View {
        let impact = BatteryDegradationForecastBuilder.impact(forScore: factor.score)
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: BatteryDegradationForecastBuilder.riskSymbol(forName: factor.name))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: factor.displayTitle)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: factor.displayDetail ?? BatteryDegradationForecastFormat.emDash)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            BatteryDegradationForecastBadge(
                text: BatteryDegradationForecastFormat.riskScore(factor.score),
                impact: impact
            )
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(
            Color.TS.textPrimary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Recommendation tip card (web `WidgetTipCards`)

/// One recommendation tip card — the native port of a web `WidgetTipCards` item:
/// the lightbulb glyph, the "Tip" title with the "Recommendation" badge, and the
/// recommendation body text.
struct BatteryDegradationForecastTipCard: View {
    let title: String
    let badgeText: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "lightbulb.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 18)
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: title)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.sm)
                    BatteryDegradationForecastBadge(text: badgeText, impact: .medium)
                }
                Text(verbatim: detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(TSSpacing.md)
        .frame(minHeight: 44)
        .background(
            Color.TS.textPrimary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(detail)"))
    }
}

// MARK: - Empty surface (web `EmptyState`)

/// The friendly empty surface shown inside the content shell — the native port of
/// the web `EmptyState` (trending-down glyph + message). Never a blank panel.
struct BatteryDegradationForecastEmptyState: View {
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.line.downtrend.xyaxis")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}
