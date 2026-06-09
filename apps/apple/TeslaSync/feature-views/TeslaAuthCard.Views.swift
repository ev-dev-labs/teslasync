//
//  TeslaAuthCard.Views.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  The presentational subviews composed by `TeslaAuthCard`, reproducing the web body: the severity
//  accent bar, the shield glyph, the title + status badge row, the detail line, and the
//  "Manage / Re-authenticate" CTA pill. All consume the P1/S10 facade + the shared P1/S9 tokens —
//  no networking, no Tailwind ports, no raw hex. The web `Badge variant` is reproduced as a scoped
//  chip rendering the already-localized status verbatim; the cyan CTA pill is constant across
//  severities exactly like the web `<Link>` (only the label switches).
//

import SwiftUI

// MARK: - Accent → Color (web `TONE` color)

extension TeslaAuthTone.Accent {
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Accent bar (web `h-1 w-full` severity bar)

/// The full-width severity bar atop the card (web `<div className="h-1 w-full {bar}">`). Intensity
/// tracks the accent tone; clipped to the card's rounded corners by the parent.
struct TeslaAuthAccentBar: View {
    let accent: TeslaAuthTone.Accent

    var body: some View {
        Rectangle()
            .fill(accent.color.opacity(0.5))
            .frame(height: 3)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}

// MARK: - Card body (web icon | title+badge+detail | CTA)

/// The resolved card content — the SwiftUI parity of the web body row: the shield glyph, the
/// title + status badge, the detail line, and the trailing CTA. The title/badge/detail collapse
/// into one VoiceOver summary; the CTA stays an independently focusable button.
struct TeslaAuthCardBody: View {
    let presentation: TeslaAuthPresentation
    let onManage: () -> Void

    private var title: String {
        TeslaAuthStrings.string("teslaAuth.title", "Tesla account")
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TeslaAuthShieldIcon(symbol: presentation.symbol, accent: presentation.accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: title)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    TeslaAuthStatusBadge(accent: presentation.accent, label: presentation.badgeLabel)
                }
                Text(verbatim: presentation.detail)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: presentation.accessibilitySummary))

            TeslaAuthCTAButton(label: presentation.ctaLabel, action: onManage)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Shield icon (web lucide Shield*)

/// The leading shield glyph — the SF Symbol peer of the web lucide `ShieldCheck` / `ShieldAlert` /
/// `ShieldX`, tinted by the severity accent.
struct TeslaAuthShieldIcon: View {
    let symbol: String
    let accent: TeslaAuthTone.Accent

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(accent.color)
            .accessibilityHidden(true)
    }
}

// MARK: - Status badge (web `Badge variant`)

/// The status chip — the scoped peer of the web `<Badge variant>`, styled from the severity accent
/// but rendering the already-localized status label verbatim.
struct TeslaAuthStatusBadge: View {
    let accent: TeslaAuthTone.Accent
    let label: String

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(accent.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(accent.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(accent.color.opacity(0.3), lineWidth: 1))
            .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - CTA (web `<Link to="/tesla-account">`)

/// The trailing CTA pill — the web `<Link>` peer with the external-link glyph. The cyan accent is
/// constant across severities (matching the web); only the label switches (Manage vs
/// Re-authenticate). Navigation is delegated to the injected `action`.
struct TeslaAuthCTAButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 36)
            .background(Color.TS.accent.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .layoutPriority(1)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityHint(Text(verbatim: TeslaAuthStrings.string(
            "teslaAuth.manageHint",
            "Opens Tesla account settings"
        )))
        .accessibilityAddTraits(.isButton)
    }
}
