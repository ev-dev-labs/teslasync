//
//  RateLimitBanner.Views.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  The presentational subviews composed by `RateLimitBanner`: the active-banner card (the native
//  parity of the web sticky amber banner — the kind icon, the live countdown message, and the
//  "Retry now" / dismiss affordances) and the freshness chip (P4 connectivity axis). All consume the
//  P1/S10 facade and the shared P1/S9 tokens / components (`TSButton` ← web `Button`, `TSFadeIn` ←
//  web mount transition) — no networking, no Tailwind ports, no raw hex.
//
//  Accessibility note: the banner uses `accessibilityElement(children: .contain)` (not `.combine`)
//  so the message, the "Retry now" button, and the dismiss button each stay an individually focusable
//  VoiceOver element with its own label — the native parity of the web `role="alert"` region holding
//  three independent controls.
//

import SwiftUI

// MARK: - Active-banner card (web sticky amber banner)

/// The active-rate-limit banner — the data render of the surface. Reproduces the web banner: the
/// warning-tinted chrome with the kind icon (web `Clock` / `AlertCircle`), the live countdown message
/// (web `t('ratelimit.banner' / 'upstream.banner', { n: remaining })`), the "Retry now" button gated
/// disabled while the countdown runs (web `disabled={remaining > 0}`), and the dismiss control.
struct RateLimitBannerCard: View {
    let data: RateLimitBannerData
    let onRetry: () -> Void
    let onDismiss: () -> Void

    private var tone: Color {
        Color.TS.statusWarning
    }

    private var message: String {
        RateLimitBannerCopy.message(
            kind: data.kind,
            seconds: data.secondsLeft,
            resolve: RateLimitBannerStrings.string
        )
    }

    private var retryLabel: String {
        RateLimitBannerStrings.string("ratelimit.retry", "Retry now")
    }

    private var dismissLabel: String {
        RateLimitBannerStrings.string("common.dismiss", "Dismiss")
    }

    var body: some View {
        TSFadeIn {
            HStack(spacing: TSSpacing.md) {
                icon
                Text(verbatim: message)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(Text(verbatim: RateLimitBannerAccessibility.bannerLabel(message: message)))
                controls
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(tone.opacity(0.3), lineWidth: 1)
            )
            .accessibilityElement(children: .contain)
        }
    }

    private var icon: some View {
        Image(systemName: data.kind.systemImageName)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(tone)
            .padding(TSSpacing.xs)
            .background(tone.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .accessibilityHidden(true)
    }

    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .primary, size: .small, action: onRetry) {
                Text(verbatim: retryLabel)
            }
            .disabled(!data.retryEnabled)
            .opacity(data.retryEnabled ? 1 : 0.5)
            .accessibilityLabel(Text(verbatim: retryLabel))

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(TSSpacing.xs)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: dismissLabel))
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct RateLimitBannerFreshnessChip: View {
    let connection: RateLimitBannerConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: RateLimitBannerStrings.string("ratelimit.live", "Live")
        case .stale: RateLimitBannerStrings.string("ratelimit.stale", "Stale")
        case .offline: RateLimitBannerStrings.string("ratelimit.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            RateLimitBannerStrings.string("ratelimit.staleA11y", "Stale — tap to refresh")
        case .offline:
            RateLimitBannerStrings.string("ratelimit.offlineA11y", "Offline — showing the last known status")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
