//
//  SessionListSection.Badges.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The small presentational tokens the session row composes: the battery-friendly
//  score badge (web `ScoreBadge`), the charger-category badge + the energy / free
//  pills (web `Badge` variants), and the inline metric chip (web `InlineMetric`).
//  Colors are the adaptive semantic tokens (P1/S9), not the web static hex, so
//  light / dark / high-contrast all resolve. Copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Palette (web badge variants → adaptive semantic tokens)

/// Maps the row's semantic roles to adaptive color tokens.
enum SessionRowPalette {
    /// The charger category tint (web `Badge` variant: supercharger=danger,
    /// dc=warning, home=success, unknown=info).
    static func category(_ category: SessionChargerCategory) -> Color {
        switch category {
        case .supercharger: Color.TS.statusDanger
        case .dc: Color.TS.statusWarning
        case .home: Color.TS.statusSuccess
        case .unknown: Color.TS.statusInfo
        }
    }

    /// The score tint: healthy (≥70) green, fair (≥40) amber, else red.
    static func score(_ score: Int) -> Color {
        if score >= 70 { return Color.TS.statusSuccess }
        if score >= 40 { return Color.TS.statusWarning }
        return Color.TS.statusDanger
    }
}

// MARK: - Score badge (web `ScoreBadge`)

/// The leading battery-friendly score badge (web `ScoreBadge`).
struct SessionScoreBadge: View {
    let score: Int
    let localize: (String, String) -> String

    var body: some View {
        let tone = SessionRowPalette.score(score)
        return Text(verbatim: "\(score)")
            .font(Font.TS.caption)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(tone)
            .frame(width: 34, height: 34)
            .background(tone.opacity(0.14), in: Circle())
            .overlay(Circle().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        localize("charging.scoreAria", "Battery-friendly score: {{value}}")
            .replacingOccurrences(of: "{{value}}", with: "\(score)")
    }
}

// MARK: - Pill badge (web `Badge`)

/// A compact tinted pill — the native parity of the web `Badge` with an optional
/// leading glyph.
struct SessionBadge: View {
    let text: String
    let tone: Color
    var systemImage: String?

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 9, weight: .bold))
            }
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// The charger-category badge (web `Badge` with the category label).
struct SessionCategoryBadge: View {
    let category: SessionChargerCategory
    let localize: (String, String) -> String

    var body: some View {
        SessionBadge(
            text: localize(category.localizationKey, category.fallback),
            tone: SessionRowPalette.category(category)
        )
    }
}

// MARK: - Inline metric (web `InlineMetric`)

/// One inline metric: a small glyph + value (web `InlineMetric`). The tone defaults
/// to the secondary text color so most metrics read as neutral body text.
struct SessionMetricChip: View {
    let systemImage: String
    let text: String
    var tone: Color = .TS.textSecondary

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: systemImage).font(.system(size: 10, weight: .medium))
            Text(verbatim: text).font(Font.TS.caption).monospacedDigit()
        }
        .foregroundStyle(tone)
        .accessibilityElement(children: .combine)
    }
}
