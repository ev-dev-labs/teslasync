//
//  TeslaReauthBanner.States.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `TeslaReauthBanner` when the surface is not in its data
//  state: the loading skeleton (the banner shape as shimmer while the auth signal is read), the empty
//  state (the grant is healthy / acknowledged — the friendly native improvement over the web component
//  rendering nothing, never a blank box), and the error tile with a retry affordance (web `QueryError`
//  peer). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (auth-signal read / initial fetch)

/// The initial-read chrome — a skeleton banner that keeps the surface's shape (icon + two text lines +
/// two action shapes) while the auth signal is read.
struct TeslaReauthLoadingView: View {
    private var loadingLabel: String {
        TeslaReauthStrings.string("tesla.reauth.loadingA11y", "Checking Tesla connection")
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                TSSkeleton(width: 220, height: 10)
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 92, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.md)
            }
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
        .accessibilityLabel(Text(verbatim: loadingLabel))
    }
}

// MARK: - Empty (grant healthy / acknowledged)

/// The empty render — a friendly card stating the Tesla account is connected, the native improvement
/// over the web component rendering nothing (per the P4 leaf contract, the surface never collapses to
/// a blank box).
struct TeslaReauthEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(TeslaReauthStrings.string("tesla.reauth.empty", "Tesla account connected")),
                message: LocalizedStringKey(TeslaReauthStrings.string(
                    "tesla.reauth.emptyMessage",
                    "Live data and remote commands are available."
                )),
                systemImage: "checkmark.seal.fill"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The signal-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct TeslaReauthErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var errorTitle: String {
        TeslaReauthStrings.string("tesla.reauth.errorTitle", "Couldn't check your Tesla connection")
    }

    private var retryLabel: String {
        TeslaReauthStrings.string("tesla.reauth.retry", "Retry")
    }

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: errorTitle)
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
                    Text(verbatim: retryLabel)
                }
                .accessibilityLabel(Text(verbatim: retryLabel))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
