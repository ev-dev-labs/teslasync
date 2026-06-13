//
//  LiveStaleDataBanner.States.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `LiveStaleDataBanner` when the surface is not showing the
//  stale-data warning: the loading skeleton (the banner shape as shimmer while the first live-status
//  reading resolves — the web hook's `unknown` seed), the healthy card (the native parity of the web
//  `return null` when the pipe is healthy — rendered as a calm, honest "live data connected" card
//  instead of a blank box), and the error tile with a retry affordance (web `QueryError` peer). All
//  copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (initial live-status reading in flight)

/// The initial-read chrome — a skeleton banner that keeps the surface's shape (an icon + a title line +
/// a message line) while the first live-status reading resolves. Brief in production (the hook seeds a
/// status promptly), but a real, rendered state before the first emission.
struct LiveStaleDataBannerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 12)
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
        .accessibilityLabel(Text(verbatim: LiveStaleDataBannerStrings.string(
            "live.staleBanner.loadingA11y", "Checking the live data connection"
        )))
    }
}

// MARK: - Healthy (web `return null`)

/// The healthy render — a friendly card confirming live data is flowing, the native parity of the web
/// component returning nothing when the pipe is healthy (or only transiently down), improved to never
/// collapse to a blank box (P4 leaf contract). The copy stays honest: this notice appears only after a
/// sustained outage.
struct LiveStaleDataBannerHealthyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(LiveStaleDataBannerStrings.string(
                    "live.staleBanner.healthy.title", "Live data connected"
                )),
                message: LocalizedStringKey(LiveStaleDataBannerStrings.string(
                    "live.staleBanner.healthy.message",
                    "You're receiving live data. This notice appears only when the live connection has been "
                        + "offline for more than two minutes."
                )),
                systemImage: "dot.radiowaves.left.and.right"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct LiveStaleDataBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: LiveStaleDataBannerStrings.string(
                    "live.staleBanner.errorTitle", "Couldn't check the live connection"
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
                    Text(verbatim: LiveStaleDataBannerStrings.string("live.staleBanner.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: LiveStaleDataBannerStrings.string(
                    "live.staleBanner.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
