//
//  OfflineBanner.States.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `OfflineBanner` when the surface is not showing the offline
//  warning: the loading skeleton (the banner shape as shimmer while the first connectivity probe
//  resolves), the online card (the native parity of the web `if (online) return null` — rendered as a
//  calm, honest "you're connected" card instead of a blank box), and the error tile with a retry
//  affordance (web `QueryError` peer). All copy resolves through the P1/S10 facade; all colour comes
//  from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (initial connectivity probe in flight)

/// The initial-probe chrome — a skeleton banner that keeps the surface's shape (an icon + a message
/// line) while the first `NWPathMonitor` reading resolves. Brief in production (the monitor reports
/// promptly), but a real, rendered state before the first emission.
struct OfflineBannerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 120, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: OfflineBannerStrings.string(
            "pwa.offline.loadingA11y", "Checking your connection"
        )))
    }
}

// MARK: - Online (web `if (online) return null`)

/// The online render — a friendly card confirming connectivity, the native parity of the web component
/// returning `null` when online, improved to never collapse to a blank box (P4 leaf contract). The
/// copy stays honest: a positive confirmation that the user is connected and seeing live data.
struct OfflineBannerOnlineView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(OfflineBannerStrings.string(
                    "pwa.offline.online.title", "You're connected"
                )),
                message: LocalizedStringKey(OfflineBannerStrings.string(
                    "pwa.offline.online.message",
                    "You're online and seeing live data. This notice appears only when your connection drops."
                )),
                systemImage: "wifi"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The probe-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct OfflineBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: OfflineBannerStrings.string(
                    "pwa.offline.errorTitle", "Couldn't check your connection"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: OfflineBannerStrings.string("pwa.offline.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: OfflineBannerStrings.string("pwa.offline.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
