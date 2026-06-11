//
//  BrowserCompatBanner.Views.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  The presentational subviews composed by `BrowserCompatBanner`: the active-warning banner card (the
//  native parity of the web `<AlertBanner variant="warning">` — the warning-tinted chrome with the
//  title, the interpolated body listing the missing capabilities + the recommendation, and the
//  dismiss affordance) and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade
//  and the shared P1/S9 tokens / components (`TSAlertBanner` ← web `AlertBanner`, `TSButton` ← web
//  `Button`) — no detection, no persistence, no Tailwind ports, no raw hex.
//
//  Accessibility note: the dismiss control is rendered as a standalone `TSButton` beneath the combined
//  `TSAlertBanner` chrome (rather than inside it) so it stays an individually focusable VoiceOver
//  element carrying the web `compat.banner.dismiss` label.
//

import SwiftUI

// MARK: - Active-warning banner (web `<AlertBanner variant="warning">`)

/// The active-warning banner — the data render of the surface. Reproduces the web banner: the
/// warning-tinted `TSAlertBanner` chrome (triangle icon + title + body) where the body interpolates
/// the comma-joined missing-capability names + the recommended-runtime guidance (web
/// `t('compat.banner.body', { features, recommendation })`), plus the dismiss affordance (web
/// `AlertBanner.onClose`, labelled `compat.banner.dismiss`).
struct BrowserCompatBannerCard: View {
    let data: BrowserCompatData
    let onDismiss: () -> Void

    private var capabilityNames: [String] {
        data.missing.map { BrowserCompatBannerStrings.string($0.nameKey, $0.nameFallback) }
    }

    private var titleText: String {
        BrowserCompatBannerStrings.string(BrowserCompatCopy.titleKey, BrowserCompatCopy.titleFallback)
    }

    private var bodyText: String {
        BrowserCompatBody.text(
            features: BrowserCompatBody.featureList(capabilityNames),
            recommendation: BrowserCompatBannerStrings.string(
                BrowserCompatCopy.recommendationKey,
                BrowserCompatCopy.recommendationFallback
            ),
            template: BrowserCompatBannerStrings.string(BrowserCompatCopy.bodyKey, BrowserCompatCopy.bodyFallback)
        )
    }

    private var dismissLabel: String {
        BrowserCompatBannerStrings.string(BrowserCompatCopy.dismissKey, BrowserCompatCopy.dismissFallback)
    }

    private var accessibilityText: String {
        BrowserCompatAccessibility.bannerLabel(title: titleText, body: bodyText)
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSAlertBanner(
                    tone: .warning,
                    systemImage: "exclamationmark.triangle.fill",
                    title: LocalizedStringKey(titleText),
                    message: LocalizedStringKey(bodyText)
                )
                .accessibilityLabel(Text(verbatim: accessibilityText))

                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    TSButton(variant: .ghost, size: .small, action: onDismiss) {
                        HStack(spacing: TSSpacing.xs) {
                            Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                            Text(verbatim: dismissLabel)
                        }
                    }
                    .accessibilityLabel(Text(verbatim: dismissLabel))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the surface when the capability snapshot is not live — a coloured
/// dot + a label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the
/// probe, with an explicit label. Hidden while live.
struct BrowserCompatBannerFreshnessChip: View {
    let connection: BrowserCompatConnection
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
        case .live: BrowserCompatBannerStrings.string("compat.live", "Live")
        case .stale: BrowserCompatBannerStrings.string("compat.stale", "Stale")
        case .offline: BrowserCompatBannerStrings.string("compat.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            BrowserCompatBannerStrings.string("compat.staleA11y", "Stale — tap to re-check compatibility")
        case .offline:
            BrowserCompatBannerStrings.string("compat.offlineA11y", "Offline — showing the last compatibility check")
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
