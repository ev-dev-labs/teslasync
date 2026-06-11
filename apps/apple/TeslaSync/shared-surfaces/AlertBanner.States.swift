//
//  AlertBanner.States.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `AlertBanner` when the surface is not in its `.alert`
//  state: the loading skeleton (the banner shape as shimmer), the empty state (nothing to surface —
//  the friendly native parity of the web banner not being mounted, never a blank box), and the
//  error tile with a retry affordance (web `QueryError` peer). All copy resolves through the P1/S10
//  facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (host resolving whether a banner applies)

/// The initial-fetch chrome — a skeleton banner that keeps the surface's shape (icon + two text
/// lines) while the host resolves whether a banner should show.
struct AlertBannerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 150, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AlertBannerStrings.string(
            "alertBanner.loadingA11y", "Checking for notices"
        )))
    }
}

// MARK: - Empty (nothing to surface)

/// The empty render — a friendly card stating there is nothing to show, the native parity of the
/// web host not mounting a banner (improved to never collapse to a blank box, per the P4 leaf
/// contract).
struct AlertBannerEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(AlertBannerStrings.string(
                    "alertBanner.empty", "No notices"
                )),
                message: LocalizedStringKey(AlertBannerStrings.string(
                    "alertBanner.emptyMessage",
                    "Everything is running normally. Status messages and alerts will appear here."
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
struct AlertBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: AlertBannerStrings.string(
                    "alertBanner.errorTitle", "Couldn't load notices"
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
                    Text(verbatim: AlertBannerStrings.string("alertBanner.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: AlertBannerStrings.string("alertBanner.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
