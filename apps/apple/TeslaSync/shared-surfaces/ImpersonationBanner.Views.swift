//
//  ImpersonationBanner.Views.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  The presentational subviews composed by `ImpersonationBanner`: the active-session banner card (the
//  native parity of the web amber sticky bar — the warning-tinted chrome with the impersonated-subject
//  title, the explanatory body, the once-a-second countdown, and the "End impersonation" button that
//  swaps to "Ending…" + disables while the mutation is in flight) and the freshness chip (P4
//  connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components
//  (`TSAlertBanner` ← web `AlertBanner` peer, `TSButton` ← web `button`) — no transport, no Tailwind
//  ports, no raw hex.
//
//  Accessibility note: the "End impersonation" control is a standalone `TSButton` beneath the combined
//  `TSAlertBanner` chrome so it stays an individually focusable VoiceOver element carrying its own
//  label, while the banner region speaks the title + body + live countdown as one alert.
//

import SwiftUI

// MARK: - Active-session banner (web amber sticky bar)

/// The active-session banner — the data render of the surface. Reproduces the web banner: the
/// warning-tinted `TSAlertBanner` chrome (user icon + interpolated "Impersonating {target}" title +
/// explanatory body), the muted countdown line beneath it (web once-a-second remaining lifetime), and
/// the "End impersonation" affordance that reads "Ending…" + disables while the mutation runs (web
/// `endMut.isPending`).
struct ImpersonationBannerActiveCard: View {
    let data: ImpersonationBannerActiveData
    let countdown: String?
    let onEnd: () -> Void

    private var titleText: String {
        ImpersonationBannerTitle.text(
            target: data.target,
            template: ImpersonationBannerStrings.string(
                ImpersonationBannerCopy.titleKey, ImpersonationBannerCopy.titleFallback
            )
        )
    }

    private var bodyText: String {
        ImpersonationBannerStrings.string(ImpersonationBannerCopy.bodyKey, ImpersonationBannerCopy.bodyFallback)
    }

    private var endLabel: String {
        data.isEnding
            ? ImpersonationBannerStrings.string(
                ImpersonationBannerCopy.endingKey,
                ImpersonationBannerCopy.endingFallback
            )
            : ImpersonationBannerStrings.string(ImpersonationBannerCopy.endKey, ImpersonationBannerCopy.endFallback)
    }

    private var accessibilityText: String {
        ImpersonationBannerAccessibility.bannerLabel(title: titleText, body: bodyText, countdown: countdown)
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSAlertBanner(
                    tone: .warning,
                    systemImage: "person.crop.circle.badge.checkmark",
                    title: LocalizedStringKey(titleText),
                    message: LocalizedStringKey(bodyText)
                )
                .accessibilityLabel(Text(verbatim: accessibilityText))

                if let countdown {
                    Text(verbatim: countdown)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }

                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    TSButton(variant: .secondary, size: .small, action: onEnd) {
                        Text(verbatim: endLabel)
                    }
                    .disabled(data.isEnding)
                    .accessibilityLabel(Text(verbatim: endLabel))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the surface when the status snapshot is not live — a coloured dot
/// + a label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the poll,
/// with an explicit label. Hidden while live.
struct ImpersonationBannerFreshnessChip: View {
    let connection: ImpersonationBannerConnection
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
        case .live: ImpersonationBannerStrings.string("impersonation.banner.live", "Live")
        case .stale: ImpersonationBannerStrings.string("impersonation.banner.stale", "Stale")
        case .offline: ImpersonationBannerStrings.string("impersonation.banner.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            ImpersonationBannerStrings.string(
                "impersonation.banner.staleA11y", "Stale — tap to re-check impersonation status"
            )
        case .offline:
            ImpersonationBannerStrings.string(
                "impersonation.banner.offlineA11y", "Offline — showing the last impersonation status"
            )
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
