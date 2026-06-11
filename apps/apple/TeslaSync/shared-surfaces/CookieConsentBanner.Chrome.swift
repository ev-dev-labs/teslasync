//
//  CookieConsentBanner.Chrome.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  The structural chrome composed by the CookieConsentBanner views: the glass card shell (the native
//  parity of the web `rounded-2xl border bg-surface-1/95 backdrop-blur-md shadow-2xl` panel), the
//  shield icon badge (web neon-cyan `IconBox`), the "Always on" pill (web neon-green badge — a
//  sanctioned tinted chip, not body text), and the P4 freshness status chip. All consume the shared
//  P1/S9 tokens / materials — no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Card shell (web `rounded-2xl … backdrop-blur-md shadow-2xl`)

/// The frosted, bordered, shadowed card the banner content sits in — a system material clipped to the
/// panel radius with the semantic glass border and an elevation shadow, capped to a comfortable
/// reading width and centered (web `mx-auto max-w-3xl`).
struct CookieConsentCard<Content: View>: View {
    private let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .padding(TSSpacing.lg)
            .frame(maxWidth: 640)
            .background(TSMaterial.panel, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.25), radius: 18, x: 0, y: 8)
    }
}

// MARK: - Shield icon badge (web neon-cyan `IconBox`)

/// The leading shield glyph in a tinted rounded box — the native parity of the web `IconBox` (the
/// `ShieldCheck` in a `bg-neon-cyan/10 ring-neon-cyan/20` tile). Decorative, hidden from VoiceOver.
struct ConsentIconBadge: View {
    var body: some View {
        Image(systemName: "checkmark.shield.fill")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 36, height: 36)
            .background(
                Color.TS.accent.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - "Always on" pill (web neon-green badge — sanctioned tinted chip)

/// The strictly-necessary "Always on" pill — a short label inside a success-tinted chip that also
/// carries the matching background + border (the sanctioned chip use), the native parity of the web
/// `bg-neon-green/10 ring-neon-green/20 text-neon-green` badge.
struct AlwaysOnBadge: View {
    private var text: String {
        CookieConsentStrings.string("consent.category.alwaysOn", "Always on")
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusSuccess.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.25), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Status chip (P4 freshness axis)

/// The consent-policy status chip shown above the actions when the cached policy is failed / offline /
/// stale — a coloured dot + the localized message + (when retryable) an explicit Retry control. The
/// cached `requireConsent` flag stays applied beneath it, so the banner is never hidden by a degraded
/// refresh.
struct CookieConsentStatusChipView: View {
    let chip: ConsentStatusChip
    let onRetry: () -> Void

    private var tone: Color {
        switch chip.tone {
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        case .stale: Color.TS.statusWarning
        }
    }

    private var message: String {
        chip.message(CookieConsentStrings.string)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(tone).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
            if chip.showsRetry {
                TSButton(variant: .ghost, size: .small, action: onRetry) {
                    Text(verbatim: CookieConsentStrings.string("consent.status.retry", "Retry"))
                }
                .accessibilityLabel(
                    Text(verbatim: CookieConsentStrings.string("consent.status.retry", "Retry"))
                )
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
