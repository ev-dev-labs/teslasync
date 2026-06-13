//
//  ImpersonationBanner.States.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `ImpersonationBanner` when the surface is not showing the
//  active session: the loading skeleton (the banner shape as shimmer while the first status load is in
//  flight), the empty card (the native parity of the web banner returning `null` for the inactive /
//  open-mode branches — rendered as a calm, honest card per kind instead of a blank box), and the
//  error tile with a retry affordance. All copy resolves through the P1/S10 facade; all colour comes
//  from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (the first status load in flight)

/// The initial-load chrome — a skeleton that keeps the surface's shape (an icon + two text lines + a
/// trailing control) while the first `useImpersonationStatus` read resolves. A real, rendered state
/// before the first emission, never a blank box.
struct ImpersonationBannerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 160, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: TSSpacing.sm)
            TSSkeleton(width: 96, height: 28, cornerRadius: TSRadius.md)
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
        .accessibilityLabel(Text(verbatim: ImpersonationBannerStrings.string(
            "impersonation.banner.loadingA11y", "Checking impersonation status"
        )))
    }
}

// MARK: - Empty (web inactive / open-mode — both render nothing)

/// The empty render — a friendly card, the native parity of the web banner returning `null` for the
/// non-active modes, improved to never collapse to a blank box (P4 leaf contract). The copy stays
/// honest per kind: a neutral "you're yourself" note when there is no active session, and an explicit
/// "open mode" explanation when the install has no per-user identity to impersonate.
struct ImpersonationBannerEmptyView: View {
    let kind: ImpersonationBannerEmptyKind

    private var titleText: String {
        switch kind {
        case .inactive:
            ImpersonationBannerStrings.string("impersonation.banner.empty.inactive.title", "Not impersonating")
        case .unavailable:
            ImpersonationBannerStrings.string(
                "impersonation.banner.empty.unavailable.title", "Impersonation unavailable"
            )
        }
    }

    private var messageText: String {
        switch kind {
        case .inactive:
            ImpersonationBannerStrings.string(
                "impersonation.banner.empty.inactive.message",
                "You are viewing TeslaSync as yourself. This banner appears only while an admin impersonation "
                    + "session is active."
            )
        case .unavailable:
            ImpersonationBannerStrings.string(
                "impersonation.banner.empty.unavailable.message",
                "This install runs in open mode, so there is no per-user identity to impersonate."
            )
        }
    }

    private var systemImage: String {
        switch kind {
        case .inactive: "person.crop.circle"
        case .unavailable: "person.crop.circle.badge.xmark"
        }
    }

    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(titleText),
                message: LocalizedStringKey(messageText),
                systemImage: systemImage
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `isError` peer)

/// The status-load-failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct ImpersonationBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: ImpersonationBannerStrings.string(
                    "impersonation.banner.errorTitle", "Couldn't check impersonation status"
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
                    Text(verbatim: ImpersonationBannerStrings.string("impersonation.banner.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: ImpersonationBannerStrings.string(
                    "impersonation.banner.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
