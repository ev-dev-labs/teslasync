//
//  AiLimitBanner.States.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `AiLimitBanner` when the surface is not in its data
//  state: the loading skeleton (the banner shape as shimmer), the empty state (no active limit —
//  the friendly native parity of the web `if (!info) return null`, never a blank box), and the
//  error tile with a retry affordance (web `QueryError` peer). All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (parent resolving whether a limit applies)

/// The initial-fetch chrome — a skeleton banner that keeps the surface's shape (icon + two text
/// lines + an action) while the parent resolves whether a limit is active.
struct AiLimitBannerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 160, height: 12)
                TSSkeleton(height: 12)
                TSSkeleton(width: 110, height: 28, cornerRadius: TSRadius.sm)
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
        .accessibilityLabel(Text(verbatim: AiLimitBannerStrings.string(
            "ai.limit.loadingA11y", "Checking Helix limits"
        )))
    }
}

// MARK: - Empty (no active limit — web `if (!info) return null`)

/// The empty render — a friendly card stating that no Helix limit is active, the native parity of
/// the web banner returning `null` (improved to never collapse to a blank box, per the P4 leaf
/// contract).
struct AiLimitBannerEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(AiLimitBannerStrings.string(
                    "ai.limit.empty", "No active Helix limit"
                )),
                message: LocalizedStringKey(AiLimitBannerStrings.string(
                    "ai.limit.emptyMessage",
                    "Helix is operating normally. A notice appears here if a rate limit or cost cap is reached."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct AiLimitBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: AiLimitBannerStrings.string(
                    "ai.limit.errorTitle", "Couldn't check Helix limits"
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
                    Text(verbatim: AiLimitBannerStrings.string("ai.limit.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: AiLimitBannerStrings.string("ai.limit.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
