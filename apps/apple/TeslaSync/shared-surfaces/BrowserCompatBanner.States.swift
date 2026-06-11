//
//  BrowserCompatBanner.States.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `BrowserCompatBanner` when the surface is not showing the
//  active warning: the loading skeleton (the banner shape as shimmer), the empty card (the native
//  parity of the web `if (dismissed || missing.length === 0) return null` — rendered as a calm,
//  honest card per kind instead of a blank box), and the error tile with a retry affordance. All copy
//  resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (the one-shot detection in flight)

/// The initial-detection chrome — a skeleton that keeps the surface's shape (an icon + two text
/// lines + a control) while the capability probe resolves. Brief in production (detection is
/// synchronous, web parity), but a real, rendered state before the first emission.
struct BrowserCompatLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 180, height: 12)
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
        .accessibilityLabel(Text(verbatim: BrowserCompatBannerStrings.string(
            "compat.loadingA11y", "Checking device compatibility"
        )))
    }
}

// MARK: - Empty (web `if (dismissed || missing.length === 0) return null`)

/// The empty render — a friendly card, the native parity of the web banner returning `null`,
/// improved to never collapse to a blank box (P4 leaf contract). The copy stays honest per kind: a
/// positive confirmation when the device is supported, and a neutral acknowledgement (with an
/// explicit "some features may not work" note) when the user dismissed an active warning.
struct BrowserCompatEmptyView: View {
    let kind: BrowserCompatEmptyKind

    private var titleText: String {
        switch kind {
        case .compatible:
            BrowserCompatBannerStrings.string("compat.empty.compatible.title", "Your device is fully supported")
        case .acknowledged:
            BrowserCompatBannerStrings.string("compat.empty.acknowledged.title", "Compatibility notice dismissed")
        }
    }

    private var messageText: String {
        switch kind {
        case .compatible:
            BrowserCompatBannerStrings.string(
                "compat.empty.compatible.message",
                "All required features are available. A notice appears here only if your device is missing "
                    + "something TeslaSync needs."
            )
        case .acknowledged:
            BrowserCompatBannerStrings.string(
                "compat.empty.acknowledged.message",
                "You dismissed the compatibility notice. Some features may not work correctly until you update "
                    + "your device."
            )
        }
    }

    private var systemImage: String {
        switch kind {
        case .compatible: "checkmark.seal"
        case .acknowledged: "bell.slash"
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

// MARK: - Error (web `QueryError` peer)

/// The detection-failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct BrowserCompatErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: BrowserCompatBannerStrings.string(
                    "compat.errorTitle", "Couldn't check device compatibility"
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
                    Text(verbatim: BrowserCompatBannerStrings.string("compat.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: BrowserCompatBannerStrings.string(
                    "compat.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
