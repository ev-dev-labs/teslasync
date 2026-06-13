//
//  RateLimitBanner.States.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `RateLimitBanner` when the surface is not in its data
//  state: the loading skeleton (the banner row as shimmer), the empty state (no fired event — the
//  friendly native parity of the web `if (!state) return null`, never a blank box), and the error
//  tile with a retry affordance (web `QueryError` peer). All copy resolves through the P1/S10 facade;
//  all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (feed resolving whether a limit is active)

/// The initial-fetch chrome — a skeleton banner row that keeps the surface's shape (icon + message +
/// action) while the feed resolves whether a rate-limit notice is active.
struct RateLimitBannerLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 12)
            TSSkeleton(width: 84, height: 28, cornerRadius: TSRadius.sm)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
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
        .accessibilityLabel(Text(verbatim: RateLimitBannerStrings.string(
            "ratelimit.loadingA11y", "Checking request limits"
        )))
    }
}

// MARK: - Empty (no fired event — web `if (!state) return null`)

/// The empty render — a friendly card stating no rate-limit notice is active, the native parity of the
/// web banner returning `null` (improved to never collapse to a blank box, per the P4 leaf contract).
struct RateLimitBannerEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(RateLimitBannerStrings.string(
                    "ratelimit.empty", "No active rate limit"
                )),
                message: LocalizedStringKey(RateLimitBannerStrings.string(
                    "ratelimit.emptyMessage",
                    "Requests are flowing normally. A notice appears here if the server rate-limits the "
                        + "app or the Tesla upstream is paused."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct RateLimitBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: RateLimitBannerStrings.string(
                    "ratelimit.errorTitle", "Couldn't check request limits"
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
                    Text(verbatim: RateLimitBannerStrings.string("ratelimit.retry", "Retry now"))
                }
                .accessibilityLabel(Text(verbatim: RateLimitBannerStrings.string("ratelimit.retry", "Retry now")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
