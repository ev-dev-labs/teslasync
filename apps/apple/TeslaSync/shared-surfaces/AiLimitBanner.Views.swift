//
//  AiLimitBanner.Views.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  The presentational subviews composed by `AiLimitBanner`: the active-limit banner card (the
//  native parity of the web `<AlertBanner>` body — severity chrome, reason title + description, the
//  live countdown line, and the baseline / retry / dismiss affordances) and the freshness chip (P4
//  connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components
//  (`TSAlertBanner` ← web `AlertBanner`, `TSButton` ← web `Button`) — no networking, no Tailwind
//  ports, no raw hex.
//
//  Accessibility note: the interactive controls are rendered as standalone `TSButton`s beneath the
//  combined `TSAlertBanner` chrome (rather than inside it) so each affordance stays an individually
//  focusable VoiceOver element with its own label.
//

import SwiftUI

// MARK: - Severity → tone (P1/S9 tokens)

extension AiLimitSeverity {
    /// The shared tone token for the severity — the native mirror of the web `AlertBanner`
    /// `variant` colour (info → cyan, warning → amber, danger → red).
    var tone: TSTone {
        switch self {
        case .info: .info
        case .warning: .warning
        case .danger: .danger
        }
    }
}

// MARK: - Active-limit banner (web `<AlertBanner>` body)

/// The active-limit banner — the data render of the surface. Reproduces the web banner exactly:
/// the severity-tinted `TSAlertBanner` chrome (icon + reason title + description), the muted
/// "Try again in Ns" countdown line while the limiter window is open, and the "Use baseline" /
/// "Retry" / dismiss affordances gated on the parent handlers + `baselineAvailable` + `retryReady`.
struct AiLimitBannerCard: View {
    let data: AiLimitBannerData
    let onUseBaseline: () -> Void
    let onRetry: () -> Void
    let onDismiss: () -> Void

    private var title: String {
        AiLimitBannerStrings.string(data.copy.titleKey, data.copy.titleFallback)
    }

    private var description: String {
        AiLimitBannerStrings.string(data.copy.descriptionKey, data.copy.descriptionFallback)
    }

    private var countdownText: String {
        AiLimitCountdown.retryInText(
            seconds: data.secondsLeft,
            template: AiLimitBannerStrings.string("ai.limit.retryIn", "Try again in {seconds}s")
        )
    }

    private var showCountdown: Bool {
        !data.retryReady && data.secondsLeft > 0
    }

    private var hasControls: Bool {
        data.showBaseline || data.showRetry || data.showDismiss
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSAlertBanner(
                    tone: data.severity.tone,
                    systemImage: data.severity.systemImageName,
                    title: LocalizedStringKey(title),
                    message: LocalizedStringKey(description)
                )

                if showCountdown {
                    Text(verbatim: countdownText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityLabel(Text(verbatim: countdownText))
                }

                if hasControls {
                    controls
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            if data.showBaseline {
                TSButton(variant: .ghost, size: .small, action: onUseBaseline) {
                    Text(verbatim: AiLimitBannerStrings.string("ai.limit.useBaseline", "Use baseline"))
                }
                .accessibilityLabel(
                    Text(verbatim: AiLimitBannerStrings.string("ai.limit.useBaseline", "Use baseline"))
                )
            }
            if data.showRetry {
                TSButton(variant: .primary, size: .small, action: onRetry) {
                    Text(verbatim: AiLimitBannerStrings.string("ai.limit.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: AiLimitBannerStrings.string("ai.limit.retry", "Retry")))
            }
            Spacer(minLength: 0)
            if data.showDismiss {
                TSButton(variant: .ghost, size: .small, action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                }
                .accessibilityLabel(Text(verbatim: AiLimitBannerStrings.string("ai.limit.dismiss", "Dismiss")))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct AiLimitBannerFreshnessChip: View {
    let connection: AiLimitConnection
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
        case .live: AiLimitBannerStrings.string("ai.limit.live", "Live")
        case .stale: AiLimitBannerStrings.string("ai.limit.stale", "Stale")
        case .offline: AiLimitBannerStrings.string("ai.limit.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AiLimitBannerStrings.string("ai.limit.staleA11y", "Stale — tap to refresh")
        case .offline:
            AiLimitBannerStrings.string("ai.limit.offlineA11y", "Offline — showing the last known limit")
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
